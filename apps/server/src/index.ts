/**
 * @file overview
 * This is the main entrypoint for the Calypso Bun server.
 * It is responsible for handling all incoming HTTP requests, routing them
 * to the appropriate integration or business logic modules, and serving
 * the compiled frontend React application from `apps/web/dist`.
 */

import { analyticsSql, auditSql, migrate, migrateAudit, sql } from 'db';
import { cleanupExpiredRevocations, startRevocationCleanup } from 'db/revocation';
import { scrubPii } from 'core';
import { handleAuthRequest, getAuthenticatedUser } from './api/auth';
import { handlePasskeyRequest } from './api/passkey';
import { handleTasksRequest } from './api/tasks';
import { handleTaskQueueResultRequest, handleTasksQueueRequest } from './api/task-queue';
import { handleAuditRequest } from './api/audit';
import { extractTraceId, traceLog, log } from 'core';
import { startCronScheduler } from './cron/boot';
import { websocketHandler } from './websocket';
import { handleAdminRequest } from './api/admin';
import { handleUsersRequest } from './api/users';
import { seedSuperuser } from './seed/superuser';
import { seedDemoPersonas } from './seed/demo-personas';
import { seedDemoData } from './seed/demo-data';
import { startDemoHealthCheck } from './cron/demo-health-check';
import { getJwks } from './auth/jwt';

// Starter behavior:
// the server boot path auto-runs a local schema initializer for convenience.
// The target enterprise posture keeps this repo on PostgreSQL, but production
// deployments should promote controlled migrations, journal checkpoint setup,
// and recovery validation ahead of serving traffic.
await migrate();
try {
  await migrateAudit();
} catch (err) {
  console.warn('[db] Audit schema migration skipped — audit database unavailable:', err);
}

// Purge any already-expired revocation rows left from a previous run, then
// schedule the recurring 24-hour cleanup. The timer is unref'd so it does not
// block process exit.
await cleanupExpiredRevocations().catch((err) =>
  console.error('[revocation] startup cleanup failed:', err),
);
startRevocationCleanup();

// Start the cron scheduler which manages all recurring jobs including
// stale-claim recovery (TQ-D-003).
startCronScheduler();

// Seed the initial superuser if none exists yet.
await seedSuperuser({ sql }).catch((err) => console.error('[seed] Superuser seeding failed:', err));

// Seed demo personas when DEMO_MODE=true is set.
await seedDemoPersonas({ sql }).catch((err) =>
  console.error('[demo] Demo persona seeding failed:', err),
);

// Seed demo sample data (entities, relations, task queue) when DEMO_MODE=true.
await seedDemoData({ sql }).catch((err) =>
  console.error('[demo] Demo sample data seeding failed:', err),
);

// Start the demo health-check cron job when DEMO_MODE=true is set.
// Runs every 2 minutes and enqueues a task into task_queue with
// agent_type=cron so the admin monitor shows continuous activity.
startDemoHealthCheck({ sql });

export interface AppState {
  sql: typeof sql;
  auditSql: typeof auditSql;
  analyticsSql: typeof analyticsSql;
}

export const appState: AppState = {
  sql,
  auditSql,
  analyticsSql,
};

