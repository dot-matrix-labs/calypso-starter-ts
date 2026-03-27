/**
 * Unit tests for the runtime error tracing job module.
 *
 * Validates:
 *   - RUNTIME_TRACE_JOB_TYPE constant
 *   - buildRuntimeTraceCliPayload merges fields correctly
 *   - validateRuntimeTraceResult accepts valid results and rejects invalid ones
 *   - Findings validation checks all required fields
 *   - RUNTIME_TRACE_TIMEOUT_MS is a positive number
 */

import { describe, test, expect } from 'vitest';
import {
  RUNTIME_TRACE_JOB_TYPE,
  RUNTIME_TRACE_TIMEOUT_MS,
  RUNTIME_TRACE_PROMPT,
  buildRuntimeTraceCliPayload,
  validateRuntimeTraceResult,
} from '../../src/runtime-tracer-job';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('RUNTIME_TRACE_JOB_TYPE', () => {
  test('equals "runtime_trace"', () => {
    expect(RUNTIME_TRACE_JOB_TYPE).toBe('runtime_trace');
  });
});

describe('RUNTIME_TRACE_TIMEOUT_MS', () => {
  test('is a positive number', () => {
    expect(typeof RUNTIME_TRACE_TIMEOUT_MS).toBe('number');
    expect(RUNTIME_TRACE_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test('is at least 5 minutes', () => {
    expect(RUNTIME_TRACE_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * 60 * 1_000);
  });
});

describe('RUNTIME_TRACE_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof RUNTIME_TRACE_PROMPT).toBe('string');
    expect(RUNTIME_TRACE_PROMPT.length).toBeGreaterThan(100);
  });

  test('mentions unhandled exception', () => {
    expect(RUNTIME_TRACE_PROMPT).toMatch(/unhandled/i);
  });

  test('mentions error boundary', () => {
    expect(RUNTIME_TRACE_PROMPT).toMatch(/error.boundary/i);
  });

  test('mentions read-only', () => {
    expect(RUNTIME_TRACE_PROMPT).toMatch(/read.only/i);
  });
});

// ---------------------------------------------------------------------------
// buildRuntimeTraceCliPayload
// ---------------------------------------------------------------------------

describe('buildRuntimeTraceCliPayload', () => {
  test('includes id, job_type, and agent_type', () => {
    const payload = buildRuntimeTraceCliPayload('task-123', 'runtime-tracer', {
      trace_ref: 'ref-1',
    });
    expect(payload['id']).toBe('task-123');
    expect(payload['job_type']).toBe(RUNTIME_TRACE_JOB_TYPE);
    expect(payload['agent_type']).toBe('runtime-tracer');
  });

  test('spreads payload fields', () => {
    const payload = buildRuntimeTraceCliPayload('task-456', 'runtime-tracer', {
      trace_ref: 'ref-2',
      log_ref: 'log-abc',
    });
    expect(payload['trace_ref']).toBe('ref-2');
    expect(payload['log_ref']).toBe('log-abc');
  });

  test('includes the runtime trace prompt', () => {
    const payload = buildRuntimeTraceCliPayload('task-789', 'runtime-tracer', {
      trace_ref: 'ref-3',
    });
    expect(typeof payload['prompt']).toBe('string');
    expect((payload['prompt'] as string).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// validateRuntimeTraceResult
// ---------------------------------------------------------------------------

function makeValidResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    findings: [
      {
        category: 'unhandled_exception',
        frequency: 5,
        stack_ref: 'stack-abc123',
        root_cause: 'Null pointer dereference in auth middleware.',
        suggested_fix: 'Add null guard before accessing user.id.',
      },
    ],
    summary: 'Found 1 recurring error pattern.',
    status: 'completed',
    trace_ref: 'trace-ref-001',
    ...overrides,
  };
}

describe('validateRuntimeTraceResult', () => {
  test('accepts a valid result with findings', () => {
    const result = validateRuntimeTraceResult(makeValidResult());
    expect(result.findings).toHaveLength(1);
    expect(result.summary).toBe('Found 1 recurring error pattern.');
    expect(result.trace_ref).toBe('trace-ref-001');
    expect(result.status).toBe('completed');
  });

  test('accepts an empty findings array', () => {
    const result = validateRuntimeTraceResult(makeValidResult({ findings: [] }));
    expect(result.findings).toHaveLength(0);
  });

  test('throws when findings is missing', () => {
    const raw = makeValidResult();
    delete raw['findings'];
    expect(() => validateRuntimeTraceResult(raw)).toThrow(/"findings" array/);
  });

  test('throws when findings is not an array', () => {
    expect(() => validateRuntimeTraceResult(makeValidResult({ findings: 'bad' }))).toThrow(
      /"findings" array/,
    );
  });

  test('throws when summary is missing', () => {
    const raw = makeValidResult();
    delete raw['summary'];
    expect(() => validateRuntimeTraceResult(raw)).toThrow(/"summary" string/);
  });

  test('throws when trace_ref is missing', () => {
    const raw = makeValidResult();
    delete raw['trace_ref'];
    expect(() => validateRuntimeTraceResult(raw)).toThrow(/"trace_ref" string/);
  });

  test('throws when a finding is missing category', () => {
    const findings = [
      {
        frequency: 3,
        stack_ref: 'stack-001',
        root_cause: 'Some error.',
        suggested_fix: 'Fix it.',
      },
    ];
    expect(() => validateRuntimeTraceResult(makeValidResult({ findings }))).toThrow(/category/);
  });

  test('throws when a finding is missing frequency', () => {
    const findings = [
      {
        category: 'timeout',
        stack_ref: 'stack-002',
        root_cause: 'Slow query.',
        suggested_fix: 'Add index.',
      },
    ];
    expect(() => validateRuntimeTraceResult(makeValidResult({ findings }))).toThrow(/frequency/);
  });

  test('throws when a finding is missing stack_ref', () => {
    const findings = [
      {
        category: 'swallowed_error',
        frequency: 1,
        root_cause: 'Empty catch block.',
        suggested_fix: 'Log the error.',
      },
    ];
    expect(() => validateRuntimeTraceResult(makeValidResult({ findings }))).toThrow(/stack_ref/);
  });

  test('throws when a finding is missing root_cause', () => {
    const findings = [
      {
        category: 'unhandled_rejection',
        frequency: 2,
        stack_ref: 'stack-003',
        suggested_fix: 'Add .catch() handler.',
      },
    ];
    expect(() => validateRuntimeTraceResult(makeValidResult({ findings }))).toThrow(/root_cause/);
  });

  test('throws when a finding is missing suggested_fix', () => {
    const findings = [
      {
        category: 'recurring_failure',
        frequency: 10,
        stack_ref: 'stack-004',
        root_cause: 'Database connection drops.',
      },
    ];
    expect(() => validateRuntimeTraceResult(makeValidResult({ findings }))).toThrow(
      /suggested_fix/,
    );
  });

  test('passes through extra fields from vendor', () => {
    const result = validateRuntimeTraceResult(makeValidResult({ stub: true, custom_field: 42 }));
    expect(result['stub']).toBe(true);
    expect(result['custom_field']).toBe(42);
  });
});
