import { beforeEach, describe, expect, it } from 'vitest';
import { buildSslOptions } from './ssl';

describe('buildSslOptions', () => {
  beforeEach(() => {
    delete process.env.DB_SSL;
    delete process.env.DB_CA_CERT;
  });

  it('returns undefined when DB_SSL is unset', () => {
    expect(buildSslOptions()).toBeUndefined();
  });

  it('returns undefined when DB_SSL is disable', () => {
    process.env.DB_SSL = 'disable';
    expect(buildSslOptions()).toBeUndefined();
  });

  it('returns an unverified TLS config when DB_SSL is require', () => {
    process.env.DB_SSL = 'require';
    expect(buildSslOptions()).toEqual({ rejectUnauthorized: false });
  });

  it('returns a verified TLS config when DB_SSL is verify-full', () => {
    process.env.DB_SSL = 'verify-full';
    process.env.DB_CA_CERT = '---CERT---';
    expect(buildSslOptions()).toEqual({
      rejectUnauthorized: true,
      ca: '---CERT---',
    });
  });

  it('falls back to unverified TLS for unexpected DB_SSL values', () => {
    process.env.DB_SSL = 'something-else';
    expect(buildSslOptions()).toEqual({ rejectUnauthorized: false });
  });
});
