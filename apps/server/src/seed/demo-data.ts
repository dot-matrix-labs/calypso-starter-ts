/**
 * @file seed/demo-data
 * Idempotent demo sample data seeding for DEMO_MODE.
 *
 * When `DEMO_MODE=true` is set in the environment, this module seeds sample
 * entities, task queue entries, and relations after demo personas have been
 * created. The goal is to give the admin dashboard and task queue monitor
 * meaningful data to render on first boot.
 *
 * Seeding is idempotent: a sentinel entity with a well-known ID is checked on
 * each run. If it exists, seeding is skipped entirely.
 *
 * All sample data is owned by the demo personas created by demo-personas.ts.
 */

import type { sql as SqlPool } from 'db';

export interface SeedDemoDataOptions {
  /** postgres.js connection pool to the app database */
  sql: typeof SqlPool;
}

/** Well-known sentinel entity ID used to detect prior seeding. */
export const DEMO_DATA_SENTINEL_ID = 'demo-data-sentinel-00000000';

/** Demo persona emails used to look up owner IDs. */
const DEMO_ADMIN_EMAIL = 'demo-admin@calypso.local';
const DEMO_USER_EMAIL = 'demo-user@calypso.local';

/**
 * Seed sample entities, task queue entries, and relations when DEMO_MODE is
 * enabled.
 *
 * Must be called after migrations and after seedDemoPersonas so the demo
 * persona entities exist.
 */
