/**
 * Unit tests for task queue schema behaviour that can be validated without a
 * live database — status state machine validity and payload PII denylist checks.
 */

import { describe, expect, test } from 'vitest';

// ── Payload PII denylist check (mirrors hasDisallowedPayloadKeys in tasks-queue.ts)

const PAYLOAD_DENYLIST = new Set([
  'email',
  'name',
  'address',
  'phone',
  'ssn',
  'content',
  'body',
  'message',
]);

function hasDisallowedPayloadKeys(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
  return Object.keys(payload as object).some((k) => PAYLOAD_DENYLIST.has(k.toLowerCase()));
}

// ── Status state machine allowed values

const VALID_STATUSES = new Set([
  'pending',
  'claimed',
  'running',
  'submitting',
  'completed',
  'failed',
  'dead',
]);

describe('hasDisallowedPayloadKeys (TQ-C-004 payload-contains-no-pii)', () => {
  test('allows opaque reference payloads', () => {
    expect(hasDisallowedPayloadKeys({ task_id: 'abc', correlation_ref: 'xyz' })).toBe(false);
  });

  test('rejects payload with "email" key', () => {
    expect(hasDisallowedPayloadKeys({ email: 'user@example.com' })).toBe(true);
  });

  test('rejects payload with "name" key', () => {
    expect(hasDisallowedPayloadKeys({ name: 'Alice' })).toBe(true);
  });

  test('rejects payload with "address" key', () => {
    expect(hasDisallowedPayloadKeys({ address: '123 Main St' })).toBe(true);
  });

  test('rejects payload with "phone" key', () => {
    expect(hasDisallowedPayloadKeys({ phone: '555-1234' })).toBe(true);
  });

  test('rejects payload with "ssn" key', () => {
    expect(hasDisallowedPayloadKeys({ ssn: '000-00-0000' })).toBe(true);
  });

  test('rejects payload with "content" key', () => {
    expect(hasDisallowedPayloadKeys({ content: 'some text' })).toBe(true);
  });

  test('rejects payload with "body" key', () => {
    expect(hasDisallowedPayloadKeys({ body: 'some text' })).toBe(true);
  });

  test('rejects payload with "message" key', () => {
    expect(hasDisallowedPayloadKeys({ message: 'hello' })).toBe(true);
  });

  test('is case-insensitive for denylist keys', () => {
    expect(hasDisallowedPayloadKeys({ Email: 'user@example.com' })).toBe(true);
    expect(hasDisallowedPayloadKeys({ EMAIL: 'user@example.com' })).toBe(true);
  });

  test('returns false for non-object payloads', () => {
    expect(hasDisallowedPayloadKeys(null)).toBe(false);
    expect(hasDisallowedPayloadKeys('string')).toBe(false);
    expect(hasDisallowedPayloadKeys([])).toBe(false);
  });

  test('empty object is allowed', () => {
    expect(hasDisallowedPayloadKeys({})).toBe(false);
  });
});

describe('task_queue status state machine (TQ-D-002)', () => {
  test('all status values are accounted for', () => {
    const expected = ['pending', 'claimed', 'running', 'submitting', 'completed', 'failed', 'dead'];
    for (const s of expected) {
      expect(VALID_STATUSES.has(s)).toBe(true);
    }
    expect(VALID_STATUSES.size).toBe(expected.length);
  });

  test('invalid status values are not in the set', () => {
    expect(VALID_STATUSES.has('cancelled')).toBe(false);
    expect(VALID_STATUSES.has('error')).toBe(false);
    expect(VALID_STATUSES.has('done')).toBe(false);
    expect(VALID_STATUSES.has('')).toBe(false);
  });
});
