/**
 * @file codex-credentials.ts
 *
 * Codex subscription credential restoration for ephemeral worker containers.
 *
 * On startup, the worker fetches the encrypted auth bundle from the database,
 * decrypts it using the runtime-injected ENCRYPTION_MASTER_KEY, and writes
 * the restored session material to the Codex auth file path so the Codex
 * binary can authenticate when invoked.
 *
 * Fail-closed contract
 * ----------------------
 * The worker MUST NOT start if:
 * - No active credential bundle exists for the agent type
 * - The credential bundle has expired or been revoked
 * - Decryption fails (wrong key, corrupted data)
 * - The restored session material cannot be written to disk
 *
 * Security notes
 * ---------------
 * - The encrypted bundle is fetched from the DB at startup only; it is not
 *   cached in memory longer than needed for decryption.
 * - The restored session file is written to a tmpfs path when possible.
 * - ENCRYPTION_MASTER_KEY is never logged or stored.
 *
 * Blueprint reference: WORKER domain — WORKER-T-006 (credential leak prevention)
 */

import { writeFile } from 'fs/promises';
import { join } from 'path';
import { fetchActiveWorkerCredential } from 'db/worker-credentials';
import { decryptField } from 'core';

/** Default path for the restored Codex auth file. Override via CODEX_AUTH_FILE env var. */
const CODEX_AUTH_FILE = process.env.CODEX_AUTH_FILE ?? join('/tmp', '.codex-auth.json');

/** Entity type key used for HKDF derivation — scoped to worker credentials. */
const CREDENTIAL_ENTITY_TYPE = 'worker_credential';

export interface CodexAuthBundle {
  /** Codex access token */
  access_token: string;
  /** Codex refresh token (if present) */
  refresh_token?: string;
  /** ISO-8601 expiry timestamp */
  expires_at?: string;
  /** Additional vendor-specific auth fields */
  [key: string]: unknown;
}

/**
 * Restore the Codex session from the encrypted credential bundle stored in
 * the database.
 *
 * Fetches the active bundle for the agent type, decrypts it, validates the
 * structure, and writes the auth file to disk.  Throws on any failure so the
 * worker startup code can call `process.exit(1)`.
 */
export async function restoreCodexCredentials(agentType: string): Promise<void> {
  // Fetch the active encrypted bundle
  const credential = await fetchActiveWorkerCredential(agentType);

  if (!credential) {
    throw new Error(
      `No active Codex credential found for agent_type="${agentType}". ` +
        'Store credentials via the admin API before starting workers.',
    );
  }

  // Decrypt the auth bundle
  let plaintext: string;
  try {
    plaintext = await decryptField(CREDENTIAL_ENTITY_TYPE, credential.auth_bundle);
  } catch (err) {
    throw new Error(
      `Failed to decrypt Codex credential bundle for agent_type="${agentType}": ` +
        (err instanceof Error ? err.message : String(err)),
      { cause: err },
    );
  }

  // Parse and validate
  let authBundle: CodexAuthBundle;
  try {
    authBundle = JSON.parse(plaintext) as CodexAuthBundle;
  } catch {
    throw new Error(
      `Decrypted Codex credential bundle for agent_type="${agentType}" is not valid JSON.`,
    );
  }

  if (!authBundle.access_token) {
    throw new Error(
      `Decrypted Codex credential bundle for agent_type="${agentType}" is missing access_token.`,
    );
  }

  // Check token expiry if present
  if (authBundle.expires_at) {
    const expiry = new Date(authBundle.expires_at);
    if (!isNaN(expiry.getTime()) && expiry <= new Date()) {
      throw new Error(
        `Codex credential bundle for agent_type="${agentType}" has expired (expires_at=${authBundle.expires_at}).`,
      );
    }
  }

  // Write the auth file to the expected location
  try {
    await writeFile(CODEX_AUTH_FILE, JSON.stringify(authBundle), { mode: 0o600 });
  } catch (err) {
    throw new Error(
      `Failed to write Codex auth file to "${CODEX_AUTH_FILE}": ` +
        (err instanceof Error ? err.message : String(err)),
      { cause: err },
    );
  }

  console.log(
    `[credentials] Codex auth restored for agent_type="${agentType}" → ${CODEX_AUTH_FILE}`,
  );
}
