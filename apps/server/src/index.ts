/**
 * @file overview
 * This is the main entrypoint for the Calypso Bun server.
 * It is responsible for handling all incoming HTTP requests, routing them
 * to the appropriate integration or business logic modules, and serving
 * the compiled frontend React application from `apps/web/dist`.
 */

import { analyticsSql, auditSql, migrate, migrateAudit, sql } from 'db';
import { cleanupExpiredRevocations, startRevocationCleanup } from 'db/revocation';
import { handleAuthRequest } from './api/auth';
import { handleTasksRequest } from './api/tasks';
import { handleTaskQueueResultRequest } from './api/task-queue';
import { handleStudioRequest } from './api/studio';
import { handleAuditRequest } from './api/audit';

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
   * Currently, it serves the initial HTML stub to verify E2E testing.
   *
   * @returns {Response} A unified response object containing the HTML document or API payload.
   */
  async fetch(req: Request) {
    const url = new URL(req.url);

    // Health check endpoint — used by k8s liveness/readiness probes and CI smoke test
    if (url.pathname === '/healthz' || url.pathname === '/health') {
      const version = process.env.RELEASE_TAG ?? 'dev';
      return Response.json({ status: 'ok', version });
    }

    // Handle CORS for local dev
    if (req.method === 'OPTIONS') {
      const res = new Response('Departed', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
      return res;
    }

    if (url.pathname.startsWith('/api/auth')) {
      const authRes = await handleAuthRequest(req, url, appState);
      if (authRes) return authRes;
    }

    if (url.pathname.startsWith('/api/tasks')) {
      // Delegated-token result submission route must be checked before the
      // cookie-auth tasks route so workers can submit without a user session.
      const resultRes = await handleTaskQueueResultRequest(req, url, appState);
      if (resultRes) return resultRes;

      const tasksRes = await handleTasksRequest(req, url, appState);
      if (tasksRes) return tasksRes;
    }

    if (url.pathname.startsWith('/api/audit')) {
      const auditRes = await handleAuditRequest(req, url, appState);
      if (auditRes) return auditRes;
    }

    if (url.pathname.startsWith('/studio')) {
      const studioRes = await handleStudioRequest(req, url);
      if (studioRes) return studioRes;
    }

    // Serve static assets — path is relative to this file, not process cwd
    const webDist = `${import.meta.dir}/../../web/dist`;
    const staticFilePath = `${webDist}${url.pathname === '/' ? '/index.html' : url.pathname}`;
    const file = Bun.file(staticFilePath);
    if (await file.exists()) {
      return new Response(file);
    }

    // Fallback to index.html for client-side React Router
    return new Response(Bun.file(`${webDist}/index.html`));
  },
};

console.log(`Listening on http://localhost:${Number(process.env.PORT) || 31415}`);
