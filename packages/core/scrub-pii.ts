/**
 * @file scrub-pii
 * Recursively traverses any object and replaces values whose keys match a known
 * set of PII field names with "[REDACTED]".  The original object is never
 * mutated — a new object (or the original primitive) is returned.
 */

export const PII_FIELD_NAMES: ReadonlySet<string> = new Set([
  'email',
  'phone',
  'password',
  'display_name',
  'displayName',
  'name',
  'address',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'key',
  'authorization',
]);

/**
 * Recursively redacts PII fields from an arbitrary value before it is written
 * to server logs.
 *
 * - Plain objects: recurse into every key; replace matching keys with "[REDACTED]".
 * - Arrays: recurse into every element.
 * - Primitives (string, number, boolean, null, undefined): returned as-is.
 *
 * @param obj - Any value that might appear in a log statement.
 * @returns A deep copy of `obj` with PII fields redacted.
 */
export function scrubPii(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(scrubPii);
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = PII_FIELD_NAMES.has(k) ? '[REDACTED]' : scrubPii(v);
    }
    return result;
  }

  return obj;
}
