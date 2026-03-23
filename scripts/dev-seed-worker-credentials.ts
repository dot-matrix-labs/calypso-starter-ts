/**
 * dev-seed-worker-credentials.ts
 *
 * Seeds an encrypted dev Codex credential bundle for the `coding` agent type
 * into the local development database.
 *
 * This script is called from dev-worker-entrypoint.sh on each container start.
 * It is idempotent — storeWorkerCredential() revokes any existing active bundle
 * before inserting the new one.
 *
 * The credential is a mock auth bundle encrypted with the dev ENCRYPTION_MASTER_KEY.
 * It contains a fake access_token valid only against the dev-codex-stub binary.
 *
 * Prerequisites:
 *   - DATABASE_URL points to the app database (as app_rw).
 *   - ENCRYPTION_MASTER_KEY is set (64-char hex dev key).
 *   - The worker_credentials table exists (migrate() must have run).
 */

import { encryptField } from '../packages/core/encryption';
import { storeWorkerCredential } from '../packages/db/worker-credentials';

const AGENT_TYPE = process.env.AGENT_TYPE ?? 'coding';

// Mock Codex auth bundle — not a real credential.
const DEV_AUTH_BUNDLE = JSON.stringify({
  access_token: 'dev-codex-access-token',
  refresh_token: 'dev-codex-refresh-token',
  // expires_at omitted — no expiry for dev credentials
});

async function run() {
  console.log(`[dev-seed] Seeding worker credential for agent_type="${AGENT_TYPE}"...`);

  const encryptedBundle = await encryptField('worker_credential', DEV_AUTH_BUNDLE);

  await storeWorkerCredential({
    agentType: AGENT_TYPE,
    authBundle: encryptedBundle,
    createdBy: 'dev-seed-script',
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
  });

  console.log(`[dev-seed] Worker credential seeded for agent_type="${AGENT_TYPE}".`);
}

run().catch((err) => {
  console.error('[dev-seed] Failed to seed worker credentials:', err);
  process.exit(1);
});
