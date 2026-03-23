/**
 * Integration tests for the data governance policy engine (#140).
 *
 * All tests run against a real ephemeral Postgres container to match the
 * acceptance criteria and test plan items in the issue.
 *
 * Covers:
 *   - checkRetentionPolicy: expired=true for records beyond configured period
 *   - anonymizeRecord: nulls PII fields, leaves non-PII fields intact
 *   - generateComplianceReport: returns expected categories and subject counts
 *   - handleDataSubjectRequest (erasure): nulls PII columns + writes audit entry
 *   - handleDataSubjectRequest (export): returns complete data package
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from './pg-container';
import { migrate } from './index';
import {
  checkRetentionPolicy,
  anonymizeRecord,
  generateComplianceReport,
  handleDataSubjectRequest,
  type GovernanceConfig,
  type AuditWriterFn,
} from './governance';

/**
 * Minimal inline hash computation for test use only.
 * Mirrors the logic in core/audit.ts#computeAuditHash.
 */
async function computeAuditHash(
  prevHash: string,
  payload: {
    actor_id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    ts: string;
  },
): Promise<string> {
  const data =
    prevHash +
    `{"actor_id":${JSON.stringify(payload.actor_id)},"action":${JSON.stringify(payload.action)},"entity_type":${JSON.stringify(payload.entity_type)},"entity_id":${JSON.stringify(payload.entity_id)},"before":${JSON.stringify(payload.before)},"after":${JSON.stringify(payload.after)},"ts":${JSON.stringify(payload.ts)}}`;
  const enc = new TextEncoder();
  const buf = enc.encode(data);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

let pg: PgContainer;
let sql: ReturnType<typeof postgres>;
let auditSql: ReturnType<typeof postgres>;

const config: GovernanceConfig = {
  retention: {
    user: { retentionDays: 365 },
    task: { retentionDays: null },
  },
  pseudonymSalt: 'test-salt-for-unit-testing',
};

/**
 * Constructs an AuditWriterFn backed by the test auditSql pool.
 * Uses the same hash-chaining pattern as audit-service.ts.
 */
function makeAuditWriter(): AuditWriterFn {
  return async (event) => {
    const reserved = await auditSql.reserve();
    try {
      await reserved.unsafe('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const latestRows = (await reserved.unsafe(
        'SELECT hash FROM audit_events ORDER BY ts DESC, id DESC LIMIT 1 FOR UPDATE',
      )) as unknown as { hash: string }[];
      const genesisHash = '0'.repeat(64);
      const prevHash = latestRows[0]?.hash ?? genesisHash;
      const hash = await computeAuditHash(prevHash, {
        actor_id: event.actor_id,
        action: event.action,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        before: event.before,
        after: event.after,
        ts: event.ts,
      });
      await reserved.unsafe(
        `INSERT INTO audit_events
           (actor_id, action, entity_type, entity_id, before, after, ts, prev_hash, hash)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::timestamptz, $8, $9)`,
        [
          event.actor_id,
          event.action,
          event.entity_type,
          event.entity_id,
          event.before as unknown as string,
          event.after as unknown as string,
          event.ts,
          prevHash,
          hash,
        ],
      );
      await reserved.unsafe('COMMIT');
    } catch (err) {
      await reserved.unsafe('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      reserved.release();
    }
  };
}

beforeAll(async () => {
  pg = await startPostgres();
  sql = postgres(pg.url, { max: 5 });
  auditSql = postgres(pg.url, { max: 3 });

  // Apply main schema (entities, entity_types, etc.)
  await migrate({ databaseUrl: pg.url });

  // Apply audit schema — in tests we use the same database for audit_events
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before JSONB,
      after JSONB,
      ip TEXT,
      user_agent TEXT,
      correlation_id TEXT,
      ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    )
  `);

  // Register 'user' entity type with sensitive fields for PII tests
  await sql`
    INSERT INTO entity_types (type, schema, sensitive)
    VALUES ('user', '{}', ARRAY['email', 'phone', 'display_name'])
    ON CONFLICT (type) DO UPDATE SET sensitive = EXCLUDED.sensitive
  `;
}, 60_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await auditSql?.end({ timeout: 5 });
  await pg?.stop();
});

// ---------------------------------------------------------------------------
// checkRetentionPolicy
// ---------------------------------------------------------------------------

describe('checkRetentionPolicy', () => {
  test('returns expired=true for a record beyond the configured retention period', () => {
    // A user record created 400 days ago should exceed the 365-day limit
    const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const result = checkRetentionPolicy({
      entityType: 'user',
      recordTimestamp: oldDate,
      config,
    });

    expect(result.expired).toBe(true);
    expect(result.retentionDays).toBe(365);
    expect(result.ageInDays).toBeGreaterThan(365);
  });

  test('returns expired=false for a record within the configured retention period', () => {
    // A user record created 100 days ago is within the 365-day limit
    const recentDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const result = checkRetentionPolicy({
      entityType: 'user',
      recordTimestamp: recentDate,
      config,
    });

    expect(result.expired).toBe(false);
    expect(result.retentionDays).toBe(365);
    expect(result.ageInDays).toBeLessThan(365);
  });

  test('returns expired=false when retentionDays is null (keep indefinitely)', () => {
    // Tasks have retentionDays: null → never expire
    const veryOldDate = new Date(Date.now() - 10_000 * 24 * 60 * 60 * 1000);
    const result = checkRetentionPolicy({
      entityType: 'task',
      recordTimestamp: veryOldDate,
      config,
    });

    expect(result.expired).toBe(false);
    expect(result.retentionDays).toBeNull();
  });

  test('returns expired=false for entity types not in retention config', () => {
    const oldDate = new Date(Date.now() - 1000 * 24 * 60 * 60 * 1000);
    const result = checkRetentionPolicy({
      entityType: 'tag', // not in config
      recordTimestamp: oldDate,
      config,
    });

    expect(result.expired).toBe(false);
    expect(result.retentionDays).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// anonymizeRecord
// ---------------------------------------------------------------------------

describe('anonymizeRecord', () => {
  test('nulls out configured PII fields and leaves non-PII fields intact', async () => {
    const configWithoutSalt: GovernanceConfig = { retention: {} }; // no pseudonymSalt → null
    const properties = {
      username: 'alice',
      email: 'alice@example.com',
      phone: '555-1234',
      display_name: 'Alice',
      created_at: '2024-01-01',
    };

    const result = await anonymizeRecord({
      entityType: 'user',
      properties,
      piiFields: ['email', 'phone', 'display_name'],
      config: configWithoutSalt,
    });

    // PII fields must be null
    expect(result.anonymized.email).toBeNull();
    expect(result.anonymized.phone).toBeNull();
    expect(result.anonymized.display_name).toBeNull();

    // Non-PII fields must be untouched
    expect(result.anonymized.username).toBe('alice');
    expect(result.anonymized.created_at).toBe('2024-01-01');

    expect(result.redactedFields).toEqual(
      expect.arrayContaining(['email', 'phone', 'display_name']),
    );
    expect(result.redactedFields).toHaveLength(3);
  });

  test('produces stable pseudonyms for PII fields when pseudonymSalt is set', async () => {
    const properties = {
      username: 'bob',
      email: 'bob@example.com',
    };

    const result1 = await anonymizeRecord({
      entityType: 'user',
      properties,
      piiFields: ['email'],
      config,
    });

    const result2 = await anonymizeRecord({
      entityType: 'user',
      properties,
      piiFields: ['email'],
      config,
    });

    // Pseudonyms must be stable (same input → same output)
    expect(result1.anonymized.email).toBe(result2.anonymized.email);
    // Pseudonym must not be the original value
    expect(result1.anonymized.email).not.toBe('bob@example.com');
    // Non-PII fields untouched
    expect(result1.anonymized.username).toBe('bob');
  });

  test('skips fields absent from the properties object', async () => {
    const properties = { username: 'carol' }; // no email in properties
    const result = await anonymizeRecord({
      entityType: 'user',
      properties,
      piiFields: ['email'],
      config,
    });

    expect(result.anonymized.username).toBe('carol');
    expect('email' in result.anonymized).toBe(false);
    expect(result.redactedFields).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// generateComplianceReport
// ---------------------------------------------------------------------------

describe('generateComplianceReport', () => {
  test('returns expected data category and subject count structure', async () => {
    // Insert a test user entity to ensure at least one subject exists
    const userId = `user-compliance-test-${Date.now()}`;
    await sql`
      INSERT INTO entities (id, type, properties)
      VALUES (${userId}, 'user', '{"username": "compliance_test"}')
    `;

    const report = await generateComplianceReport(sql, config);

    expect(report.generatedAt).toBeTruthy();
    expect(new Date(report.generatedAt).getTime()).toBeGreaterThan(0);

    // Must include at least the 'user' category (seeded in schema + updated above)
    const userEntry = report.entries.find((e) => e.entityType === 'user');
    expect(userEntry).toBeDefined();
    expect(userEntry!.retentionDays).toBe(365);
    expect(userEntry!.subjectCount).toBeGreaterThanOrEqual(1);
    expect(userEntry!.piiFields).toEqual(
      expect.arrayContaining(['email', 'phone', 'display_name']),
    );

    // 'task' entry should have retentionDays: null (keep indefinitely)
    const taskEntry = report.entries.find((e) => e.entityType === 'task');
    expect(taskEntry).toBeDefined();
    expect(taskEntry!.retentionDays).toBeNull();

    // Clean up
    await sql`DELETE FROM entities WHERE id = ${userId}`;
  });
});

// ---------------------------------------------------------------------------
// handleDataSubjectRequest — erasure
// ---------------------------------------------------------------------------

describe('handleDataSubjectRequest (erasure)', () => {
  test('nulls PII columns and writes an audit log entry for an erasure request', async () => {
    // Insert a user entity with PII fields
    const subjectId = `user-erasure-test-${Date.now()}`;
    await sql`
      INSERT INTO entities (id, type, properties)
      VALUES (
        ${subjectId},
        'user',
        ${sql.json({
          username: 'david',
          email: 'david@example.com',
          phone: '555-9999',
          display_name: 'David',
        })}
      )
    `;

    const configWithNull: GovernanceConfig = { retention: {} }; // no pseudonymSalt → null
    const result = await handleDataSubjectRequest(
      sql,
      { kind: 'erasure', subjectId, actorId: 'actor-test-001' },
      configWithNull,
      makeAuditWriter(),
    );

    expect(result.kind).toBe('erasure');
    expect(result.subjectId).toBe(subjectId);

    // The erasure should have written the entity update
    const [updated] = await sql<{ properties: Record<string, unknown> }[]>`
      SELECT properties FROM entities WHERE id = ${subjectId}
    `;

    expect(updated.properties.email).toBeNull();
    expect(updated.properties.phone).toBeNull();
    expect(updated.properties.display_name).toBeNull();
    expect(updated.properties.username).toBe('david'); // non-PII preserved

    // Audit log entry should exist for this subject
    const auditRows = await auditSql<{ action: string; entity_id: string }[]>`
      SELECT action, entity_id FROM audit_events
      WHERE entity_id = ${subjectId} AND action = 'data_subject.erasure'
    `;
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(auditRows[0].action).toBe('data_subject.erasure');

    if (result.kind === 'erasure') {
      expect(result.auditEntryWritten).toBe(true);
      expect(result.fieldsErased).toEqual(
        expect.arrayContaining(['email', 'phone', 'display_name']),
      );
    }

    // Clean up
    await sql`DELETE FROM entities WHERE id = ${subjectId}`;
  });

  test('throws when the subject entity does not exist', async () => {
    await expect(
      handleDataSubjectRequest(
        sql,
        { kind: 'erasure', subjectId: 'nonexistent-id-xyz', actorId: 'actor-001' },
        config,
      ),
    ).rejects.toThrow(/Entity not found/);
  });
});

// ---------------------------------------------------------------------------
// handleDataSubjectRequest — export
// ---------------------------------------------------------------------------

describe('handleDataSubjectRequest (export)', () => {
  test('returns a complete data package for the subject including relations', async () => {
    // Insert a user entity and a related task
    const subjectId = `user-export-test-${Date.now()}`;
    const taskId = `task-export-test-${Date.now()}`;
    const relationId = `rel-export-test-${Date.now()}`;

    await sql`
      INSERT INTO entities (id, type, properties)
      VALUES (
        ${subjectId},
        'user',
        ${sql.json({ username: 'eve', email: 'eve@example.com' })}
      )
    `;

    await sql`
      INSERT INTO entities (id, type, properties)
      VALUES (
        ${taskId},
        'task',
        ${sql.json({ name: 'Eve task', owner: 'eve' })}
      )
    `;

    await sql`
      INSERT INTO relations (id, source_id, target_id, type)
      VALUES (${relationId}, ${subjectId}, ${taskId}, 'owns')
    `;

    const result = await handleDataSubjectRequest(
      sql,
      { kind: 'export', subjectId, actorId: 'actor-test-002' },
      config,
    );

    expect(result.kind).toBe('export');
    expect(result.subjectId).toBe(subjectId);

    if (result.kind === 'export') {
      expect(result.entityType).toBe('user');
      expect((result.properties as { username: string }).username).toBe('eve');
      expect((result.properties as { email: string }).email).toBe('eve@example.com');

      // Relations must be included
      expect(result.relations.length).toBeGreaterThanOrEqual(1);
      const ownedRelation = result.relations.find((r) => r.id === relationId);
      expect(ownedRelation).toBeDefined();
      expect(ownedRelation!.type).toBe('owns');
      expect(ownedRelation!.sourceId).toBe(subjectId);
      expect(ownedRelation!.targetId).toBe(taskId);
    }

    // Export must not modify the entity
    const [unchanged] = await sql<{ properties: Record<string, unknown> }[]>`
      SELECT properties FROM entities WHERE id = ${subjectId}
    `;
    expect((unchanged.properties as { email: string }).email).toBe('eve@example.com');

    // Clean up
    await sql`DELETE FROM relations WHERE id = ${relationId}`;
    await sql`DELETE FROM entities WHERE id = ${taskId}`;
    await sql`DELETE FROM entities WHERE id = ${subjectId}`;
  });
});
