# PII Log Scrubbing

## What it is

A recursive object scrubber that replaces values for known PII field names with
`"[REDACTED]"` before they are written to server logs.

## Why it's needed

Server logs often include request context, error objects, and database records. Without
scrubbing, fields like `email`, `display_name`, and `password` appear in plaintext in
log files. This creates a compliance risk (GDPR, LGPD, etc.) and unnecessary data
exposure in observability tooling.

## How it works

`scrubPii(obj: unknown): unknown` recursively traverses an object:

- If the value is a plain object, it recurses into each key.
- If a key matches a known PII field name, its value is replaced with `"[REDACTED]"`.
- Non-object primitives and arrays are handled appropriately.
- The original object is not mutated — a new object is returned.

The server's error handler wraps all logged objects through `scrubPii` before output.

## Scrubbed field names

```
email, phone, password, display_name, displayName, name, address, token,
access_token, refresh_token, secret, key, authorization
```

This list should be extended as the data model grows.

## What it does NOT do

- Does not scrub HTTP request/response bodies at the network layer.
- Does not scrub log files that have already been written.
- Does not integrate with structured logging pipelines (that's a separate concern).

## Source reference (rinzler)

`apps/server/src/api/pii-scrubber.ts` — copy verbatim, extend field list as needed.

## Files to create / modify

- `apps/server/src/api/pii-scrubber.ts` — `scrubPii` function
- `apps/server/src/index.ts` — wrap error handler logging with `scrubPii`
