# Rate Limiting

## What it is

A zero-dependency, in-process sliding-window rate limiter that throttles requests to
authentication endpoints to prevent brute-force credential attacks and account enumeration.

## Why it's needed

Auth endpoints (login, register, forgot-password, reset-password) are the primary attack
surface for credential-stuffing and brute-force attacks. Without throttling, an attacker can
make unlimited attempts. No external dependency (Redis, etc.) is required — the in-process
Map is sufficient for single-instance deployments.

## How it works

A `RateLimiter` class maintains a `Map<key, number[]>` of request timestamps per client key
(IP address or username). On each request:

1. `check(key)` filters the timestamp array to the current window and returns whether the
   request is allowed.
2. `consume(key)` appends the current timestamp (called only after `check` passes).
3. A shared periodic cleanup timer (every 5 min) evicts expired entries from all singletons.

The cleanup timer calls `.unref()` so it does not prevent process exit.

## Singleton instances

| Instance | Window | Max | Key |
|---|---|---|---|
| `globalLimiter` | 60s | 100 | IP |
| `loginIpLimiter` | 15min | 10 | IP |
| `loginUserLimiter` | 15min | 10 | username |
| `registerIpLimiter` | 60min | 5 | IP |
| `forgotPasswordIpLimiter` | 15min | 3 | IP |
| `forgotPasswordEmailLimiter` | 60min | 3 | email |
| `resetPasswordIpLimiter` | 15min | 5 | IP |

## Response on limit exceeded

HTTP 429 with:

```
Retry-After: <seconds>
X-RateLimit-Limit: <max>
X-RateLimit-Remaining: 0
X-RateLimit-Reset: <unix timestamp>
```

## Configuration

- `RATE_LIMIT_DISABLED=true` — bypass all limits (for test environments)
- `getClientIp(req)` — reads `x-forwarded-for` first, falls back to `127.0.0.1`

## Source reference (rinzler)

`apps/server/src/api/rate-limit.ts` — copy verbatim, no domain-specific logic.

## Files to create

- `apps/server/src/api/rate-limit.ts` — `RateLimiter` class + singletons + helpers
- Integration into `apps/server/src/api/auth.ts` — check/consume per endpoint
