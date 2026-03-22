import { test, expect, beforeEach, afterEach } from 'vitest';
import { generateCsrfToken, csrfCookieHeader, verifyCsrf } from '../../src/auth/csrf';

// ---------------------------------------------------------------------------
// generateCsrfToken
// ---------------------------------------------------------------------------

test('generateCsrfToken returns a 64-character hex string', () => {
  const token = generateCsrfToken();
  expect(token).toMatch(/^[0-9a-f]{64}$/);
});

test('generateCsrfToken returns a different token each call', () => {
  const a = generateCsrfToken();
  const b = generateCsrfToken();
  expect(a).not.toBe(b);
});

// ---------------------------------------------------------------------------
// csrfCookieHeader
// ---------------------------------------------------------------------------

test('csrfCookieHeader includes __Host-csrf-token and SameSite=Strict', () => {
  const header = csrfCookieHeader('abc123');
  expect(header).toContain('__Host-csrf-token=abc123');
  expect(header).toContain('SameSite=Strict');
  expect(header).toContain('Secure');
  expect(header).toContain('Path=/');
  // Must NOT be HttpOnly so browser JS can read it
  expect(header).not.toContain('HttpOnly');
});

// ---------------------------------------------------------------------------
// verifyCsrf
// ---------------------------------------------------------------------------

function makeRequest(method: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', { method, headers });
}

test('verifyCsrf allows safe methods without any token', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const req = makeRequest(method);
    expect(verifyCsrf(req, {})).toBeNull();
  }
});

test('verifyCsrf returns 403 when cookie token is missing', () => {
  const req = makeRequest('POST', { 'X-CSRF-Token': 'abc' });
  const res = verifyCsrf(req, {});
  expect(res).not.toBeNull();
  expect(res!.status).toBe(403);
});

test('verifyCsrf returns 403 when header token is missing', () => {
  const req = makeRequest('POST');
  const res = verifyCsrf(req, { '__Host-csrf-token': 'abc' });
  expect(res).not.toBeNull();
  expect(res!.status).toBe(403);
});

test('verifyCsrf returns 403 when tokens do not match', () => {
  const req = makeRequest('POST', { 'X-CSRF-Token': 'wrong' });
  const res = verifyCsrf(req, { '__Host-csrf-token': 'correct' });
  expect(res).not.toBeNull();
  expect(res!.status).toBe(403);
});

test('verifyCsrf returns null when tokens match on POST', () => {
  const token = generateCsrfToken();
  const req = makeRequest('POST', { 'X-CSRF-Token': token });
  const res = verifyCsrf(req, { '__Host-csrf-token': token });
  expect(res).toBeNull();
});

test('verifyCsrf returns null when tokens match on PATCH', () => {
  const token = 'deadbeef';
  const req = makeRequest('PATCH', { 'X-CSRF-Token': token });
  expect(verifyCsrf(req, { '__Host-csrf-token': token })).toBeNull();
});

test('verifyCsrf returns null when tokens match on DELETE', () => {
  const token = 'deadbeef';
  const req = makeRequest('DELETE', { 'X-CSRF-Token': token });
  expect(verifyCsrf(req, { '__Host-csrf-token': token })).toBeNull();
});

// ---------------------------------------------------------------------------
// CSRF_DISABLED bypass
// ---------------------------------------------------------------------------

beforeEach(() => {
  delete process.env.CSRF_DISABLED;
});

afterEach(() => {
  delete process.env.CSRF_DISABLED;
});

test('verifyCsrf is bypassed when CSRF_DISABLED=true', () => {
  process.env.CSRF_DISABLED = 'true';
  const req = makeRequest('POST');
  // No cookie, no header — should still pass
  expect(verifyCsrf(req, {})).toBeNull();
});

test('verifyCsrf is NOT bypassed when CSRF_DISABLED is unset', () => {
  const req = makeRequest('POST');
  const res = verifyCsrf(req, {});
  expect(res).not.toBeNull();
  expect(res!.status).toBe(403);
});
