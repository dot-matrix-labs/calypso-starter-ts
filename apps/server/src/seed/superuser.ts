/**
 * @file seed/superuser
 * Idempotent superuser bootstrap seeding.
 *
 * On startup, before the HTTP server begins accepting connections, this module
 * checks whether any user with `role = 'superuser'` exists in the entities
 * table. If none exists it creates one from the following env secrets:
 *
 *   SUPERUSER_EMAIL    — required; stored as the user's email property.
 *   SUPERUSER_PASSWORD — optional; used as-is (bcrypt-hashed before storage).
 *   SUPERUSER_MNEMONIC — optional; BIP-39 mnemonic passphrase treated as a
 *                        UTF-8 string and bcrypt-hashed before storage.
 *
 * If neither SUPERUSER_PASSWORD nor SUPERUSER_MNEMONIC is set, the function
 * logs a warning and skips seeding. The function is idempotent: if a superuser
 * already exists it logs a one-line message and returns without touching the
 * database.
 */

import type { sql as SqlPool } from 'db';
import { getSecret } from '../secrets/index';

export interface SeedSuperuserOptions {
  /** postgres.js connection pool to the app database */
  sql: typeof SqlPool;
}

/**
 * Seed the initial superuser account if none exists.
 *
 * This must be called after migrations and after `initSecrets()` so that
 * `getSecret()` can resolve the required secret keys.
 */
export async function seedSuperuser({ sql }: SeedSuperuserOptions): Promise<void> {
  // Check whether a superuser already exists.
  const existing = await sql`
    SELECT id
    FROM entities
    WHERE type = 'user'
      AND properties->>'role' = 'superuser'
    LIMIT 1
  `;

  if (existing.length > 0) {
    console.log('[seed] Superuser already exists — skipping seeding.');
    return;
  }

  const email = getSecret('SUPERUSER_EMAIL');
  if (!email) {
    console.warn('[seed] SUPERUSER_EMAIL is not set — skipping superuser seeding.');
    return;
  }

  const rawPassword = getSecret('SUPERUSER_PASSWORD');
  const mnemonic = getSecret('SUPERUSER_MNEMONIC');

  let passwordHash: string;

  if (rawPassword) {
    passwordHash = await Bun.password.hash(rawPassword);
  } else if (mnemonic) {
    // BIP-39 mnemonic treated as a UTF-8 passphrase; bcrypt-hash it directly.
    passwordHash = await Bun.password.hash(mnemonic);
  } else {
    console.warn(
      '[seed] Neither SUPERUSER_PASSWORD nor SUPERUSER_MNEMONIC is set — skipping superuser seeding.',
    );
    return;
  }

  const id = crypto.randomUUID();
  const properties = {
    username: email,
    email,
    password_hash: passwordHash,
    role: 'superuser',
  };

  await sql`
    INSERT INTO entities (id, type, properties, tenant_id)
    VALUES (${id}, 'user', ${sql.json(properties as never)}, null)
  `;

  console.log(`[seed] Superuser created with email ${email} (id: ${id}).`);
}
