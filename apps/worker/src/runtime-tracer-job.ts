/**
 * @file runtime-tracer-job.ts
 *
 * Runtime error tracing agent job type — "runtime_trace".
 *
 * ## Job type: runtime_trace
 *
 * A cron-scheduled agent that analyzes structured logs and error traces via
 * Claude CLI. Reviews for recurring error patterns, unhandled exceptions,
 * missing error boundaries, and swallowed error context. Findings are stored
 * as structured JSON with error category, frequency, stack trace reference,
 * root cause analysis, and suggested fix.
 *
 * ### Payload shape
 *
 * ```json
 * {
 *   "trace_ref":    "<opaque reference to the trace request>",
 *   "log_ref":      "<optional opaque reference to log data>",
 *   "scope_ref":    "<optional opaque reference to trace scope config>"
 * }
 * ```
 *
 * Payloads must contain only opaque identifiers (TQ-P-002). No raw log
 * content, stack traces, or file paths may appear in the queue row.
 *
 * ### Result shape
 *
 * ```json
 * {
 *   "findings": [
 *     {
 *       "category":       "unhandled_exception",
 *       "frequency":      12,
 *       "stack_ref":      "stack-abc123",
 *       "root_cause":     "Null pointer dereference in auth middleware.",
 *       "suggested_fix":  "Add null guard before accessing user.id."
 *     }
 *   ],
 *   "summary":    "Found 3 recurring error patterns.",
 *   "status":     "completed",
 *   "trace_ref":  "<echoed from payload>"
 * }
 * ```
 *
 * ### Cron trigger
 *
 * The job is enqueued by `apps/server/src/cron/jobs/runtime-tracer.ts` on a
 * configurable schedule (default: every 6 hours).
 *
 * Blueprint reference: WORKER domain — runtime error tracing agent
 */

/** The job_type string identifying a runtime error trace task. */
export const RUNTIME_TRACE_JOB_TYPE = 'runtime_trace' as const;

/**
 * Error category for a runtime trace finding.
 */
export type ErrorCategory =
  | 'unhandled_exception'
  | 'unhandled_rejection'
  | 'missing_error_boundary'
  | 'swallowed_error'
  | 'recurring_failure'
  | 'timeout'
  | 'other';

/**
 * A single runtime error finding produced by the trace analysis.
 */
export interface RuntimeTraceFinding {
  /** Error category classifying the type of error pattern. */
  category: ErrorCategory | string;
  /** Observed frequency of this error pattern in the log window. */
  frequency: number;
  /** Opaque reference to a representative stack trace for correlation. */
  stack_ref: string;
  /** Root cause analysis of the error. */
  root_cause: string;
  /** Concrete fix suggestion to address the error. */
  suggested_fix: string;
}

/**
 * Payload shape for the `runtime_trace` job type.
 *
 * Only opaque identifiers are permitted (TQ-P-002). Workers fetch context
 * through the API at execution time; the queue row must never carry raw content.
 */
export interface RuntimeTracePayload {
  /** Opaque reference to the trace request. Required. */
  trace_ref: string;
  /** Opaque reference to the log data to analyze. Optional. */
  log_ref?: string;
  /** Opaque reference to an optional scope configuration. */
  scope_ref?: string;
}

/**
 * Expected result shape returned by the Claude CLI for `runtime_trace` tasks.
 */
export interface RuntimeTraceResult {
  /** Structured list of runtime error findings. */
  findings: RuntimeTraceFinding[];
  /** Human-readable summary of the trace outcome. */
  summary: string;
  /** Execution status. */
  status: 'completed' | 'failed';
  /** Echoed trace_ref from the payload for correlation. */
  trace_ref: string;
  /** Whether the result was produced by the dev stub (local dev only). */
  stub?: boolean;
  /** Additional vendor-specific fields forwarded as-is. */
  [key: string]: unknown;
}

/**
 * The Claude CLI prompt used for runtime error trace analysis.
 *
 * Instructs Claude to review structured logs and error traces for recurring
 * error patterns, returning structured JSON output.
 */
export const RUNTIME_TRACE_PROMPT = `You are a runtime error analyst. Analyse the structured logs and error traces for this project.

Focus on:
- Recurring error patterns and high-frequency exceptions
- Unhandled exceptions and unhandled promise rejections
- Missing error boundaries that allow failures to propagate silently
- Swallowed errors where catch blocks discard context without logging
- Timeout errors and resource exhaustion patterns
- Error handling gaps in critical code paths (auth, data access, API handlers)
- Stack traces pointing to the same root cause across multiple events

For each finding output a JSON object with:
  - category: one of "unhandled_exception" | "unhandled_rejection" | "missing_error_boundary" | "swallowed_error" | "recurring_failure" | "timeout" | "other"
  - frequency: integer count of occurrences observed in the log window
  - stack_ref: short opaque identifier referencing the representative stack trace
  - root_cause: concise root cause analysis (1-3 sentences)
  - suggested_fix: actionable fix recommendation

Return a JSON object with:
  {
    "findings": [...],
    "summary": "Found N recurring error patterns.",
    "status": "completed",
    "trace_ref": "<echoed from input>"
  }

Perform read-only analysis only. Do not modify any files.`;

/**
 * Build the stdin payload sent to the Claude CLI for a `runtime_trace` task.
 *
 * Merges task metadata with the job payload and embeds the runtime trace
 * prompt so the CLI has all context it needs.
 */
export function buildRuntimeTraceCliPayload(
  taskId: string,
  agentType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: taskId,
    job_type: RUNTIME_TRACE_JOB_TYPE,
    agent_type: agentType,
    prompt: RUNTIME_TRACE_PROMPT,
    ...payload,
  };
}

/**
 * Validate that a raw CLI result object conforms to the RuntimeTraceResult shape.
 *
 * Throws if the result is missing required fields or if findings are malformed.
 */
export function validateRuntimeTraceResult(raw: Record<string, unknown>): RuntimeTraceResult {
  if (!Array.isArray(raw['findings'])) {
    throw new Error(
      `Runtime trace result is missing required "findings" array. Got: ${JSON.stringify(raw).slice(0, 200)}`,
    );
  }

  if (typeof raw['summary'] !== 'string') {
    throw new Error(
      `Runtime trace result is missing required "summary" string. Got: ${JSON.stringify(raw).slice(0, 200)}`,
    );
  }

  if (typeof raw['trace_ref'] !== 'string') {
    throw new Error(
      `Runtime trace result is missing required "trace_ref" string. Got: ${JSON.stringify(raw).slice(0, 200)}`,
    );
  }

  // Validate individual findings have required fields.
  const findings = raw['findings'] as unknown[];
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i] as Record<string, unknown>;
    const missing: string[] = [];

    if (typeof f['category'] !== 'string') missing.push('category');
    if (typeof f['frequency'] !== 'number') missing.push('frequency');
    if (typeof f['stack_ref'] !== 'string') missing.push('stack_ref');
    if (typeof f['root_cause'] !== 'string') missing.push('root_cause');
    if (typeof f['suggested_fix'] !== 'string') missing.push('suggested_fix');

    if (missing.length > 0) {
      throw new Error(
        `Runtime trace finding[${i}] is missing required fields: ${missing.join(', ')}`,
      );
    }
  }

  return raw as RuntimeTraceResult;
}

/**
 * The default timeout for a runtime trace analysis in milliseconds (10 minutes).
 *
 * Runtime trace analysis may need to review a large volume of log data; the
 * hard timeout ensures the worker cannot be held indefinitely.
 */
export const RUNTIME_TRACE_TIMEOUT_MS = 10 * 60 * 1_000;
