/**
 * Task payload validation — opaque references only, PII key denylist (issue #45).
 *
 * Queue payloads must contain only opaque resource identifiers (TQ-P-002).
 * Workers fetch data through the authenticated API at execution time; the
 * queue row itself must never carry raw PII.
 */

/** Keys forbidden in task payloads to prevent PII leakage (TQ-P-002). */
export const PAYLOAD_PII_DENYLIST = new Set([
  'email',
  'name',
  'address',
  'phone',
  'ssn',
  'content',
  'body',
  'message',
  'text',
  'description',
  'title',
  'subject',
  'password',
  'secret',
  'token',
]);

export class PayloadValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'PayloadValidationError';
  }
}

/**
 * Validate that `payload` is a flat JSON object and contains no PII keys.
 *
 * Throws `PayloadValidationError` (HTTP 400) if:
 *   - `payload` is not a plain object (null, array, or primitive), or
 *   - any top-level key matches `PAYLOAD_PII_DENYLIST` (case-insensitive).
 *
 * Allowed keys are opaque identifiers such as `task_id`, `user_id`,
 * `entity_id`, `correlation_id`, `job_type`, `ref`, `batch_id`, etc.
 */
export function validateTaskPayload(payload: unknown): asserts payload is Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new PayloadValidationError('payload must be a flat JSON object');
  }

  for (const key of Object.keys(payload)) {
    if (PAYLOAD_PII_DENYLIST.has(key.toLowerCase())) {
      throw new PayloadValidationError(
        `payload key "${key}" is not allowed — use a resource ID reference instead`,
      );
    }
  }
}
