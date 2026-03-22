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
import { handleAuthRequest } from './api/auth';
import { handlePasskeyRequest } from './api/passkey';
import { handleTasksRequest } from './api/tasks';
import { handleTaskQueueResultRequest } from './api/task-queue';
import { handleStudioRequest } from './api/studio';
import { handleAuditRequest } from './api/audit';
import { extractTraceId, traceLog, log } from 'core';
import { handleTasksQueueRequest } from './api/tasks-queue';
import { startStaleClaimRecovery } from 'db/task-queue';

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

// Start background stale-claim recovery (TQ-D-003). Runs every 60 seconds and
// resets expired claimed tasks to pending or promotes them to dead.
startStaleClaimRecovery();

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

  /**
   * The core fetch handler for the Bun native HTTP server.
   * Every request gets a trace ID from the `X-Trace-Id` header (or a generated
   * UUID when the header is absent). The ID is included in all log entries for
   * the request lifecycle and echoed back in the response header so the browser
   * can correlate server logs with client-side context.
   *
   * @returns {Response} A unified response object containing the HTML document or API payload.
   */
  async fetch(req: Request) {
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

    if (url.pathname.startsWith('/studio')) {
      const studioRes = await handleStudioRequest(req, url);
      if (studioRes) return withTrace(studioRes);
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
