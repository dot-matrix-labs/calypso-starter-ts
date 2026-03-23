/**
 * Unit tests for the data governance service startup and config parsing.
 *
 * Validates:
 *   - parseGovernanceConfig returns null when GOVERNANCE_RETENTION_JSON is absent
 *   - parseGovernanceConfig returns null for malformed JSON
 *   - parseGovernanceConfig parses valid config correctly
 *   - checkRetentionPolicy falls back to non-expired when config is absent
 */

import { describe, test, expect } from 'vitest';
import {
  parseGovernanceConfig,
  checkRetentionPolicy,
  type GovernanceConfig,
} from '../../../../packages/db/governance';

describe('parseGovernanceConfig', () => {
  test('returns null when GOVERNANCE_RETENTION_JSON is absent', () => {
    const result = parseGovernanceConfig({} as Record<string, string | undefined>);
    expect(result).toBeNull();
  });

  test('returns null when GOVERNANCE_RETENTION_JSON is malformed JSON', () => {
    const result = parseGovernanceConfig({
      GOVERNANCE_RETENTION_JSON: 'not-valid-json',
    } as unknown as Record<string, string | undefined>);
    expect(result).toBeNull();
  });

  test('parses a valid retention config correctly', () => {
    const config = {
      user: { retentionDays: 365 },
      task: { retentionDays: null },
    };
    const result = parseGovernanceConfig({
      GOVERNANCE_RETENTION_JSON: JSON.stringify(config),
      GOVERNANCE_PSEUDONYM_SALT: 'my-secret-salt',
    } as unknown as Record<string, string | undefined>);

    expect(result).not.toBeNull();
    expect(result!.retention.user.retentionDays).toBe(365);
    expect(result!.retention.task.retentionDays).toBeNull();
    expect(result!.pseudonymSalt).toBe('my-secret-salt');
  });

  test('parses config without pseudonymSalt', () => {
    const result = parseGovernanceConfig({
      GOVERNANCE_RETENTION_JSON: '{"user":{"retentionDays":30}}',
    } as unknown as Record<string, string | undefined>);

    expect(result).not.toBeNull();
    expect(result!.pseudonymSalt).toBeUndefined();
  });
});

describe('server startup with missing governance config', () => {
  test('checkRetentionPolicy does not throw when given a fallback config', () => {
    // When governance config is absent, the service uses a safe fallback with no retention.
    // This ensures the server does not throw/crash during startup or retention checks.
    const fallbackConfig: GovernanceConfig = { retention: {} };
    expect(() =>
      checkRetentionPolicy({
        entityType: 'user',
        recordTimestamp: new Date(),
        config: fallbackConfig,
      }),
    ).not.toThrow();

    const result = checkRetentionPolicy({
      entityType: 'user',
      recordTimestamp: new Date(Date.now() - 1000 * 24 * 60 * 60 * 1000), // 1000 days old
      config: fallbackConfig,
    });

    // No retention configured → should never report expired
    expect(result.expired).toBe(false);
    expect(result.retentionDays).toBeNull();
  });
});
