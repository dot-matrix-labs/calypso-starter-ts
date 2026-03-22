/**
 * @file bootstrap
 * New server entrypoint that initialises the secrets subsystem before any
 * module with DB connection pools is imported.
 *
 * Boot sequence:
 *   1. Call initSecrets() — resolves secrets, writes DB URL env vars.
 *   2. Dynamically import ./index.js — DB pools now see correct URLs at module scope.
 *
 * This file replaces direct `bun run src/index.ts` invocations in contexts
 * where Vault or other secrets backends are required.
 */

import { initSecrets } from './secrets/index';

await initSecrets();

// Dynamic import defers module evaluation until after env vars are populated.
await import('./index.js');
