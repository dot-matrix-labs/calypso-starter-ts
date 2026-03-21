# Field-Level Encryption

## What it is

AES-256-GCM encryption for PII fields at rest, implemented using the Web Crypto API (built
into Bun). Keys are HKDF-derived from a single master secret, one key per entity type.

## Why it's needed

Database dumps, backup files, and direct database access expose all stored data in plaintext.
Field-level encryption ensures that even with full database read access, PII fields (email,
display name, phone, address) are unreadable without the master key.

## Encrypted value format

```
enc:v1:<base64-iv>:<base64-ciphertext+auth-tag>
```

This format is self-describing:
- The `enc:v1:` prefix makes encrypted values identifiable in any tool.
- Values not starting with `enc:v1:` pass through `decryptField` unchanged — safe migration
  path for existing plaintext rows.

## Key derivation

A single `ENCRYPTION_MASTER_KEY` environment variable holds the master secret. Per-entity
keys are derived via HKDF (SHA-256), using the entity type name as HKDF `info`. Derived keys
are cached in memory after first derivation to avoid repeated HKDF calls.

## API

```ts
encryptField(entityType: string, plaintext: string): Promise<string>
decryptField(entityType: string, value: string): Promise<string>

encryptProperties(entityType: string, record: Record<string, unknown>): Promise<Record<string, unknown>>
decryptProperties(entityType: string, record: Record<string, unknown>): Promise<Record<string, unknown>>
```

`encryptProperties` / `decryptProperties` operate on JSONB property objects, encrypting only
the fields listed in `SENSITIVE_FIELDS` for the given entity type.

## Graceful degradation

- `ENCRYPTION_MASTER_KEY` not set → all functions pass data through unchanged.
- `ENCRYPTION_DISABLED=true` → same passthrough behaviour.

This means local development and tests require no configuration.

## Sensitive fields registry

```ts
const SENSITIVE_FIELDS: Record<string, string[]> = {
  user: ['display_name', 'email'],
  // extend as the data model grows
};
```

## Source reference (rinzler)

`packages/db/encryption.ts` — copy verbatim, update `SENSITIVE_FIELDS` for the starter's
entity types.
`packages/db/tests/encryption.test.ts` — unit tests for round-trips and passthrough.

## Files to create / modify

- `packages/db/encryption.ts`
- `packages/db/tests/encryption.test.ts`
- `apps/server/src/api/auth.ts` — encrypt `display_name` on user create/update, decrypt on read
