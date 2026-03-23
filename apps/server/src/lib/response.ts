/**
 * Shared response utilities for server API handlers.
 *
 * Exports three helpers that were previously duplicated across multiple API
 * route files:
 *
 * - `json(corsHeaders)` — returns a factory that builds a JSON `Response`
 *   with the correct `Content-Type` header and the provided CORS headers.
 * - `isSuperuser(userId)` — returns true when `userId` matches the
 *   `SUPERUSER_ID` environment variable.
 * - `readProcStdout(stdout)` — reads a Bun child-process stdout stream to a
 *   string, returning `''` for numeric file-descriptors or undefined values.
 *
 * No behaviour is changed; this module is a pure structural extraction.
 */

/**
 * Creates a `json` response helper that captures the given CORS headers.
 *
 * Usage:
 * ```ts
 * const json = makeJson(getCorsHeaders(req));
 * return json({ error: 'Not found' }, 404);
 * ```
 */
export function makeJson(
  corsHeaders: Record<string, string>,
): (body: unknown, status?: number) => Response {
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

/**
 * Returns `true` when `userId` matches the `SUPERUSER_ID` environment
 * variable.  Returns `false` if `SUPERUSER_ID` is not set.
 */
export function isSuperuser(userId: string): boolean {
  const superuserId = process.env.SUPERUSER_ID;
  if (!superuserId) return false;
  return userId === superuserId;
}

/**
 * Reads a Bun child-process stdout stream to a UTF-8 string.
 * Returns an empty string when `stdout` is a raw file-descriptor number or
 * `undefined` (i.e. the process was not spawned with `stdout: 'pipe'`).
 */
export async function readProcStdout(
  stdout: number | ReadableStream<Uint8Array> | undefined,
): Promise<string> {
  if (!stdout || typeof stdout === 'number') return '';
  return new Response(stdout).text();
}
