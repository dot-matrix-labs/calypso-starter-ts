/**
 * @file data-governance
 *
 * Data governance engine implementing GDPR-critical capabilities:
 *
 *   1. checkRetentionPolicy  — evaluates whether a record has exceeded its
 *      configured retention period based on an audit-log timestamp.
 *
 *   2. anonymizeRecord       — replaces PII fields with a stable pseudonym or
 *      null according to the schema-defined policy stored in entity_types.sensitive.
 *
 *   3. generateComplianceReport — enumerates data categories (entity types),
 *      their configured retention periods, and the current subject counts.
 *
 *   4. handleDataSubjectRequest — supports erasure (right to be forgotten) and
 *      export (right to portability) operations.
 *
 * All functions are configuration-driven. The GovernanceConfig is supplied by
 * the caller (typically loaded from process.env at server startup). If the
 * config is absent the module logs a warning and operates in degraded mode
 * (retention checks always return non-expired, anonymization skips PII
 * replacement).
 *
 * The audit-write callback for erasure operations is intentionally injected
 * rather than imported directly, so that this package does not take a
 * dependency on the `core` package. Callers in the server layer wire in
 * `emitAuditEvent` from `apps/server/src/policies/audit-service.ts`.
 *
 * Canonical docs: docs/prd.md
 * Related issue: #140
 */

import postgres from 'postgres';

// ---------------------------------------------------------------------------
// Internal type alias for postgres Sql instances
// ---------------------------------------------------------------------------

type SqlClient = postgres.Sql;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Per-entity-type retention configuration.
 *
 * `retentionDays` is the number of calendar days a record may be kept before
 * it is considered expired and subject to deletion / anonymization.
 *
 * Set `retentionDays` to `null` to indicate that no automatic expiry applies
 * (i.e. the data may be kept indefinitely under this policy).
 */
export interface EntityRetentionPolicy {
  retentionDays: number | null;
}

/**
 * Top-level governance configuration object.
 *
 * `retention` is a map from entity type name to its retention policy.
 * Entity types absent from this map are treated as having no retention
 * constraint (i.e. effectively `retentionDays: null`).
 *
 * `pseudonymSalt` is an application-wide salt used to derive stable
 * pseudonyms for PII field values during anonymization. It must be kept
 * secret — leaking it allows de-pseudonymization.
 */
export interface GovernanceConfig {
  retention: Record<string, EntityRetentionPolicy>;
  /**
   * A secret salt used for stable pseudonymization of PII field values.
   * When absent, PII fields are replaced with `null` instead of a pseudonym.
   */
  pseudonymSalt?: string;
}

/**
 * Parses `process.env` into a GovernanceConfig, or returns `null` if the
 * required environment is absent.
 *
 * Environment variables:
 *   GOVERNANCE_RETENTION_JSON  — JSON string encoding a
 *     `Record<string, { retentionDays: number | null }>`.
 *     Example:
 *       '{"user":{"retentionDays":365},"task":{"retentionDays":null}}'
 *
 *   GOVERNANCE_PSEUDONYM_SALT  — Secret salt for stable pseudonymization.
 *     When absent, PII fields are replaced with `null`.
 */
export function parseGovernanceConfig(
  env: Record<string, string | undefined> = process.env,
): GovernanceConfig | null {
  const retentionJson = env.GOVERNANCE_RETENTION_JSON;
  const pseudonymSalt = env.GOVERNANCE_PSEUDONYM_SALT;

  if (!retentionJson) {
    return null;
  }

  let retention: Record<string, EntityRetentionPolicy>;
  try {
    retention = JSON.parse(retentionJson) as Record<string, EntityRetentionPolicy>;
  } catch {
    return null;
  }

  return { retention, pseudonymSalt };
}

// ---------------------------------------------------------------------------
// Retention policy check
// ---------------------------------------------------------------------------

export interface CheckRetentionPolicyInput {
  /** The entity type (e.g. "user", "task"). */
  entityType: string;
  /**
   * The reference timestamp for age calculation.
   * Typically the `created_at` of the record or the timestamp of the last
   * audit-log entry for the subject.
   */
  recordTimestamp: Date;
  config: GovernanceConfig;
}

export interface RetentionPolicyResult {
  expired: boolean;
  retentionDays: number | null;
  ageInDays: number;
}

