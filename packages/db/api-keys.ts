/**
 * API key management — machine-to-machine authentication.
 *
 * Keys are stored as SHA-256 hashes. The raw key is returned only once on
 * creation and is never persisted. Incoming Bearer tokens are hashed and
 * compared against stored hashes using constant-time comparison.
 *
 * All create and revoke operations must be written to the audit log by the
 * caller (the admin API handler) with actor_id and key id only — never the
 * raw key value.
 */

import { sql } from './index';

export interface ApiKeyRow {
  id: string;
  label: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
}

/**
 * Generates a cryptographically random 32-byte hex API key.
 */
export function generateRawKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes the SHA-256 hex hash of a raw key string.
 */
export async function hashKey(rawKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = encoder.encode(rawKey);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Creates a new API key. Returns the raw key (shown once) and the row metadata.
 */
export async function createApiKey(
  label: string,
  createdBy: string,
): Promise<{ rawKey: string; row: ApiKeyRow }> {
  const rawKey = generateRawKey();
  const keyHash = await hashKey(rawKey);
  const id = crypto.randomUUID();

  const [row] = await sql<ApiKeyRow[]>`
    INSERT INTO api_keys (id, label, key_hash, created_by)
    VALUES (${id}, ${label}, ${keyHash}, ${createdBy})
    RETURNING id, label, created_by, created_at, last_used_at
  `;

  return { rawKey, row };
}

/**
 * Lists all API key metadata rows (no raw key values).
 */
export async function listApiKeys(): Promise<ApiKeyRow[]> {
  return sql<ApiKeyRow[]>`
    SELECT id, label, created_by, created_at, last_used_at
    FROM api_keys
    ORDER BY created_at DESC
  `;
}

/**
 * Deletes an API key by id. Returns true if a row was deleted.
 */
export async function deleteApiKey(id: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM api_keys WHERE id = ${id}
  `;
  return result.count > 0;
}

/**
 * Looks up an API key by its raw value. Uses constant-time comparison by
 * hashing the candidate first and doing a single indexed equality lookup.
 * Updates last_used_at on match. Returns the matching row or null.
 */
export async function authenticateApiKey(rawKey: string): Promise<ApiKeyRow | null> {
  const keyHash = await hashKey(rawKey);

  const rows = await sql<ApiKeyRow[]>`
    UPDATE api_keys
    SET last_used_at = NOW()
    WHERE key_hash = ${keyHash}
    RETURNING id, label, created_by, created_at, last_used_at
  `;

  return rows[0] ?? null;
}