export default {
  port: Number(process.env.PORT) || 31415,

  websocket: websocketHandler,

  /**
   * The core fetch handler for the Bun native HTTP server.
   * Every request gets a trace ID from the `X-Trace-Id` header (or a generated
   * UUID when the header is absent). The ID is included in all log entries for
   * the request lifecycle and echoed back in the response header so the browser
   * can correlate server logs with client-side context.
   * The `server` parameter is the Bun Server instance, needed to upgrade
   * WebSocket connections via `server.upgrade(req)`.
   *
   * @returns {Response} A unified response object containing the HTML document or API payload.
   */
  async fetch(req: Request, server: import('bun').Server<undefined>) {
    const url = new URL(req.url);
    const traceId = extractTraceId(req);
    const reqStart = Date.now();

    // Helper: wrap a Response with the trace header.
    function withTrace(res: Response): Response {
      const duration = Date.now() - reqStart;
      const entry = traceLog('info', traceId, {
        method: req.method,
        path: url.pathname,
        status: res.status,
        duration_ms: duration,
      });
      // Write to both console and the dual log files.
      console.log(JSON.stringify(entry));
      log('info', `${req.method} ${url.pathname} ${res.status}`, {
        trace_id: traceId,
        method: req.method,
        path: url.pathname,
        status: res.status,
        duration_ms: duration,
      });
      res.headers.set('X-Trace-Id', traceId);
      return res;
    }

    // Health check endpoint — used by k8s liveness/readiness probes and CI smoke test
    if (url.pathname === '/healthz' || url.pathname === '/health') {
      const version = process.env.RELEASE_TAG ?? 'dev';
      return withTrace(Response.json({ status: 'ok', version }));
    }

    // JWKS endpoint — exposes the current EC P-256 public key(s) for token verification.
    // Downstream services can use this to verify ES256-signed JWTs without the private key.
    if (url.pathname === '/.well-known/jwks.json') {
      const jwks = await getJwks();
      return withTrace(
        new Response(JSON.stringify(jwks), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
      );
    }

    // WebSocket upgrade endpoint — requires a valid JWT before upgrading
    if (url.pathname === '/ws') {
      const user = await getAuthenticatedUser(req);
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      // Return undefined so Bun completes the upgrade handshake
      return undefined as unknown as Response;
    }

    // Handle CORS for local dev
    if (req.method === 'OPTIONS') {
      const res = new Response('Departed', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Trace-Id',
        },
      });
      return withTrace(res);
    }

    if (url.pathname.startsWith('/api/auth/passkey')) {
      const passkeyRes = await handlePasskeyRequest(req, url, appState);
      if (passkeyRes) return passkeyRes;
    }

    if (url.pathname.startsWith('/api/auth')) {
      const authRes = await handleAuthRequest(req, url, appState);
      if (authRes) return withTrace(authRes);
    }

    if (url.pathname.startsWith('/api/tasks')) {
      // Delegated-token result submission route must be checked before the
      // cookie-auth tasks route so workers can submit without a user session.
      const resultRes = await handleTaskQueueResultRequest(req, url, appState);
      if (resultRes) return withTrace(resultRes);

      const tasksRes = await handleTasksRequest(req, url, appState);
      if (tasksRes) return withTrace(tasksRes);
    }

    if (url.pathname.startsWith('/api/tasks-queue')) {
      const tasksQueueRes = await handleTasksQueueRequest(req, url, appState);
      if (tasksQueueRes) return tasksQueueRes;
    }

    if (url.pathname.startsWith('/api/audit')) {
      const auditRes = await handleAuditRequest(req, url, appState);
      if (auditRes) return withTrace(auditRes);
    }

    if (url.pathname.startsWith('/api/admin')) {
      const adminRes = await handleAdminRequest(req, url, appState);
      if (adminRes) return adminRes;
    }

    if (url.pathname.startsWith('/api/users')) {
      const usersRes = await handleUsersRequest(req, url, appState);
      if (usersRes) return withTrace(usersRes);
    }

    // Serve static assets — path is relative to this file, not process cwd
    const webDist = `${import.meta.dir}/../../web/dist`;
    const staticFilePath = `${webDist}${url.pathname === '/' ? '/index.html' : url.pathname}`;
    const file = Bun.file(staticFilePath);
    if (await file.exists()) {
      return withTrace(new Response(file));
    }

    // Fallback to index.html for client-side React Router
    return withTrace(new Response(Bun.file(`${webDist}/index.html`)));
  },

  /**
   * Top-level error handler for the Bun HTTP server.
   * All logged objects are passed through `scrubPii` to prevent PII leaking
   * into server logs.
   */
  error(err: Error) {
    console.error('[server error]', scrubPii({ message: err.message, stack: err.stack }));
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

console.log(`Listening on http://localhost:${Number(process.env.PORT) || 31415}`);