/**
 * Evaluates whether a record has exceeded its configured retention period.
 *
 * Returns `expired: false` when:
 *   - The entity type has no retention policy in config.
 *   - The configured `retentionDays` is `null` (keep indefinitely).
 */
export function checkRetentionPolicy(input: CheckRetentionPolicyInput): RetentionPolicyResult {
  const policy = input.config.retention[input.entityType] ?? null;
  const retentionDays = policy?.retentionDays ?? null;

  const ageMs = Date.now() - input.recordTimestamp.getTime();
  const ageInDays = ageMs / (1000 * 60 * 60 * 24);

  if (retentionDays === null) {
    return { expired: false, retentionDays: null, ageInDays };
  }

  return {
    expired: ageInDays > retentionDays,
    retentionDays,
    ageInDays,
  };
}

// ---------------------------------------------------------------------------
// Record anonymization
// ---------------------------------------------------------------------------

export interface AnonymizeRecordInput {
  entityType: string;
  /**
   * The full properties JSONB object for the entity.
   * Non-PII fields are returned unchanged.
   */
  properties: Record<string, unknown>;
  /**
   * The set of PII field names defined for this entity type.
   * Sourced from `entity_types.sensitive` in the database.
   */
  piiFields: string[];
  config: GovernanceConfig;
}

export interface AnonymizeRecordResult {
  /** The anonymized properties object (a new object — input is not mutated). */
  anonymized: Record<string, unknown>;
  /** The field names that were replaced. */
  redactedFields: string[];
}

/**
 * Replaces PII fields in a record with a stable pseudonym or `null`.
 *
 * When `config.pseudonymSalt` is set the replacement value is a stable
 * hex-encoded SHA-256 HMAC of the field value, keyed with the salt. The same
 * input will always produce the same pseudonym, which allows cross-record
 * linkage to be preserved while removing the actual PII value.
 *
 * When `pseudonymSalt` is absent the field value is set to `null`.
 */
export async function anonymizeRecord(input: AnonymizeRecordInput): Promise<AnonymizeRecordResult> {
  const { properties, piiFields, config } = input;
  const result: Record<string, unknown> = { ...properties };
  const redactedFields: string[] = [];

  for (const field of piiFields) {
    if (!(field in properties)) continue;

    if (config.pseudonymSalt) {
      const raw = properties[field];
      const strVal = raw === null || raw === undefined ? '' : String(raw);
      result[field] = await computePseudonym(config.pseudonymSalt, field, strVal);
    } else {
      result[field] = null;
    }
    redactedFields.push(field);
  }

  return { anonymized: result, redactedFields };
}

async function computePseudonym(salt: string, field: string, value: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(`${field}:${value}`));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Compliance report
// ---------------------------------------------------------------------------

export interface ComplianceReportEntry {
  entityType: string;
  retentionDays: number | null;
  subjectCount: number;
  piiFields: string[];
}

export interface ComplianceReport {
  generatedAt: string;
  entries: ComplianceReportEntry[];
}

/**
 * Generates a structured compliance report enumerating all entity types,
 * their configured retention periods, current subject counts, and PII fields.
 *
 * The report is read-only — it performs only SELECT queries.
 */