export async function seedDemoData({ sql }: SeedDemoDataOptions): Promise<void> {
  if (process.env.DEMO_MODE !== 'true') {
    return;
  }

  // Idempotency check: if sentinel entity exists, skip entirely.
  const sentinel = await sql`
    SELECT id FROM entities WHERE id = ${DEMO_DATA_SENTINEL_ID} LIMIT 1
  `;
  if (sentinel.length > 0) {
    console.log('[demo] Sample data already seeded — skipping.');
    return;
  }

  console.log('[demo] Seeding sample entities, task queue entries, and relations.');

  // Look up demo persona IDs.
  const adminRows = await sql`
    SELECT id FROM entities
    WHERE type = 'user' AND properties->>'email' = ${DEMO_ADMIN_EMAIL}
    LIMIT 1
  `;
  const userRows = await sql`
    SELECT id FROM entities
    WHERE type = 'user' AND properties->>'email' = ${DEMO_USER_EMAIL}
    LIMIT 1
  `;

  if (adminRows.length === 0 || userRows.length === 0) {
    console.warn('[demo] Demo personas not found — skipping sample data seeding.');
    return;
  }

  const adminId = adminRows[0].id as string;
  const userId = userRows[0].id as string;

  // ---- Sample entities ----

  const sampleEntities = [
    // Sentinel entity (tag type) — also acts as a real demo tag
    {
      id: DEMO_DATA_SENTINEL_ID,
      type: 'tag',
      properties: { name: 'demo-seed', description: 'Sentinel tag for demo data seeding' },
    },
    // Tags
    {
      id: 'demo-tag-urgent',
      type: 'tag',
      properties: { name: 'urgent', color: '#e74c3c' },
    },
    {
      id: 'demo-tag-backend',
      type: 'tag',
      properties: { name: 'backend', color: '#3498db' },
    },
    {
      id: 'demo-tag-frontend',
      type: 'tag',
      properties: { name: 'frontend', color: '#2ecc71' },
    },
    // Tasks
    {
      id: 'demo-task-001',
      type: 'task',
      properties: {
        title: 'Review pull request #42',
        status: 'open',
        priority: 'high',
        assignee: adminId,
        description: 'Review the authentication refactor PR and provide feedback.',
      },
    },
    {
      id: 'demo-task-002',
      type: 'task',
      properties: {
        title: 'Update API documentation',
        status: 'in_progress',
        priority: 'medium',
        assignee: userId,
        description: 'Ensure all new endpoints are documented with request/response examples.',
      },
    },
    {
      id: 'demo-task-003',
      type: 'task',
      properties: {
        title: 'Fix dashboard chart rendering',
        status: 'done',
        priority: 'low',
        assignee: userId,
        description: 'The pie chart on the admin dashboard does not render on mobile viewports.',
      },
    },
    {
      id: 'demo-task-004',
      type: 'task',
      properties: {
        title: 'Set up CI pipeline for staging',
        status: 'open',
        priority: 'high',
        assignee: adminId,
        description: 'Configure GitHub Actions workflow for automated deployment to staging.',
      },
    },
    // Channels
    {
      id: 'demo-channel-general',
      type: 'channel',
      properties: { name: 'general', topic: 'General discussion', created_by: adminId },
    },
    {
      id: 'demo-channel-engineering',
      type: 'channel',
      properties: { name: 'engineering', topic: 'Engineering team updates', created_by: adminId },
    },
    // Messages
    {
      id: 'demo-msg-001',
      type: 'message',
      properties: {
        body: 'Welcome to the demo workspace! This is a sample message.',
        author: adminId,
        channel: 'demo-channel-general',
      },
    },
    {
      id: 'demo-msg-002',
      type: 'message',
      properties: {
        body: 'Sprint planning starts Monday. Please update your task statuses.',
        author: userId,
        channel: 'demo-channel-engineering',
      },
    },
  ];

  for (const entity of sampleEntities) {
    await sql`
      INSERT INTO entities (id, type, properties, tenant_id)
      VALUES (${entity.id}, ${entity.type}, ${sql.json(entity.properties as never)}, null)
      ON CONFLICT (id) DO NOTHING
    `;
  }

  console.log(`[demo] Seeded ${sampleEntities.length} sample entities.`);

  // ---- Relations between entities ----

  const sampleRelations = [
    // Tags on tasks
    {
      id: 'demo-rel-001',
      source_id: 'demo-task-001',
      target_id: 'demo-tag-urgent',
      type: 'tagged_with',
      properties: {},
    },
    {
      id: 'demo-rel-002',
      source_id: 'demo-task-001',
      target_id: 'demo-tag-backend',
      type: 'tagged_with',
      properties: {},
    },
    {
      id: 'demo-rel-003',
      source_id: 'demo-task-002',
      target_id: 'demo-tag-backend',
      type: 'tagged_with',
      properties: {},
    },
    {
      id: 'demo-rel-004',
      source_id: 'demo-task-003',
      target_id: 'demo-tag-frontend',
      type: 'tagged_with',
      properties: {},
    },
    {
      id: 'demo-rel-005',
      source_id: 'demo-task-004',
      target_id: 'demo-tag-urgent',
      type: 'tagged_with',
      properties: {},
    },
    // Tasks assigned to users
    {
      id: 'demo-rel-006',
      source_id: 'demo-task-001',
      target_id: adminId,
      type: 'assigned_to',
      properties: {},
    },
    {
      id: 'demo-rel-007',
      source_id: 'demo-task-002',
      target_id: userId,
      type: 'assigned_to',
      properties: {},
    },
    {
      id: 'demo-rel-008',
      source_id: 'demo-task-003',
      target_id: userId,
      type: 'assigned_to',
      properties: {},
    },
    {
      id: 'demo-rel-009',
      source_id: 'demo-task-004',
      target_id: adminId,
      type: 'assigned_to',
      properties: {},
    },
    // Messages in channels
    {
      id: 'demo-rel-010',
      source_id: 'demo-msg-001',
      target_id: 'demo-channel-general',
      type: 'posted_in',
      properties: {},
    },
    {
      id: 'demo-rel-011',
      source_id: 'demo-msg-002',
      target_id: 'demo-channel-engineering',
      type: 'posted_in',
      properties: {},
    },
    // Users are members of channels
    {
      id: 'demo-rel-012',
      source_id: adminId,
      target_id: 'demo-channel-general',
      type: 'member_of',
      properties: { role: 'owner' },
    },
    {
      id: 'demo-rel-013',
      source_id: userId,
      target_id: 'demo-channel-general',
      type: 'member_of',
      properties: { role: 'member' },
    },
    {
      id: 'demo-rel-014',
      source_id: adminId,
      target_id: 'demo-channel-engineering',
      type: 'member_of',
      properties: { role: 'owner' },
    },
    {
      id: 'demo-rel-015',
      source_id: userId,
      target_id: 'demo-channel-engineering',
      type: 'member_of',
      properties: { role: 'member' },
    },
  ];

  for (const rel of sampleRelations) {
    await sql`
      INSERT INTO relations (id, source_id, target_id, type, properties)
      VALUES (${rel.id}, ${rel.source_id}, ${rel.target_id}, ${rel.type}, ${sql.json(rel.properties as never)})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  console.log(`[demo] Seeded ${sampleRelations.length} relations.`);

  // ---- Task queue entries with varied statuses ----

  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
  const tenMinAgo = new Date(now.getTime() - 10 * 60_000);
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60_000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60_000);

  const sampleTasks = [
    {
      id: 'demo-tq-001',
      idempotency_key: 'demo-tq-001',
      agent_type: 'coding',
      job_type: 'code_review',
      status: 'completed',
      payload: { pr_number: 42, repo: 'calypso-starter-ts' },
      created_by: adminId,
      correlation_id: 'demo-corr-001',
      result: { summary: 'No issues found. LGTM.', files_reviewed: 8 },
      attempt: 1,
      max_attempts: 3,
      priority: 5,
      created_at: oneHourAgo,
      updated_at: thirtyMinAgo,
    },
    {
      id: 'demo-tq-002',
      idempotency_key: 'demo-tq-002',
      agent_type: 'analysis',
      job_type: 'dependency_audit',
      status: 'completed',
      payload: { scope: 'production', format: 'json' },
      created_by: adminId,
      correlation_id: 'demo-corr-002',
      result: { vulnerabilities: 0, outdated: 3, packages_scanned: 127 },
      attempt: 1,
      max_attempts: 3,
      priority: 3,
      created_at: oneHourAgo,
      updated_at: fiveMinAgo,
    },
    {
      id: 'demo-tq-003',
      idempotency_key: 'demo-tq-003',
      agent_type: 'coding',
      job_type: 'code_generation',
      status: 'failed',
      payload: { template: 'api-endpoint', name: 'invoices' },
      created_by: userId,
      correlation_id: 'demo-corr-003',
      error_message: 'Template validation failed: missing required field "schema".',
      attempt: 3,
      max_attempts: 3,
      priority: 5,
      created_at: thirtyMinAgo,
      updated_at: tenMinAgo,
    },
    {
      id: 'demo-tq-004',
      idempotency_key: 'demo-tq-004',
      agent_type: 'analysis',
      job_type: 'test_coverage',
      status: 'running',
      payload: { target: 'apps/server', threshold: 80 },
      created_by: userId,
      correlation_id: 'demo-corr-004',
      claimed_by: 'worker-analysis-01',
      claimed_at: fiveMinAgo,
      claim_expires_at: new Date(now.getTime() + 25 * 60_000),
      attempt: 1,
      max_attempts: 3,
      priority: 5,
      created_at: tenMinAgo,
      updated_at: fiveMinAgo,
    },
    {
      id: 'demo-tq-005',
      idempotency_key: 'demo-tq-005',
      agent_type: 'coding',
      job_type: 'lint_fix',
      status: 'pending',
      payload: { files: ['src/api/admin.ts', 'src/api/tasks.ts'], auto_commit: false },
      created_by: adminId,
      correlation_id: 'demo-corr-005',
      attempt: 0,
      max_attempts: 3,
      priority: 7,
      created_at: fiveMinAgo,
      updated_at: fiveMinAgo,
    },
    {
      id: 'demo-tq-006',
      idempotency_key: 'demo-tq-006',
      agent_type: 'coding',
      job_type: 'code_review',
      status: 'pending',
      payload: { pr_number: 55, repo: 'calypso-starter-ts' },
      created_by: userId,
      correlation_id: 'demo-corr-006',
      attempt: 0,
      max_attempts: 3,
      priority: 5,
      created_at: now,
      updated_at: now,
    },
  ];

  for (const task of sampleTasks) {
    await sql`
      INSERT INTO task_queue (
        id, idempotency_key, agent_type, job_type, status, payload,
        created_by, correlation_id, claimed_by, claimed_at, claim_expires_at,
        result, error_message, attempt, max_attempts, priority,
        created_at, updated_at
      )
      VALUES (
        ${task.id},
        ${task.idempotency_key},
        ${task.agent_type},
        ${task.job_type},
        ${task.status},
        ${sql.json(task.payload as never)},
        ${task.created_by},
        ${task.correlation_id},
        ${'claimed_by' in task ? ((task as Record<string, unknown>).claimed_by as string) : null},
        ${'claimed_at' in task ? ((task as Record<string, unknown>).claimed_at as Date) : null},
        ${'claim_expires_at' in task ? ((task as Record<string, unknown>).claim_expires_at as Date) : null},
        ${'result' in task ? sql.json((task as Record<string, unknown>).result as never) : null},
        ${'error_message' in task ? ((task as Record<string, unknown>).error_message as string) : null},
        ${task.attempt},
        ${task.max_attempts},
        ${task.priority},
        ${task.created_at},
        ${task.updated_at}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  console.log(`[demo] Seeded ${sampleTasks.length} task queue entries.`);
  console.log('[demo] Sample data seeding complete.');
}
