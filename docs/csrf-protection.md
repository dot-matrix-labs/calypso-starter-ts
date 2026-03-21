# CSRF Double-Submit Cookie Protection

## What it is

A stateless CSRF defence using the double-submit cookie pattern. A random token is set in a
cookie and must be echoed in a request header on every state-mutating request.

## Why it's needed

The starter issues JWTs in HttpOnly cookies. Any app using cookie-based session management is
vulnerable to Cross-Site Request Forgery — a malicious page can trigger state-mutating
requests to the API using the victim's cookies. The double-submit pattern is stateless (no
server-side session storage) and effective for single-origin SPAs.

## How it works

1. On successful login, the server generates a random 32-byte hex token and sets it as a
   cookie:
   ```
   __Host-csrf-token=<token>; HttpOnly=false; SameSite=Strict; Secure; Path=/
   ```
   `HttpOnly=false` is intentional — the browser JS must be able to read this cookie to
   include it in the header.

2. All state-mutating requests (POST, PUT, PATCH, DELETE) must include the token in:
   ```
   X-CSRF-Token: <token>
   ```

3. `verifyCsrf(req)` extracts both values and compares them. Returns 403 if they don't match
   or either is absent.

4. GET/HEAD/OPTIONS are not checked (safe methods per RFC 7231).

## Why this is safe

An attacker on a different origin cannot read the cookie value (same-origin policy prevents
JS on `evil.com` from reading cookies set by `app.com`), so they cannot construct a valid
`X-CSRF-Token` header, even though the browser would automatically send the cookie.

## Configuration

- `CSRF_DISABLED=true` — bypass the check (for test environments and API-key-auth routes)

## Source reference (rinzler)

`apps/server/src/index.ts` — middleware applied before route handlers.

## Files to create / modify

- `apps/server/src/api/csrf.ts` — `verifyCsrf(req)` function + cookie-setting helper
- `apps/server/src/api/auth.ts` — set cookie on login response
- `apps/server/src/index.ts` — apply `verifyCsrf` middleware to mutating routes
