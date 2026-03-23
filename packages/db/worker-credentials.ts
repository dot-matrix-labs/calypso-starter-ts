/**
 * @file worker-credentials.ts
 *
 * Worker vendor credential store — PostgreSQL-backed storage for encrypted
 * Codex subscription authentication material.
 *
 * Credentials are stored as AES-256-GCM encrypted blobs (produced by
 * `packages/core/encryption.ts`).  Workers decrypt at startup using the
 * platform ENCRYPTION_MASTER_KEY, restore the Codex session from the
 * decrypted material, and fail closed if the bundle is missing, expired,
 * revoked, or cannot be decrypted.
 *
 * Security model
 * ---------------
 * - auth_bundle is NEVER returned in plaintext by this module.
 * - Workers receive the encrypted blob and decrypt it locally using the
 *   runtime-injected ENCRYPTION_MASTER_KEY (never stored in the DB).
 * - Revoked bundles are rejected before any decryption is attempted.
 * - Expired bundles (expires_at <= NOW()) are rejected.
 *
 * Blueprint reference: WORKER domain — credential handling rules
 */

import { resolveDatabaseUrls, buildSslOptions } from './index';
import postgres from 'postgres';

let _sql: postgres.Sql | null = null;

function getSql(): postgres.Sql {
  if (_sql) return _sql;
  const { app } = resolveDatabaseUrls();
  _sql = postgres(app, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: buildSslOptions(),
  });
  return _sql;
}

export interface WorkerCredentialRow {
  id: string;
  agent_type: string;
  /** AES-256-GCM encrypted auth bundle — enc:v1:<iv>:<ciphertext> format */
  auth_bundle: string;
  created_by: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface StoreCredentialOptions {
  agentType: string;
  /** AES-256-GCM encrypted auth bundle (must be encrypted before calling) */
  authBundle: string;
  createdBy: string;
  /** When this credential expires (defaults to 30 days from now) */
  expiresAt?: Date;
}

/**
 * Store an encrypted credential bundle for the given agent type.
 *
 * Replaces any existing non-revoked bundle for the same agent type by
 * revoking the old one first, ensuring only one active bundle per agent type.
 */
export async function storeWorkerCredential(
  options: StoreCredentialOptions,
): Promise<WorkerCredentialRow> {
  const sql = getSql();
  const { agentType, authBundle, createdBy } = options;
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Revoke any existing active bundle for this agent type.
  await sql`
    UPDATE worker_credentials
    SET revoked_at = NOW(), updated_at = NOW()
    WHERE agent_type = ${agentType}
      AND revoked_at IS NULL
      AND expires_at > NOW()
  `;

  const rows = await sql<WorkerCredentialRow[]>`
    INSERT INTO worker_credentials (agent_type, auth_bundle, created_by, expires_at)
    VALUES (${agentType}, ${authBundle}, ${createdBy}, ${expiresAt})
    RETURNING *
  `;

  return rows[0];
}

/**
 * Fetch the active encrypted credential bundle for the given agent type.
 *
 * Returns null when:
 * - No credential exists for this agent type
 * - The credential has been revoked
 * - The credential has expired
 *
 * Workers must fail closed when this returns null.
 */
export async function fetchActiveWorkerCredential(
  agentType: string,
): Promise<WorkerCredentialRow | null> {
  const sql = getSql();

  const rows = await sql<WorkerCredentialRow[]>`
    SELECT * FROM worker_credentials
    WHERE agent_type = ${agentType}
      AND revoked_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `;

  return rows[0] ?? null;
}

/**
 * Revoke the active credential bundle for the given agent type.
 *
 * This is an immediate revocation — any worker currently using this
 * credential will fail on the next restart.
 */
export async function revokeWorkerCredential(agentType: string): Promise<void> {
  const sql = getSql();

  await sql`
    UPDATE worker_credentials
    SET revoked_at = NOW(), updated_at = NOW()
    WHERE agent_type = ${agentType}
      AND revoked_at IS NULL
  `;
}
