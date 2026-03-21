# AJV JSON Schema Validation

## What it is

Request body validation using AJV (Another JSON Validator), replacing ad-hoc `if` checks
with a shared `validate(schema, data)` helper that returns structured errors with field paths.

## Why it's needed

The current API handlers validate request bodies with manual conditionals. This produces
inconsistent error messages, misses nested field validation, has no machine-readable error
format for clients, and requires each handler to re-implement the same pattern.

## API

```ts
// apps/server/src/api/validation.ts
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

export function validate<T>(
  schema: object,
  data: unknown,
): { valid: true; data: T } | { valid: false; errors: Ajv.ErrorObject[] } {
  const isValid = ajv.validate(schema, data);
  if (isValid) return { valid: true, data: data as T };
  return { valid: false, errors: ajv.errors! };
}
```

## Error response format

On validation failure, handlers return HTTP 400:

```json
{
  "error": "Validation failed",
  "details": [
    { "instancePath": "/name", "message": "must have required property 'name'" },
    { "instancePath": "/priority", "message": "must be equal to one of the allowed values" }
  ]
}
```

The `instancePath` field gives the exact JSON pointer to the failing field, making errors
actionable for both humans and clients.

## Schema location

Entity schemas are defined in `packages/core/types.ts` and exported for use in:

- Server-side validation (via `validate()`)
- Integration test fixtures
- Future: `GET /api/schema` introspection endpoint

## Dependency

```json
// apps/server/package.json
"ajv": "^8.18.0"
```

## Source reference (rinzler)

`apps/server/src/api/entity-validation.ts` — contains the AJV setup. Extract the generic
`validate()` helper; the entity-specific schemas are rinzler-specific.
`packages/core/index.ts` — bulk upload schema definitions (pattern for schema export).

## Files to create / modify

- `apps/server/src/api/validation.ts` — `validate()` helper
- `packages/core/types.ts` — add JSON schemas for `Task`, `User`
- `apps/server/src/api/tasks.ts` — replace manual validation
- `apps/server/src/api/auth.ts` — replace manual validation
