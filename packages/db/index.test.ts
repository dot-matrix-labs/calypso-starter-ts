import { describe, expect, it } from 'vitest';
import { resolveDatabaseUrls } from './index';

describe('resolveDatabaseUrls', () => {
  it('uses localhost defaults when only DATABASE_URL is unset', () => {
    expect(resolveDatabaseUrls({} as NodeJS.ProcessEnv)).toEqual({
      app: 'postgres://app_rw:app_rw_password@localhost:5432/calypso_app',
      audit: 'postgres://audit_w:audit_w_password@localhost:5432/calypso_audit',
      analytics: 'postgres://analytics_w:analytics_w_password@localhost:5432/calypso_analytics',
    });
  });

  it('respects explicit pool environment overrides', () => {
    expect(
      resolveDatabaseUrls({
        DATABASE_URL: 'postgres://app@example/calypso_app',
        AUDIT_DATABASE_URL: 'postgres://audit@example/calypso_audit',
        ANALYTICS_DATABASE_URL: 'postgres://analytics@example/calypso_analytics',
      } as NodeJS.ProcessEnv),
    ).toEqual({
      app: 'postgres://app@example/calypso_app',
      audit: 'postgres://audit@example/calypso_audit',
      analytics: 'postgres://analytics@example/calypso_analytics',
    });
  });

  it('falls back independently when audit or analytics URLs are missing', () => {
    expect(
      resolveDatabaseUrls({
        DATABASE_URL: 'postgres://app@example/calypso_app',
        AUDIT_DATABASE_URL: 'postgres://audit@example/calypso_audit',
      } as NodeJS.ProcessEnv),
    ).toEqual({
      app: 'postgres://app@example/calypso_app',
      audit: 'postgres://audit@example/calypso_audit',
      analytics: 'postgres://analytics_w:analytics_w_password@localhost:5432/calypso_analytics',
    });
  });
});
