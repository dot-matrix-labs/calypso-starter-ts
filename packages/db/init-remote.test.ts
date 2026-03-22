import { beforeEach, describe, expect, it } from 'vitest';
import {
  agentRoleName,
  agentViewName,
  dbUrl,
  escapeSqlLiteral,
  loadInitRemoteConfig,
  sslOptions,
} from './init-remote';

describe('init-remote helpers', () => {
  beforeEach(() => {
    delete process.env.DB_SSL;
    delete process.env.DB_CA_CERT;
  });

  it('escapes single quotes for DDL literals', () => {
    expect(escapeSqlLiteral("o'hara")).toBe("o''hara");
  });

  it('retargets the admin URL to a specific database', () => {
    expect(
      dbUrl('postgres://admin:secret@example.com:5432/postgres?sslmode=require', 'calypso_app'),
    ).toBe('postgres://admin:secret@example.com:5432/calypso_app?sslmode=require');
  });

  it('derives SSL options from DB_SSL and DB_CA_CERT', () => {
    process.env.DB_SSL = 'verify-full';
    process.env.DB_CA_CERT = '---CERT---';

    expect(sslOptions()).toEqual({
      rejectUnauthorized: true,
      ca: '---CERT---',
    });
  });

  it('validates required init-remote environment variables', () => {
    expect(() => loadInitRemoteConfig({} as NodeJS.ProcessEnv)).toThrow(
      'Missing required environment variables',
    );
  });

  it('requires AGENT_CODING_PASSWORD and AGENT_ANALYSIS_PASSWORD', () => {
    expect(() =>
      loadInitRemoteConfig({
        ADMIN_DATABASE_URL: 'postgres://admin:secret@example.com/postgres',
        APP_RW_PASSWORD: 'app_pw',
        AUDIT_W_PASSWORD: 'audit_pw',
        ANALYTICS_W_PASSWORD: 'analytics_pw',
        // Deliberately omit agent passwords
      } as NodeJS.ProcessEnv),
    ).toThrow('AGENT_CODING_PASSWORD');
  });

  it('applies default database names when optional env vars are absent', () => {
    expect(
      loadInitRemoteConfig({
        ADMIN_DATABASE_URL: 'postgres://admin:secret@example.com/postgres',
        APP_RW_PASSWORD: 'app_pw',
        AUDIT_W_PASSWORD: 'audit_pw',
        ANALYTICS_W_PASSWORD: 'analytics_pw',
        AGENT_CODING_PASSWORD: 'coding_pw',
        AGENT_ANALYSIS_PASSWORD: 'analysis_pw',
      } as NodeJS.ProcessEnv),
    ).toEqual({
      adminDatabaseUrl: 'postgres://admin:secret@example.com/postgres',
      passwords: {
        app: 'app_pw',
        audit: 'audit_pw',
        analytics: 'analytics_pw',
        agents: {
          coding: 'coding_pw',
          analysis: 'analysis_pw',
        },
      },
      databases: {
        app: 'calypso_app',
        audit: 'calypso_audit',
        analytics: 'calypso_analytics',
      },
    });
  });

  it('derives per-type agent role names from agent type', () => {
    expect(agentRoleName('coding')).toBe('agent_coding');
    expect(agentRoleName('analysis')).toBe('agent_analysis');
  });

  it('derives per-type view names from agent type', () => {
    expect(agentViewName('coding')).toBe('task_queue_view_coding');
    expect(agentViewName('analysis')).toBe('task_queue_view_analysis');
  });
});
