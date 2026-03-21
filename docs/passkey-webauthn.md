# Passkey / WebAuthn Authentication

## What it is

A phishing-resistant, passwordless authentication flow using WebAuthn credentials (passkeys)
backed by device biometrics or hardware security keys. Implemented with the SimpleWebAuthn
library.

## Why it's needed

Passwords are the primary attack vector for account takeover: phishing, credential stuffing,
and brute force all target the password. Passkeys are:

- **Phishing-resistant** — the credential is cryptographically bound to the origin. A
  fake site cannot receive a passkey authentication even if the user is tricked into visiting it.
- **No shared secret** — the server stores only a public key. There is nothing to steal from
  the database that enables login.
- **Native UX** — Touch ID, Face ID, Windows Hello, and hardware keys are all supported
  without any additional software.

## Dependencies

```json
"@simplewebauthn/browser": "^13.3.0",
"@simplewebauthn/server": "^13.3.0"
```

## Ceremonies

### Registration

```
Client                               Server
  |  POST /api/auth/passkey/register/begin  |
  |  ─────────────────────────────────────> |
  |  PublicKeyCredentialCreationOptions      |
  |  <───────────────────────────────────── |
  |                                         |
  |  [user authenticates with biometric]    |
  |                                         |
  |  POST /api/auth/passkey/register/complete |
  |  (attestation response)                 |
  |  ─────────────────────────────────────> |
  |  { verified: true }                     |
  |  <───────────────────────────────────── |
```

Server stores the credential in `passkey_credentials` entity type.

### Authentication

```
Client                               Server
  |  POST /api/auth/passkey/login/begin     |
  |  ─────────────────────────────────────> |
  |  PublicKeyCredentialRequestOptions      |
  |  <───────────────────────────────────── |
  |                                         |
  |  [user authenticates with biometric]    |
  |                                         |
  |  POST /api/auth/passkey/login/complete  |
  |  (assertion response)                   |
  |  ─────────────────────────────────────> |
  |  { token: "jwt...", user: {...} }        |
  |  <───────────────────────────────────── |
```

Server verifies the assertion, increments the credential counter, and issues a JWT.

## Credential storage

The `passkey_credentials` entity type in the property graph:

```ts
{
  credential_id: string,    // base64url-encoded credential ID
  public_key: string,       // CBOR-encoded public key (base64url)
  counter: number,          // sign count for clone detection
  user_id: string,          // FK to users
  aaguid: string,           // authenticator model identifier
  transports: string[],     // ['internal', 'hybrid', 'usb', ...]
}
```

## Replay protection

The challenge is a random 32-byte value stored in a short-lived signed cookie (or a DB row
with a 5-minute TTL). Reusing a previous authentication response fails because the challenge
no longer exists.

## Counter-based clone detection

Each successful authentication must present a `counter` value higher than the stored one.
If the counter is equal or lower, the credential may have been cloned — the server rejects
the authentication and should alert the user.

## Browser integration

In `apps/web/src/components/Login.tsx`:

```ts
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

// Registration button click
const options = await fetch('/api/auth/passkey/register/begin').then((r) => r.json());
const response = await startRegistration(options);
await fetch('/api/auth/passkey/register/complete', {
  method: 'POST',
  body: JSON.stringify(response),
  headers: { 'Content-Type': 'application/json' },
});

// Login button click
const options = await fetch('/api/auth/passkey/login/begin').then((r) => r.json());
const response = await startAuthentication(options);
const { token } = await fetch('/api/auth/passkey/login/complete', {
  method: 'POST',
  body: JSON.stringify(response),
  headers: { 'Content-Type': 'application/json' },
}).then((r) => r.json());
```

## Source reference (rinzler)

`apps/server/src/api/passkey.ts` — copy and adapt. The implementation is not domain-specific.

## Files to create / modify

- `apps/server/src/api/passkey.ts` — registration and authentication endpoints
- `packages/db/schema.sql` — add `passkey_credentials` entity type seed
- `apps/web/src/components/Login.tsx` — add passkey UI buttons
- `apps/web/package.json` — add `@simplewebauthn/browser`
- `apps/server/package.json` — add `@simplewebauthn/server`
