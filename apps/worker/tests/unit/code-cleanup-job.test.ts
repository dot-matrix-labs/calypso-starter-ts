/**
 * Unit tests for the code cleanup and dependency optimization agent job type.
 *
 * Validates:
 *   - Job type constants
 *   - CLI payload construction
 *   - Result validation (valid and invalid shapes)
 *   - Finding field validation
 */

import { describe, test, expect } from 'vitest';

/** Helper: return a copy of `obj` with `key` removed. */
function omit<T extends Record<string, unknown>>(obj: T, key: keyof T): Partial<T> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

import {
  CODE_CLEANUP_JOB_TYPE,
  CODE_CLEANUP_AGENT_TYPE,
  buildCodeCleanupCliPayload,
  validateCodeCleanupResult,
  type CodeCleanupResult,
} from '../../src/code-cleanup-job.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('CODE_CLEANUP_JOB_TYPE', () => {
  test('equals "code_cleanup"', () => {
    expect(CODE_CLEANUP_JOB_TYPE).toBe('code_cleanup');
  });
});

describe('CODE_CLEANUP_AGENT_TYPE', () => {
  test('equals "code_cleanup"', () => {
    expect(CODE_CLEANUP_AGENT_TYPE).toBe('code_cleanup');
  });
});

// ---------------------------------------------------------------------------
// buildCodeCleanupCliPayload
// ---------------------------------------------------------------------------

describe('buildCodeCleanupCliPayload', () => {
  test('includes task id, job_type, and agent_type', () => {
    const payload = buildCodeCleanupCliPayload('task-001', 'code_cleanup', {
      prompt_ref: 'pref_abc',
    });
    expect(payload.id).toBe('task-001');
    expect(payload.job_type).toBe(CODE_CLEANUP_JOB_TYPE);
    expect(payload.agent_type).toBe('code_cleanup');
  });

  test('spreads payload fields into result', () => {
    const payload = buildCodeCleanupCliPayload('task-002', 'code_cleanup', {
      prompt_ref: 'pref_xyz',
      scope_ref: 'apps/',
    });
    expect(payload.prompt_ref).toBe('pref_xyz');
    expect(payload.scope_ref).toBe('apps/');
  });

  test('works without optional scope_ref', () => {
    const payload = buildCodeCleanupCliPayload('task-003', 'code_cleanup', {
      prompt_ref: 'pref_minimal',
    });
    expect(payload.scope_ref).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateCodeCleanupResult
// ---------------------------------------------------------------------------

const validFinding = {
  category: 'cleanup' as const,
  impact: 'medium' as const,
  path: 'apps/worker/src/runner.ts',
  description: 'Unused import detected',
  action: 'Remove the unused import',
};

const validResult: CodeCleanupResult = {
  findings: [validFinding],
  summary: 'Found 1 cleanup opportunity',
  status: 'completed',
};

describe('validateCodeCleanupResult', () => {
  test('accepts a valid result with findings and summary', () => {
    const result = validateCodeCleanupResult({ ...validResult });
    expect(result.findings).toHaveLength(1);
    expect(result.summary).toBe('Found 1 cleanup opportunity');
  });

  test('accepts an empty findings array', () => {
    const result = validateCodeCleanupResult({
      findings: [],
      summary: 'No issues found',
    });
    expect(result.findings).toHaveLength(0);
  });

  test('throws when findings field is missing', () => {
    expect(() => validateCodeCleanupResult({ summary: 'test' })).toThrow('findings');
  });

  test('throws when findings is not an array', () => {
    expect(() => validateCodeCleanupResult({ findings: 'not-an-array', summary: 'test' })).toThrow(
      'findings',
    );
  });

  test('throws when summary field is missing', () => {
    expect(() => validateCodeCleanupResult({ findings: [] })).toThrow('summary');
  });

  test('throws when summary is not a string', () => {
    expect(() => validateCodeCleanupResult({ findings: [], summary: 42 })).toThrow('summary');
  });

  test('throws when a finding has invalid category', () => {
    expect(() =>
      validateCodeCleanupResult({
        findings: [{ ...validFinding, category: 'unknown' }],
        summary: 'test',
      }),
    ).toThrow('finding[0]');
  });

  test('throws when a finding has invalid impact', () => {
    expect(() =>
      validateCodeCleanupResult({
        findings: [{ ...validFinding, impact: 'critical' }],
        summary: 'test',
      }),
    ).toThrow('finding[0]');
  });

  test('throws when a finding is missing path', () => {
    const withoutPath = omit(validFinding, 'path');
    expect(() =>
      validateCodeCleanupResult({
        findings: [withoutPath],
        summary: 'test',
      }),
    ).toThrow('finding[0]');
  });

  test('throws when a finding is missing description', () => {
    const withoutDesc = omit(validFinding, 'description');
    expect(() =>
      validateCodeCleanupResult({
        findings: [withoutDesc],
        summary: 'test',
      }),
    ).toThrow('finding[0]');
  });

  test('throws when a finding is missing action', () => {
    const withoutAction = omit(validFinding, 'action');
    expect(() =>
      validateCodeCleanupResult({
        findings: [withoutAction],
        summary: 'test',
      }),
    ).toThrow('finding[0]');
  });

  test('accepts dependency category finding', () => {
    const result = validateCodeCleanupResult({
      findings: [{ ...validFinding, category: 'dependency' }],
      summary: 'Found a dependency issue',
    });
    expect(result.findings[0].category).toBe('dependency');
  });

  test('accepts all valid impact levels', () => {
    for (const impact of ['high', 'medium', 'low'] as const) {
      const result = validateCodeCleanupResult({
        findings: [{ ...validFinding, impact }],
        summary: 'test',
      });
      expect(result.findings[0].impact).toBe(impact);
    }
  });

  test('passes through additional fields', () => {
    const result = validateCodeCleanupResult({
      ...validResult,
      stub: true,
      extra_field: 'preserved',
    });
    expect(result.stub).toBe(true);
  });
});
