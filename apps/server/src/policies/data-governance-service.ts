/**
 * @file data-governance-service
 *
 * Server-side façade for the data governance engine.
 *
 * Responsibilities:
 *   - Loads and validates GovernanceConfig from environment at module init.
 *   - Logs a warning (not an error) when governance config is absent so the
 *     server can start gracefully in environments where GDPR config has not
 *     been deployed yet.
 *   - Re-exports the four GDPR-critical operations with a pre-bound config
 *     and the shared db pools, so callers do not need to pass those arguments.
 *   - Wires the `emitAuditEvent` function into `handleDataSubjectRequest` so
 *     erasure operations produce hash-chained audit log entries.
 *
 * Usage:
 *   import {
 *     checkRetentionPolicy,
 *     anonymizeRecord,
 *     generateComplianceReport,
 *     handleDataSubjectRequest,
 *     governanceConfig,
 *   } from './data-governance-service';
 *
 * Canonical docs: docs/prd.md
 * Related issue: #140
 */

import { sql } from 'db';
import {
  parseGovernanceConfig,
  checkRetentionPolicy as _checkRetentionPolicy,
  anonymizeRecord as _anonymizeRecord,
  generateComplianceReport as _generateComplianceReport,
  handleDataSubjectRequest as _handleDataSubjectRequest,
  type GovernanceConfig,
  type CheckRetentionPolicyInput,
  type RetentionPolicyResult,
  type AnonymizeRecordInput,
  type AnonymizeRecordResult,
  type DataSubjectRequestInput,
  type DataSubjectResult,
  type ComplianceReport,
} from 'db/governance';
import { emitAuditEvent } from './audit-service';

export type {
  GovernanceConfig,
  RetentionPolicyResult,
  AnonymizeRecordResult,
  ComplianceReport,
  DataSubjectResult,
  ErasureResult,
  ExportResult,
} from 'db/governance';

// ---------------------------------------------------------------------------
// Config initialisation
// ---------------------------------------------------------------------------

/**
 * The loaded governance config, or `null` when environment variables are
 * absent. Callers can inspect this to determine whether the governance
 * engine is fully operational.
 */
export const governanceConfig: GovernanceConfig | null = parseGovernanceConfig();

if (governanceConfig === null) {
  console.warn(
    '[governance] GOVERNANCE_RETENTION_JSON is not set — ' +
      'data governance engine running in degraded mode. ' +
      'Retention checks will report non-expired; PII anonymization will null out fields.',
  );
}

/**
 * Returns a GovernanceConfig guaranteed to be non-null, using a safe fallback
 * when config is absent. The fallback applies no retention constraints and
 * no pseudonym salt (PII fields → null).
 */
function safeConfig(): GovernanceConfig {
  return governanceConfig ?? { retention: {} };
}

// ---------------------------------------------------------------------------
// Public API — bound to module-level db pools and config
// ---------------------------------------------------------------------------

/**
 * Evaluates whether a record has exceeded its configured retention period.
 *
 * When governance config is absent, always returns `expired: false`.
 */
export function checkRetentionPolicy(
  input: Omit<CheckRetentionPolicyInput, 'config'>,
): RetentionPolicyResult {
  return _checkRetentionPolicy({ ...input, config: safeConfig() });
}

/**
 * Replaces PII fields in a record with a stable pseudonym or `null`
 * according to the schema-defined policy.
 *
 * When governance config is absent, PII fields are set to `null`.
 */
export async function anonymizeRecord(
  input: Omit<AnonymizeRecordInput, 'config'>,
): Promise<AnonymizeRecordResult> {
  return _anonymizeRecord({ ...input, config: safeConfig() });
}

/**
 * Generates a structured compliance report enumerating data categories,
 * retention periods, and subject counts.
 *
 * Uses the module-level `sql` pool (read-only SELECT queries only).
 */
export async function generateComplianceReport(): Promise<ComplianceReport> {
  return _generateComplianceReport(sql, safeConfig());
}

/**
 * Handles a data subject request (erasure or export).
 *
 * Uses the `sql` pool (entity writes for erasure) and wires in
 * `emitAuditEvent` for hash-chained audit log entries on erasure operations.
 */
export async function handleDataSubjectRequest(
  input: DataSubjectRequestInput,
): Promise<DataSubjectResult> {
  return _handleDataSubjectRequest(sql, input, safeConfig(), async (event) => {
    await emitAuditEvent(event);
  });
}
