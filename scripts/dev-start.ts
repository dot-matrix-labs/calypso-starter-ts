#!/usr/bin/env bun
/**
 * dev-start — Spins up an ephemeral Postgres container, runs migrations,
 * then starts the API server subprocess and Vite in middleware mode as the
 * single HTTP entry point. Proxies /api through to the API server.
 * Tears down the container on exit.
 *
 * Run via: bun run dev
 */

import { join } from 'path';
import { createServer as createHttpServer } from 'node:http';
import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';
import { createServer as createViteServer } from 'vite';
import { startPostgres } from '../packages/db/pg-container';
import { createProxy } from '../apps/web/vite.config';

const REPO_ROOT = join(import.meta.dir, '..');
const WEB_PORT_BASE = Number(process.env.PORT ?? 5174);
const MAX_PORT_SEARCH = 20;

/**
 * Returns true if the given TCP port is already in use on 127.0.0.1.
 */
function isPortOccupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Finds the first free TCP port starting from `base`, incrementing by 1
 * up to MAX_PORT_SEARCH times. Logs a message if the base port was occupied.
 */
async function findFreePort(base: number): Promise<number> {
  for (let offset = 0; offset < MAX_PORT_SEARCH; offset++) {
    const candidate = base + offset;
    const occupied = await isPortOccupied(candidate);
    if (!occupied) {
      if (offset > 0) {
        console.log(`  Port ${base} is in use. Using port ${candidate} instead.`);
      }
      return candidate;
    }
  }
  throw new Error(
    `No free port found in range ${base}–${base + MAX_PORT_SEARCH - 1}. ` +
      `Free a port and retry.`,
  );
}

// Cleanup state — tracks resources that need to be torn down.
let cleanupCalled = false;
let pgHandle: { stop: () => Promise<void> } | null = null;
let apiServerHandle: { kill: () => void } | null = null;
let viteHandle: { close: () => Promise<void> } | null = null;
let httpServerHandle: ReturnType<typeof createHttpServer> | null = null;

async function cleanup() {
  if (cleanupCalled) return;
  cleanupCalled = true;

  console.log('\n⬡ Shutting down');
  try {
    apiServerHandle?.kill();
  } catch {
    // best-effort
  }
  try {
    await viteHandle?.close();
  } catch {
    // best-effort
  }
  try {
    httpServerHandle?.close();
  } catch {
    // best-effort
  }
  try {
    await pgHandle?.stop();
  } catch {
    // best-effort
  }
  console.log('  Done.');
}

// Synchronous exit — ensures containers stop even on process.exit() calls.
process.on('exit', () => {
  // Synchronous best-effort: kill child process.  pg.stop() is async so we
  // can only trigger it if cleanup() was already called and awaited before exit.
  try {
    apiServerHandle?.kill();
  } catch {
    // ignore
  }
});

process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});

process.on('uncaughtException', async (err) => {
  console.error('\n❌ Uncaught exception:', err instanceof Error ? err.message : String(err));
  await cleanup();
  process.exit(1);
});

async function main() {
  console.log('\n⬡ Starting dev environment');

  // 0. Probe WEB_PORT; increment if occupied
  const WEB_PORT = await findFreePort(WEB_PORT_BASE);
  const API_PORT = WEB_PORT + 1;

  // 1. Start ephemeral Postgres
  console.log('  Starting Postgres container...');
  const pg = await startPostgres();
  pgHandle = pg;
  console.log(`  Postgres ready at: ${pg.url}`);
  process.env.DATABASE_URL = pg.url;
  process.env.AUDIT_DATABASE_URL = pg.url;
  process.env.ANALYTICS_DATABASE_URL = pg.url;

  // 2. Run migrations (dynamic import deferred until env vars are set)
  const { migrate } = await import('../packages/db/index');
  await migrate({ databaseUrl: pg.url });
  console.log('  Schema migrated.');

  // 3. Spawn API server subprocess with all DB URLs set
  const apiServer = Bun.spawn(['bun', 'run', '--hot', 'src/index.ts'], {
    cwd: join(REPO_ROOT, 'apps', 'server'),
    env: {
      ...process.env,
      DATABASE_URL: pg.url,
      AUDIT_DATABASE_URL: pg.url,
      ANALYTICS_DATABASE_URL: pg.url,
      PORT: String(API_PORT),
    },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  apiServerHandle = apiServer;

  // 4. Start Vite in middleware mode — single HTTP entry point, proxies to API
  const vite = await createViteServer({
    configFile: join(REPO_ROOT, 'apps', 'web', 'vite.config.ts'),
    root: join(REPO_ROOT, 'apps', 'web'),
    server: {
      middlewareMode: true,
      proxy: createProxy({ ...process.env, PORT: String(API_PORT) }),
    },
    appType: 'spa',
  });
  viteHandle = vite;

  const httpServer = createHttpServer(vite.middlewares);
  httpServerHandle = httpServer;

  httpServer.on('error', async (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\n❌ Port ${WEB_PORT} is already in use. ` + `Stop the process using that port and retry.`,
      );
    } else {
      console.error(`\n❌ HTTP server error on port ${WEB_PORT}: ${err.message}`);
    }
    await cleanup();
    process.exit(1);
  });

  httpServer.listen(WEB_PORT, '0.0.0.0', () => {
    const nets = networkInterfaces();
    const networkIp =
      Object.values(nets)
        .flat()
        .find((n) => n && n.family === 'IPv4' && !n.internal)?.address ?? 'localhost';

    console.log(`\n⬡ Dev server ready`);
    console.log(`  Network: http://${networkIp}:${WEB_PORT}`);
    console.log(`  Local:   http://localhost:${WEB_PORT}`);
    console.log('  Press Ctrl+C to stop\n');
  });
}

main().catch(async (err) => {
  console.error('\n❌ Dev startup failed.');
  console.error(err instanceof Error ? err.message : String(err));
  await cleanup();
  process.exit(1);
});
