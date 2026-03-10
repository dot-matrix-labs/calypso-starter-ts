/**
 * @file overview
 * This is the main entrypoint for the Calypso Bun server.
 * It is responsible for handling all incoming HTTP requests, routing them
 * to the appropriate integration or business logic modules, and serving
 * the compiled frontend React application from `apps/web/dist`.
 */

import { migrate } from 'db';
import { handleAuthRequest } from './api/auth';

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
        if (req.method === "OPTIONS") {
            const res = new Response("Departed", {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization",
                },
            });
            return res;
        }

        if (url.pathname.startsWith('/api/auth')) {
            const authRes = await handleAuthRequest(req, url);
            if (authRes) return authRes;
        }

        // Serve static assets requested by Vite
        const staticFilePath = `../web/dist${url.pathname === '/' ? '/index.html' : url.pathname}`;
        const file = Bun.file(staticFilePath);
        if (await file.exists()) {
            return new Response(file);
        }

        // Fallback to index.html for client-side React Router
        return new Response(Bun.file("../web/dist/index.html"));
    },
};

console.log("Listening on http://localhost:31415");