export async function generateComplianceReport(
  sql: SqlClient,
  config: GovernanceConfig,
): Promise<ComplianceReport> {
  // Fetch entity types and their sensitive fields from the database
  const entityTypeRows = await sql<{ type: string; sensitive: string[] }[]>`
    SELECT type, sensitive FROM entity_types ORDER BY type
  `;

  // Count subjects per entity type
  const countRows = await sql<{ type: string; count: string }[]>`
    SELECT type, COUNT(*)::TEXT AS count FROM entities GROUP BY type
  `;
  const countMap: Record<string, number> = {};
  for (const row of countRows) {
    countMap[row.type] = parseInt(row.count, 10);
  }

  const entries: ComplianceReportEntry[] = entityTypeRows.map(
    (row: { type: string; sensitive: string[] }) => ({
      entityType: row.type,
      retentionDays: config.retention[row.type]?.retentionDays ?? null,
      subjectCount: countMap[row.type] ?? 0,
      piiFields: row.sensitive ?? [],
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    entries,
  };
}

// ---------------------------------------------------------------------------
// Data subject requests
// ---------------------------------------------------------------------------

export type DataSubjectRequestKind = 'erasure' | 'export';

export interface DataSubjectRequestInput {
  kind: DataSubjectRequestKind;
  /** The entity ID of the data subject. */
  subjectId: string;
  /** Actor performing the request (for audit log). */
  actorId: string;
}

export interface ErasureResult {
  kind: 'erasure';
  subjectId: string;
  fieldsErased: string[];
  auditEntryWritten: boolean;
}

export interface ExportResult {
  kind: 'export';
  subjectId: string;
  entityType: string | null;
  properties: Record<string, unknown>;
  relations: Array<{
    id: string;
    type: string;
    sourceId: string;
    targetId: string;
    properties: Record<string, unknown>;
  }>;
}

export type DataSubjectResult = ErasureResult | ExportResult;

/**
 * Audit writer callback injected by the server layer. Accepts a structured
 * erasure event and persists it to the audit log. Using a callback avoids a
 * direct dependency on the `core` package from within `packages/db`.
 */
export type AuditWriterFn = (event: {
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ts: string;
}) => Promise<void>;

/**
 * Handles a data subject request (erasure or export).
 *
 * **Erasure (right to be forgotten)**:
 *   - Fetches the entity and its PII fields from `entity_types.sensitive`.
 *   - Sets each PII field to a pseudonym or `null` in the entity's properties JSONB.
 *   - Invokes the injected `auditWriter` to record the erasure in the audit log.
 *
 * **Export (right to portability)**:
 *   - Returns the full entity properties plus all associated relations.
 *   - Does not modify any data.
 *
 * @throws if the entity is not found.
 */
export async function handleDataSubjectRequest(
  sql: SqlClient,
  input: DataSubjectRequestInput,
  config: GovernanceConfig,
  auditWriter?: AuditWriterFn,
): Promise<DataSubjectResult> {
  // Look up the entity
  const [entity] = await sql<
    { id: string; type: string; properties: Record<string, unknown>; tenant_id: string | null }[]
  >`
    SELECT id, type, properties, tenant_id FROM entities WHERE id = ${input.subjectId}
  `;

  if (!entity) {
    throw new Error(`Entity not found: ${input.subjectId}`);
  }

  // Fetch the PII fields for this entity type
  const [entityTypeRow] = await sql<{ sensitive: string[] }[]>`
    SELECT sensitive FROM entity_types WHERE type = ${entity.type}
  `;
  const piiFields: string[] = entityTypeRow?.sensitive ?? [];

  if (input.kind === 'export') {
    // Fetch all relations involving this subject
    const relations = await sql<
      {
        id: string;
        type: string;
        source_id: string;
        target_id: string;
        properties: Record<string, unknown>;
      }[]
    >`
      SELECT id, type, source_id, target_id, properties
      FROM relations
      WHERE source_id = ${input.subjectId} OR target_id = ${input.subjectId}
    `;

    return {
      kind: 'export',
      subjectId: input.subjectId,
      entityType: entity.type,
      properties: entity.properties,
      relations: relations.map(
        (r: {
          id: string;
          type: string;
          source_id: string;
          target_id: string;
          properties: Record<string, unknown>;
        }) => ({
          id: r.id,
          type: r.type,
          sourceId: r.source_id,
          targetId: r.target_id,
          properties: r.properties,
        }),
      ),
    };
  }

  // erasure path
  const { anonymized, redactedFields } = await anonymizeRecord({
    entityType: entity.type,
    properties: entity.properties,
    piiFields,
    config,
  });

  const before = entity.properties;

  await sql`
    UPDATE entities
    SET properties = ${sql.json(anonymized as never)}, updated_at = NOW()
    WHERE id = ${input.subjectId}
  `;

  // Write audit log entry via the injected writer
  let auditEntryWritten = false;
  if (auditWriter) {
    try {
      await auditWriter({
        actor_id: input.actorId,
        action: 'data_subject.erasure',
        entity_type: entity.type,
        entity_id: input.subjectId,
        before: before as Record<string, unknown>,
        after: anonymized,
        ts: new Date().toISOString(),
      });
      auditEntryWritten = true;
    } catch (auditErr) {
      // Audit failure is logged but does not roll back the erasure — the PII
      // has already been removed. The erasure result reflects the audit state.
      console.warn('[governance] Audit log write failed for erasure:', auditErr);
      auditEntryWritten = false;
    }
  }

  return {
    kind: 'erasure',
    subjectId: input.subjectId,
    fieldsErased: redactedFields,
    auditEntryWritten,
  };
}
