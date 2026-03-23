/**
 * @file index.ts
 *
 * Worker container entry point.
 *
 * Bootstraps the Codex task runner.  This file is the target of
 * `ENTRYPOINT` in Dockerfile.worker.
 */

import { startRunner } from './runner';

startRunner().catch((err: unknown) => {
  console.error('[worker] Fatal startup error:', err);
  process.exit(1);
});
