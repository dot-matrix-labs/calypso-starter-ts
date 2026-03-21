# Trace ID Propagation

## What it is

A single trace ID that follows a request from browser through the API server to the database
and back to the browser. Every component tags its work with the same trace ID. Diagnosing any
workflow is a filter by trace ID, not a timestamp correlation exercise across separate log files.

## Why it's needed

Without trace IDs, correlating a browser error with its server-side cause requires timestamp
guessing across multiple log files. For AI agents diagnosing production issues by reading logs,
timestamp correlation is slow and error-prone. A trace ID makes the full request lifecycle
instantly reconstructable from a single filter.

## Flow

```
Browser
  → generates X-Trace-Id: <uuid> on every fetch()
  → sends as request header

API server (middleware)
  → reads X-Trace-Id from request header (or generates one if absent)
  → attaches to request context: req.traceId
  → includes in every log entry: { trace_id: req.traceId, ... }
  → passes to DB as session variable: SET LOCAL app.trace_id = '<uuid>'
  → returns X-Trace-Id header in response

PostgreSQL
  → log entries include application_name or session variable
  → audit_events table: correlation_id column stores trace_id

Browser
  → reads X-Trace-Id from response header
  → includes in error reports sent to /api/errors
```

## Server middleware

```ts
app.use((req, res, next) => {
  req.traceId = (req.headers['x-trace-id'] as string) ?? crypto.randomUUID();
  res.setHeader('X-Trace-Id', req.traceId);
  next();
});
```

## Database session variable

```ts
// In the query helper, prepend SET LOCAL for tracing
async function query(sql: string, params: unknown[], traceId?: string) {
  if (traceId) {
    await pool.query(`SET LOCAL app.trace_id = '${traceId}'`);
  }
  return pool.query(sql, params);
}
```

The `app.trace_id` session variable is visible in `pg_stat_activity` and PostgreSQL logs
when `log_min_duration_statement` is enabled.

## Browser fetch wrapper

```ts
const traceId = crypto.randomUUID();

async function tracedFetch(url: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'X-Trace-Id': traceId,
    },
  });
}
```

The `traceId` is generated once per page load, so all requests from a single session share
a trace prefix. Individual requests use `traceId + '-' + requestIndex` to distinguish
concurrent requests while preserving the session correlation.

## Log format

All server log entries include `trace_id`:

```json
{
  "ts": "2025-01-15T10:23:45.123Z",
  "level": "info",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "method": "POST",
  "path": "/api/tasks",
  "status": 201,
  "duration_ms": 42
}
```

## Audit log correlation

The `audit_events.correlation_id` column stores the trace ID, linking audit entries to the
full request log:

```ts
await emitAuditEvent({
  actor_id: req.user.id,
  action: 'task.create',
  entity_type: 'task',
  entity_id: task.id,
  correlation_id: req.traceId, // ← trace linkage
  after: task,
});
```

## Blueprint reference

- `DEPLOY-P-004` `traces-span-the-full-stack`
- `DEPLOY-T-004` `context-window-filled-by-duplicate-errors` — trace IDs make dedup by trace possible

## Files to create / modify

- `apps/server/src/middleware/trace.ts` — trace ID middleware
- `apps/server/src/lib/logger.ts` — include `trace_id` in all log entries
- `apps/server/src/lib/db.ts` — `SET LOCAL app.trace_id` in query helper
- `apps/web/src/lib/fetch.ts` — `tracedFetch()` wrapper with browser-side trace ID
