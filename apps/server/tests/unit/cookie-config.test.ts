/**
 * Unit tests for auth/cookie-config module.
 */

import { describe, test, expect, afterEach } from 'vitest';
import {
  COOKIE_NAME_PLAIN,
  COOKIE_NAME_SECURE,
  isSecureCookies,
  getAuthCookieName,
  authCookieHeader,
  authCookieClearHeader,
  getAuthToken,
} from '../../src/auth/cookie-config';

describe('cookie-config', () => {
  afterEach(() => {
    delete process.env.SECURE_COOKIES;
  });

  describe('isSecureCookies', () => {
    test('returns false when SECURE_COOKIES is unset', () => {
      delete process.env.SECURE_COOKIES;
      expect(isSecureCookies()).toBe(false);
    });

    test('returns false when SECURE_COOKIES is empty', () => {
      process.env.SECURE_COOKIES = '';
      expect(isSecureCookies()).toBe(false);
    });

    test('returns true when SECURE_COOKIES=true', () => {
      process.env.SECURE_COOKIES = 'true';
      expect(isSecureCookies()).toBe(true);
    });

    test('returns false when SECURE_COOKIES=false', () => {
      process.env.SECURE_COOKIES = 'false';
      expect(isSecureCookies()).toBe(false);
    });
  });

  describe('getAuthCookieName', () => {
    test('returns plain name in dev mode', () => {
      delete process.env.SECURE_COOKIES;
      expect(getAuthCookieName()).toBe(COOKIE_NAME_PLAIN);
    });

    test('returns __Host- name in HTTPS mode', () => {
      process.env.SECURE_COOKIES = 'true';
      expect(getAuthCookieName()).toBe(COOKIE_NAME_SECURE);
    });
  });

  describe('authCookieHeader', () => {
    test('dev mode: plain name, SameSite=Strict, no Secure', () => {
      delete process.env.SECURE_COOKIES;
      const header = authCookieHeader('tok123');
      expect(header).toBe('calypso_auth=tok123; HttpOnly; Path=/; SameSite=Strict; Max-Age=604800');
    });

    test('HTTPS mode: __Host- prefix, Secure, SameSite=Lax', () => {
      process.env.SECURE_COOKIES = 'true';
      const header = authCookieHeader('tok123');
      expect(header).toBe(
        '__Host-calypso_auth=tok123; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=604800',
      );
    });
  });

  describe('authCookieClearHeader', () => {
    test('dev mode clears plain name', () => {
      delete process.env.SECURE_COOKIES;
      const header = authCookieClearHeader();
      expect(header).toContain('calypso_auth=;');
      expect(header).toContain('Max-Age=0');
      expect(header).not.toContain('Secure');
    });

    test('HTTPS mode clears __Host- name with Secure', () => {
      process.env.SECURE_COOKIES = 'true';
      const header = authCookieClearHeader();
      expect(header).toContain('__Host-calypso_auth=;');
      expect(header).toContain('Max-Age=0');
      expect(header).toContain('Secure');
    });
  });

  describe('getAuthToken', () => {
    test('returns active cookie in dev mode', () => {
      delete process.env.SECURE_COOKIES;
      expect(getAuthToken({ calypso_auth: 'dev-tok' })).toBe('dev-tok');
    });

    test('returns active cookie in HTTPS mode', () => {
      process.env.SECURE_COOKIES = 'true';
      expect(getAuthToken({ '__Host-calypso_auth': 'secure-tok' })).toBe('secure-tok');
    });

    test('falls back to plain name during transition to HTTPS mode', () => {
      process.env.SECURE_COOKIES = 'true';
      expect(getAuthToken({ calypso_auth: 'old-tok' })).toBe('old-tok');
    });

    test('falls back to __Host- name during transition to dev mode', () => {
      delete process.env.SECURE_COOKIES;
      expect(getAuthToken({ '__Host-calypso_auth': 'old-secure-tok' })).toBe('old-secure-tok');
    });

    test('returns undefined when no token present', () => {
      delete process.env.SECURE_COOKIES;
      expect(getAuthToken({})).toBeUndefined();
    });
  });
});
