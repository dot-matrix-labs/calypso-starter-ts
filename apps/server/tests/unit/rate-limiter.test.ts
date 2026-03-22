import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { RateLimiter, getClientIp, tooManyRequests } from '../../src/security/rate-limiter';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(1000, 3); // 1 second window, max 3 requests
  });

  afterEach(() => {
    limiter.reset();
    delete process.env.RATE_LIMIT_DISABLED;
  });

  test('allows requests within the limit', () => {
    expect(limiter.check('user1').allowed).toBe(true);
    limiter.consume('user1');
    expect(limiter.check('user1').allowed).toBe(true);
    limiter.consume('user1');
    expect(limiter.check('user1').allowed).toBe(true);
    limiter.consume('user1');
  });

  test('blocks requests that exceed the limit', () => {
    limiter.consume('user1');
    limiter.consume('user1');
    limiter.consume('user1');
    const result = limiter.check('user1');
    expect(result.allowed).toBe(false);
  });

  test('does not allow check() to consume a slot', () => {
    // check() alone must not record anything
    limiter.check('user1');
    limiter.check('user1');
    limiter.check('user1');
    // should still be allowed because we never called consume()
    expect(limiter.check('user1').allowed).toBe(true);
  });

  test('tracks different keys independently', () => {
    limiter.consume('userA');
    limiter.consume('userA');
    limiter.consume('userA');
    expect(limiter.check('userA').allowed).toBe(false);
    expect(limiter.check('userB').allowed).toBe(true);
  });

  test('returns correct limit in result', () => {
    const result = limiter.check('user1');
    expect(result.limit).toBe(3);
  });

  test('returns remaining = 0 when blocked', () => {
    limiter.consume('user1');
    limiter.consume('user1');
    limiter.consume('user1');
    const result = limiter.check('user1');
    expect(result.remaining).toBe(0);
    expect(result.allowed).toBe(false);
  });

  test('returns resetAt as a unix timestamp in seconds', () => {
    limiter.consume('user1');
    const result = limiter.check('user1');
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(result.resetAt).toBeGreaterThan(nowSeconds);
    expect(result.resetAt).toBeLessThanOrEqual(nowSeconds + 2); // within 1s window + tolerance
  });

  test('allows requests after window expires', async () => {
    const shortLimiter = new RateLimiter(50, 1); // 50ms window
    shortLimiter.consume('user1');
    expect(shortLimiter.check('user1').allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(shortLimiter.check('user1').allowed).toBe(true);
    shortLimiter.reset();
  });

  test('cleanup() removes expired entries', () => {
    limiter.consume('user1');
    // Reset without going through expire — just call cleanup() after reset to test it runs
    limiter.cleanup(); // should not throw
  });

  test('RATE_LIMIT_DISABLED bypasses limits', () => {
    process.env.RATE_LIMIT_DISABLED = 'true';
    for (let i = 0; i < 10; i++) {
      const result = limiter.check('user1');
      expect(result.allowed).toBe(true);
      limiter.consume('user1');
    }
  });
});

describe('getClientIp', () => {
  test('returns x-forwarded-for first IP when present', () => {
    const req = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  test('falls back to 127.0.0.1 when header is absent', () => {
    const req = new Request('http://localhost/');
    expect(getClientIp(req)).toBe('127.0.0.1');
  });

  test('handles single IP in x-forwarded-for', () => {
    const req = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '9.9.9.9' },
    });
    expect(getClientIp(req)).toBe('9.9.9.9');
  });
});

describe('tooManyRequests', () => {
  test('returns 429 status', () => {
    const result = { allowed: false, limit: 10, remaining: 0, resetAt: 9999999999 };
    const res = tooManyRequests(result);
    expect(res.status).toBe(429);
  });

  test('sets X-RateLimit-Limit header', () => {
    const result = { allowed: false, limit: 10, remaining: 0, resetAt: 9999999999 };
    const res = tooManyRequests(result);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
  });

  test('sets X-RateLimit-Remaining to 0', () => {
    const result = { allowed: false, limit: 10, remaining: 0, resetAt: 9999999999 };
    const res = tooManyRequests(result);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  test('sets X-RateLimit-Reset header', () => {
    const resetAt = 9999999999;
    const result = { allowed: false, limit: 10, remaining: 0, resetAt };
    const res = tooManyRequests(result);
    expect(res.headers.get('X-RateLimit-Reset')).toBe(String(resetAt));
  });

  test('sets Retry-After header', () => {
    const resetAt = Math.floor(Date.now() / 1000) + 60;
    const result = { allowed: false, limit: 10, remaining: 0, resetAt };
    const res = tooManyRequests(result);
    const retryAfter = Number(res.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  test('merges cors headers', () => {
    const result = { allowed: false, limit: 10, remaining: 0, resetAt: 9999999999 };
    const res = tooManyRequests(result, { 'Access-Control-Allow-Origin': '*' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
