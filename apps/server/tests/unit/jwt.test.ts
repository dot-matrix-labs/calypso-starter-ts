/**
 * Unit tests for the ES256 JWT implementation (issue #135).
 *
 * Covers:
 * - signJwt produces a JWT with alg=ES256 header
 * - verifyJwt accepts a valid ES256-signed token and rejects a tampered one
 * - JWKS endpoint returns correctly formatted JWK with correct key type and use fields
 * - Key rotation: token signed with old key is accepted; after rotation without old key it is rejected
 * - JTI revocation continues to work with ES256 tokens
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock 'db/revocation' so these unit tests do not need a real Postgres DB.
// ---------------------------------------------------------------------------
vi.mock('db/revocation', () => ({
  isRevoked: vi.fn(async () => false),
}));

import { isRevoked } from 'db/revocation';
const isRevokedMock = isRevoked as ReturnType<typeof vi.fn>;

import {
  signJwt,
  verifyJwt,
  getJwks,
  generateEcKeyPair,
  base64UrlDecode,
  _resetKeyStoreForTest,
  _seedKeyPairForTest,
} from '../../src/auth/jwt';

beforeEach(() => {
  _resetKeyStoreForTest();
  isRevokedMock.mockReset();
  isRevokedMock.mockResolvedValue(false);
});

// ---------------------------------------------------------------------------
// signJwt
// ---------------------------------------------------------------------------

describe('signJwt', () => {
  test('produces a three-part JWT string', async () => {
    const token = await signJwt({ sub: 'user-1' });
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });

  test('header contains alg=ES256', async () => {
    const token = await signJwt({ sub: 'user-1' });
    const [encodedHeader] = token.split('.');
    const header = JSON.parse(base64UrlDecode(encodedHeader));
    expect(header.alg).toBe('ES256');
    expect(header.typ).toBe('JWT');
  });

  test('header contains a kid field', async () => {
    const token = await signJwt({ sub: 'user-1' });
    const [encodedHeader] = token.split('.');
    const header = JSON.parse(base64UrlDecode(encodedHeader));
    expect(typeof header.kid).toBe('string');
    expect(header.kid.length).toBeGreaterThan(0);
  });

  test('payload includes exp and jti', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signJwt({ sub: 'user-1' }, 1);
    const [, encodedPayload] = token.split('.');
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp).toBeGreaterThanOrEqual(before + 3600 - 1);
    expect(typeof payload.jti).toBe('string');
    expect(payload.jti.length).toBeGreaterThan(0);
  });

  test('each call produces a unique jti', async () => {
    const t1 = await signJwt({ sub: 'u' });
    const t2 = await signJwt({ sub: 'u' });
    const p1 = JSON.parse(base64UrlDecode(t1.split('.')[1]));
    const p2 = JSON.parse(base64UrlDecode(t2.split('.')[1]));
    expect(p1.jti).not.toBe(p2.jti);
  });
});

// ---------------------------------------------------------------------------
// verifyJwt
// ---------------------------------------------------------------------------

describe('verifyJwt', () => {
  test('accepts a freshly signed token and returns the payload', async () => {
    const token = await signJwt({ sub: 'user-2', role: 'admin' });
    const payload = await verifyJwt<{ sub: string; role: string }>(token);
    expect(payload.sub).toBe('user-2');
    expect(payload.role).toBe('admin');
  });

  test('rejects a token with a tampered payload', async () => {
    const token = await signJwt({ sub: 'user-3' });
    const parts = token.split('.');
    // Tamper: replace payload with a different base64url-encoded object
    const tamperedPayload = btoa(JSON.stringify({ sub: 'attacker', exp: 9999999999, jti: 'x' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    await expect(verifyJwt(tamperedToken)).rejects.toThrow('Invalid signature');
  });

  test('rejects a token with a tampered signature', async () => {
    const token = await signJwt({ sub: 'user-4' });
    const parts = token.split('.');
    // Flip the last char of the signature
    const sig = parts[2];
    const tamperedSig = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSig}`;
    await expect(verifyJwt(tamperedToken)).rejects.toThrow('Invalid signature');
  });

  test('rejects a token with only two parts', async () => {
    await expect(verifyJwt('header.payload')).rejects.toThrow('Invalid token format');
  });

  test('rejects an expired token', async () => {
    const token = await signJwt({ sub: 'user-5' }, -1 / 3600); // -1 second TTL
    await expect(verifyJwt(token)).rejects.toThrow('Token expired');
  });

  test('rejects a revoked token', async () => {
    isRevokedMock.mockResolvedValue(true);
    const token = await signJwt({ sub: 'user-6' });
    await expect(verifyJwt(token)).rejects.toThrow('Token revoked');
  });

  test('passes the jti to isRevoked', async () => {
    const token = await signJwt({ sub: 'user-7' });
    const [, encodedPayload] = token.split('.');
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    await verifyJwt(token);
    expect(isRevokedMock).toHaveBeenCalledWith(payload.jti);
  });
});

// ---------------------------------------------------------------------------
// getJwks
// ---------------------------------------------------------------------------

describe('getJwks', () => {
  test('returns a keys array with at least one entry', async () => {
    // Trigger key store initialisation via signJwt
    await signJwt({ sub: 'init' });
    const jwks = await getJwks();
    expect(Array.isArray(jwks.keys)).toBe(true);
    expect(jwks.keys.length).toBeGreaterThanOrEqual(1);
  });

  test('each key has correct kty, crv, use, and alg fields', async () => {
    await signJwt({ sub: 'init' });
    const jwks = await getJwks();
    for (const key of jwks.keys as Record<string, unknown>[]) {
      expect(key.kty).toBe('EC');
      expect(key.crv).toBe('P-256');
      expect(key.use).toBe('sig');
      expect(key.alg).toBe('ES256');
      expect(typeof key.x).toBe('string');
      expect(typeof key.y).toBe('string');
      expect(typeof key.kid).toBe('string');
    }
  });

  test('does not expose the private key (no "d" field)', async () => {
    await signJwt({ sub: 'init' });
    const jwks = await getJwks();
    for (const key of jwks.keys as Record<string, unknown>[]) {
      expect(key.d).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Key rotation
// ---------------------------------------------------------------------------

describe('key rotation', () => {
  test('token signed with old key is accepted during transition window', async () => {
    // Establish "old" key pair and sign a token
    const oldKeyPair = await generateEcKeyPair();
    _seedKeyPairForTest(oldKeyPair);
    const tokenSignedWithOldKey = await signJwt({ sub: 'rotation-test' });

    // Rotate: new key pair is current, old key pair moves to "old" slot
    const newKeyPair = await generateEcKeyPair();
    _seedKeyPairForTest(newKeyPair, oldKeyPair);

    // Token signed with old key should still verify
    const payload = await verifyJwt<{ sub: string }>(tokenSignedWithOldKey);
    expect(payload.sub).toBe('rotation-test');
  });

  test('token signed with old key is rejected after old key is removed', async () => {
    // Sign with old key
    const oldKeyPair = await generateEcKeyPair();
    _seedKeyPairForTest(oldKeyPair);
    const tokenSignedWithOldKey = await signJwt({ sub: 'post-rotation' });

    // Rotate with no old key in rotation window
    const newKeyPair = await generateEcKeyPair();
    _seedKeyPairForTest(newKeyPair); // no old key

    await expect(verifyJwt(tokenSignedWithOldKey)).rejects.toThrow('Invalid signature');
  });

  test('token signed with new key is accepted after rotation', async () => {
    const oldKeyPair = await generateEcKeyPair();
    const newKeyPair = await generateEcKeyPair();
    _seedKeyPairForTest(newKeyPair, oldKeyPair);
    const token = await signJwt({ sub: 'new-key-user' });
    const payload = await verifyJwt<{ sub: string }>(token);
    expect(payload.sub).toBe('new-key-user');
  });

  test('JWKS returns two keys during transition window', async () => {
    const oldKeyPair = await generateEcKeyPair();
    const newKeyPair = await generateEcKeyPair();
    _seedKeyPairForTest(newKeyPair, oldKeyPair);
    const jwks = await getJwks();
    expect(jwks.keys.length).toBe(2);
    // Ensure both kids are different
    const keys = jwks.keys as Record<string, string>[];
    expect(keys[0].kid).not.toBe(keys[1].kid);
  });
});
