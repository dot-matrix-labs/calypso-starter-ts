import { describe, expect, it } from 'vitest';
import { scrubPii, PII_FIELD_NAMES } from './scrub-pii';

describe('scrubPii', () => {
  it('returns primitives unchanged', () => {
    expect(scrubPii('hello')).toBe('hello');
    expect(scrubPii(42)).toBe(42);
    expect(scrubPii(true)).toBe(true);
    expect(scrubPii(null)).toBeNull();
    expect(scrubPii(undefined)).toBeUndefined();
  });

  it('redacts a top-level PII field', () => {
    expect(scrubPii({ email: 'user@example.com' })).toEqual({ email: '[REDACTED]' });
  });

  it('redacts all known PII field names', () => {
    const input: Record<string, unknown> = {};
    for (const field of PII_FIELD_NAMES) {
      input[field] = 'sensitive-value';
    }
    const result = scrubPii(input) as Record<string, unknown>;
    for (const field of PII_FIELD_NAMES) {
      expect(result[field]).toBe('[REDACTED]');
    }
  });

  it('preserves non-PII fields', () => {
    const result = scrubPii({ id: '123', status: 'active' });
    expect(result).toEqual({ id: '123', status: 'active' });
  });

  it('recursively scrubs nested objects', () => {
    const input = {
      user: {
        id: 'u1',
        email: 'secret@example.com',
        profile: {
          displayName: 'Alice',
          bio: 'Likes coding',
        },
      },
    };
    expect(scrubPii(input)).toEqual({
      user: {
        id: 'u1',
        email: '[REDACTED]',
        profile: {
          displayName: '[REDACTED]',
          bio: 'Likes coding',
        },
      },
    });
  });

  it('recursively scrubs PII inside arrays', () => {
    const input = [{ email: 'a@b.com' }, { email: 'c@d.com', id: '2' }];
    expect(scrubPii(input)).toEqual([{ email: '[REDACTED]' }, { email: '[REDACTED]', id: '2' }]);
  });

  it('handles arrays nested within objects', () => {
    const input = {
      users: [{ email: 'a@b.com', id: '1' }],
      count: 1,
    };
    expect(scrubPii(input)).toEqual({
      users: [{ email: '[REDACTED]', id: '1' }],
      count: 1,
    });
  });

  it('does not mutate the original object', () => {
    const original = { email: 'secret@example.com', id: 'x' };
    scrubPii(original);
    expect(original.email).toBe('secret@example.com');
  });

  it('handles an empty object', () => {
    expect(scrubPii({})).toEqual({});
  });

  it('handles an empty array', () => {
    expect(scrubPii([])).toEqual([]);
  });

  it('redacts authorization header values', () => {
    const input = { authorization: 'Bearer secret-jwt-token' };
    expect(scrubPii(input)).toEqual({ authorization: '[REDACTED]' });
  });

  it('redacts token, access_token, and refresh_token', () => {
    const input = { token: 't1', access_token: 'at', refresh_token: 'rt', id: '1' };
    expect(scrubPii(input)).toEqual({
      token: '[REDACTED]',
      access_token: '[REDACTED]',
      refresh_token: '[REDACTED]',
      id: '1',
    });
  });
});
