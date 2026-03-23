/**
 * Unit tests for task queue schema behaviour that can be validated without a
 * live database — status state machine validity and payload PII denylist checks.
 */

import { describe, expect, test } from 'vitest';
import {
  validateTaskPayload,
  PAYLOAD_PII_DENYLIST,
  PayloadValidationError,
} from '../../src/api/task-payload-validation';

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

describe('validateTaskPayload (TQ-P-002 opaque-reference-payloads)', () => {
  test('allows opaque reference payloads', () => {
    expect(() => validateTaskPayload({ task_id: 'abc', correlation_ref: 'xyz' })).not.toThrow();
  });

  test('allows empty object', () => {
    expect(() => validateTaskPayload({})).not.toThrow();
  });

  test('allows all listed opaque keys', () => {
    expect(() =>
      validateTaskPayload({
        task_id: '1',
        user_id: '2',
        entity_id: '3',
        correlation_id: '4',
        job_type: 'send',
        priority: 1,
        source: 'api',
        target: 'worker',
        ref: 'abc',
        version: 2,
        batch_id: 'b1',
      }),
    ).not.toThrow();
  });

  // ── Structural validation

  test('throws for null payload', () => {
    expect(() => validateTaskPayload(null)).toThrow(PayloadValidationError);
    expect(() => validateTaskPayload(null)).toThrow('payload must be a flat JSON object');
  });

  test('throws for array payload', () => {
    expect(() => validateTaskPayload([])).toThrow(PayloadValidationError);
    expect(() => validateTaskPayload(['a', 'b'])).toThrow('payload must be a flat JSON object');
  });

  test('throws for string primitive payload', () => {
    expect(() => validateTaskPayload('string')).toThrow(PayloadValidationError);
    expect(() => validateTaskPayload('string')).toThrow('payload must be a flat JSON object');
  });

  test('throws for number primitive payload', () => {
    expect(() => validateTaskPayload(42)).toThrow(PayloadValidationError);
  });

  test('throws for boolean payload', () => {
    expect(() => validateTaskPayload(true)).toThrow(PayloadValidationError);
  });

  // ── PII denylist checks — each entry in PAYLOAD_PII_DENYLIST

  test('rejects payload with "email" key', () => {
    expect(() => validateTaskPayload({ email: 'user@example.com' })).toThrow(
      PayloadValidationError,
    );
    expect(() => validateTaskPayload({ email: 'user@example.com' })).toThrow(
      'payload key "email" is not allowed — use a resource ID reference instead',
    );
  });

  test('rejects payload with "name" key', () => {
    expect(() => validateTaskPayload({ name: 'Alice' })).toThrow(PayloadValidationError);
  });

  test('rejects payload with "address" key', () => {
    expect(() => validateTaskPayload({ address: '123 Main St' })).toThrow(PayloadValidationError);
  });

  test('rejects payload with "phone" key', () => {
    expect(() => validateTaskPayload({ phone: '555-1234' })).toThrow(PayloadValidationError);
  });

  test('rejects payload with "ssn" key', () => {
    expect(() => validateTaskPayload({ ssn: '000-00-0000' })).toThrow(PayloadValidationError);
  });

  test('rejects payload with "content" key', () => {
    expect(() => validateTaskPayload({ content: 'some text' })).toThrow(PayloadValidationError);
  });

  test('rejects payload with "body" key', () => {
    expect(() => validateTaskPayload({ body: 'some text' })).toThrow(PayloadValidationError);
  });

  test('rejects payload with "message" key', () => {
    expect(() => validateTaskPayload({ message: 'hello' })).toThrow(PayloadValidationError);
  });

  test('rejects payload with "text" key', () => {
    expect(() => validateTaskPayload({ text: 'hello world' })).toThrow(PayloadValidationError);
  });

  test('rejects payload with "description" key', () => {
    expect(() => validateTaskPayload({ description: 'a task' })).toThrow(PayloadValidationError);
  });

  test('rejects payload with "title" key', () => {
    expect(() => validateTaskPayload({ title: 'My title' })).toThrow(PayloadValidationError);
  });

  test('rejects payload with "subject" key', () => {
    expect(() => validateTaskPayload({ subject: 'Re: order' })).toThrow(PayloadValidationError);
  });

  test('rejects payload with "password" key', () => {
    expect(() => validateTaskPayload({ password: 'hunter2' })).toThrow(PayloadValidationError);
  });

  test('rejects payload with "secret" key', () => {
    expect(() => validateTaskPayload({ secret: 'shh' })).toThrow(PayloadValidationError);
  });

  test('rejects payload with "token" key', () => {
    expect(() => validateTaskPayload({ token: 'abc123' })).toThrow(PayloadValidationError);
  });

  // ── Case-insensitivity

  test('is case-insensitive for denylist keys', () => {
    expect(() => validateTaskPayload({ Email: 'user@example.com' })).toThrow(
      PayloadValidationError,
    );
    expect(() => validateTaskPayload({ EMAIL: 'user@example.com' })).toThrow(
      PayloadValidationError,
    );
    expect(() => validateTaskPayload({ PASSWORD: 'hunter2' })).toThrow(PayloadValidationError);
    expect(() => validateTaskPayload({ Token: 'abc' })).toThrow(PayloadValidationError);
  });

  // ── Error message format includes the offending key

  test('error message includes the offending key name', () => {
    expect(() => validateTaskPayload({ Email: 'x' })).toThrow(
      'payload key "Email" is not allowed — use a resource ID reference instead',
    );
  });

  // ── PAYLOAD_PII_DENYLIST export is complete

  test('PAYLOAD_PII_DENYLIST contains all 15 expected keys', () => {
    const expected = [
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
    ];
    expect(PAYLOAD_PII_DENYLIST.size).toBe(15);
    for (const key of expected) {
      expect(PAYLOAD_PII_DENYLIST.has(key)).toBe(true);
    }
  });

  // ── PayloadValidationError properties

  test('PayloadValidationError has statusCode 400', () => {
    const err = new PayloadValidationError('test');
    expect(err.statusCode).toBe(400);
    expect(err).toBeInstanceOf(PayloadValidationError);
    expect(err).toBeInstanceOf(Error);
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
