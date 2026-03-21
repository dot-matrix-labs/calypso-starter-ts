# Dual Logging (Chronological + Deduplicated)

## What it is

Two parallel log outputs: a chronological log file (`app.log`) that records every event in
order, and a deduplicated summary file (`uniques.log`) that records each distinct message
template only once. The chronological log is the complete record; the deduplicated log is the
diagnostic entry point for agents reading logs to investigate issues.

## Why it's needed

A production bug that fires on every request generates thousands of identical log lines. An
AI agent reading those logs fills its context window with repetition before reaching the root
cause. A deduplicated `uniques.log` lets the agent see the full error signature immediately
without context pressure.

Without structured, machine-parseable logs, agents cannot efficiently diagnose production
issues — they were the primary design constraint driving this pattern.

## Log structure

Every log entry is a JSON line:

```json
{
  "ts": "2025-01-15T10:23:45.123Z",
  "level": "error",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Database query failed",
  "error": "connection timeout",
  "path": "/api/tasks",
  "duration_ms": 5001
}
```

## Deduplication key

The deduplication key is a hash of `level + message_template` (with dynamic values stripped):

```ts
function deduplicationKey(entry: LogEntry): string {
  // Strip UUIDs, numbers, timestamps from message for dedup
  const template = entry.message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '<ts>')
    .replace(/\b\d+\b/g, '<n>');
  return `${entry.level}:${template}`;
}
```

## Logger implementation

```ts
const seen = new Set<string>();

function log(level: LogLevel, message: string, context: object = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  // Always write to chronological log
  appendFileSync('logs/app.log', JSON.stringify(entry) + '\n');

  // Write to uniques.log only on first occurrence of this message template
  const key = deduplicationKey(entry);
  if (!seen.has(key)) {
    seen.add(key);
    appendFileSync(
      'logs/uniques.log',
      JSON.stringify({
        ...entry,
        first_seen: entry.ts,
      }) + '\n',
    );
  }
}
```

## Log rotation

Both files are rotated daily with a 30-day retention policy:

```ts
// Rotate on startup if log is from a previous day
function maybeRotateLogs() {
  const today = new Date().toISOString().slice(0, 10);
  const stat = statSync('logs/app.log', { throwIfNoEntry: false });
  if (stat && stat.mtime.toISOString().slice(0, 10) !== today) {
    renameSync('logs/app.log', `logs/app.${stat.mtime.toISOString().slice(0, 10)}.log`);
    renameSync('logs/uniques.log', `logs/uniques.${stat.mtime.toISOString().slice(0, 10)}.log`);
  }
}
```

Old log files beyond 30 days are deleted on startup.

## Files written

| File                          | Purpose                             | Retention |
| ----------------------------- | ----------------------------------- | --------- |
| `logs/app.log`                | Complete chronological record       | 30 days   |
| `logs/uniques.log`            | Deduplicated diagnostic entry point | 30 days   |
| `logs/app.YYYY-MM-DD.log`     | Rotated daily                       | 30 days   |
| `logs/uniques.YYYY-MM-DD.log` | Rotated daily                       | 30 days   |

## Blueprint references

- `DEPLOY-P-003` `logs-are-for-machines-first`
- `DEPLOY-T-004` `context-window-filled-by-duplicate-errors` — this pattern mitigates it
- `DEPLOY-T-002` `disk-exhaustion-from-unrotated-logs` — rotation policy prevents this

## Dependencies

- **Trace ID propagation** (`docs/trace-id-propagation.md`) — `trace_id` field in all log entries

## Files to create / modify

- `apps/server/src/lib/logger.ts` — `log()` with dual-write and deduplication
- `apps/server/src/index.ts` — `maybeRotateLogs()` on startup
- `apps/server/src/lib/logger.test.ts` — unit test: duplicate messages write to uniques.log once
