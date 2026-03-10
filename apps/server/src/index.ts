/**
 * @file overview
 * This is the main entrypoint for the Calypso Bun server.
 * It is responsible for handling all incoming HTTP requests, routing them
 * to the appropriate integration or business logic modules, and serving
 * the compiled frontend React application from `apps/web/dist`.
 */

import { migrate } from 'db';
import { handleAuthRequest } from './api/auth';
import { handleTasksRequest } from './api/tasks';

// Ensure Postgres tables exist before answering traffic
await migrate();

export default {
  port: 31415,

  /**
   * The core fetch handler for the Bun native HTTP server.
   * Currently, it serves the initial HTML stub to verify E2E testing.
   *
   * @returns {Response} A unified response object containing the HTML document or API payload.
   */
  async fetch(req: Request) {
    const url = new URL(req.url);

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
      const authRes = await handleAuthRequest(req, url);
      if (authRes) return authRes;
    }

    if (url.pathname.startsWith('/api/tasks')) {
      const tasksRes = await handleTasksRequest(req, url);
      if (tasksRes) return tasksRes;
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

console.log('Listening on http://localhost:31415');
