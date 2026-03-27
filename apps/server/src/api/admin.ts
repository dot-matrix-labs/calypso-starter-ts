/**
 * Admin API — superuser-only endpoints.
 *
 * POST   /api/admin/keys        — generates a new API key, returns raw key once
 * GET    /api/admin/keys        — lists API key metadata (no raw values)
 * DELETE /api/admin/keys/:id    — revokes an API key
 * GET    /api/admin/task-queue   — lists recent task queue entries for monitoring
 * GET    /api/admin/findings     — aggregated findings from completed agent tasks
 *
 * GET    /api/admin/users       — paginated user list, optional ?role= filter
 * PATCH  /api/admin/users/:id   — change role or active status of a user
 *
 * Superuser is determined by the SUPERUSER_ID environment variable.
 * All create, revoke, role-change, and deactivation operations are audit-logged.
 */

import type { AppState } from '../index';
import { getCorsHeaders, getAuthenticatedUser } from './auth';
import { createApiKey, listApiKeys, deleteApiKey } from 'db/api-keys';
import { listTasksForAdmin, type TaskQueueStatus } from 'db/task-queue';
import { emitAuditEvent } from '../policies/audit-service';
import { isSuperuser, makeJson } from '../lib/response';

// Re-export isSuperuser so existing importers (e.g. users.ts) continue to work
// without an immediate cascading change.  Prefer importing directly from
// '../lib/response' in new code.
export { isSuperuser };

export async function handleAdminRequest(
  req: Request,
  url: URL,
  appState: AppState,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/admin')) return null;

  const corsHeaders = getCorsHeaders(req);
  const json = makeJson(corsHeaders);

  const user = await getAuthenticatedUser(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  if (!isSuperuser(user.id)) return json({ error: 'Forbidden' }, 403);

  // POST /api/admin/keys — create a new API key
  if (req.method === 'POST' && url.pathname === '/api/admin/keys') {
    let label: string;
    try {
      const body = await req.json();
      label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : '';
    } catch {
      label = '';
    }
    if (!label) {
      return json({ error: 'label is required' }, 400);
    }

    const { rawKey, row } = await createApiKey(label, user.id);

    // Audit the creation — never log the raw key, only the key id
    await emitAuditEvent({
      actor_id: user.id,
      action: 'api_key.create',
      entity_type: 'api_key',
      entity_id: row.id,
      before: null,
      after: { id: row.id, label: row.label, created_by: row.created_by },
      ts: new Date().toISOString(),
    }).catch((err) => console.warn('[audit] api_key.create audit write failed:', err));

    return json({ key: rawKey, id: row.id, label: row.label, created_at: row.created_at }, 201);
  }

  // GET /api/admin/keys — list API key metadata
  if (req.method === 'GET' && url.pathname === '/api/admin/keys') {
    const keys = await listApiKeys();
    return json(keys);
  }

  // DELETE /api/admin/keys/:id — revoke an API key
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/keys/')) {
    const id = url.pathname.split('/')[4];
    if (!id) return json({ error: 'Missing key id' }, 400);

    const deleted = await deleteApiKey(id);
    if (!deleted) return json({ error: 'Not found' }, 404);

    // Audit the revocation
    await emitAuditEvent({
      actor_id: user.id,
      action: 'api_key.revoke',
      entity_type: 'api_key',
      entity_id: id,
      before: { id },
      after: null,
      ts: new Date().toISOString(),
    }).catch((err) => console.warn('[audit] api_key.revoke audit write failed:', err));

    return json({ success: true });
  }

  // GET /api/admin/task-queue — list recent task queue entries for monitoring.
  // Supports optional query parameters:
  //   ?status=<pending|claimed|running|submitting|completed|failed|dead>
  //   ?agent_type=<string>
  //   ?limit=<number>   (default 50, max 200)
  //   ?offset=<number>  (default 0)
  // Response excludes sensitive fields (payload, delegated_token).
  if (req.method === 'GET' && url.pathname === '/api/admin/task-queue') {
    const statusParam = url.searchParams.get('status') ?? undefined;
    const agentTypeParam = url.searchParams.get('agent_type') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');

    // Validate status if provided
    const allowedStatuses: TaskQueueStatus[] = [
      'pending',
      'claimed',
      'running',
      'submitting',
      'completed',
      'failed',
      'dead',
    ];
    if (statusParam && !allowedStatuses.includes(statusParam as TaskQueueStatus)) {
      return json({ error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` }, 400);
    }

    const limit = Math.min(Math.max(parseInt(limitParam ?? '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(offsetParam ?? '0', 10) || 0, 0);

    const tasks = await listTasksForAdmin({
      status: statusParam as TaskQueueStatus | undefined,
      agent_type: agentTypeParam,
      limit,
      offset,
    });

    return json({ tasks, limit, offset });
  }

  // GET /api/admin/findings — aggregate structured findings from completed self-improving agent tasks.
  // Supported agent types: security, soc_compliance, runtime_errors, code_cleanup.
  // Each finding in the task result must conform to: { severity, file_path, description, remediation }.
  // Optional query parameters:
  //   ?agent_type=<string>  — filter to a single agent type
  //   ?limit=<number>       (default 200, max 500)
  //   ?offset=<number>      (default 0)
  if (req.method === 'GET' && url.pathname === '/api/admin/findings') {
    const { sql: appSql } = appState;

    const agentTypeParam = url.searchParams.get('agent_type') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');

    const limit = Math.min(Math.max(parseInt(limitParam ?? '200', 10) || 200, 1), 500);
    const offset = Math.max(parseInt(offsetParam ?? '0', 10) || 0, 0);

    // Known self-improving agent types that produce structured findings
    const FINDINGS_AGENT_TYPES = [
      'security',
      'soc_compliance',
      'runtime_errors',
      'code_cleanup',
    ] as const;

    // Query completed tasks from the findings-producing agent types
    interface CompletedTaskRow {
      id: string;
      agent_type: string;
      result: Record<string, unknown> | null;
      completed_at: Date | null;
      updated_at: Date;
    }

    const agentFilter = agentTypeParam ?? null;

    const rows = await appSql<CompletedTaskRow[]>`
      SELECT id, agent_type, result, completed_at, updated_at
      FROM task_queue
      WHERE status = 'completed'
        AND result IS NOT NULL
        AND agent_type = ANY(${appSql.array(FINDINGS_AGENT_TYPES as unknown as string[])})
        ${agentFilter ? appSql`AND agent_type = ${agentFilter}` : appSql``}
      ORDER BY updated_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    // Extract findings from task results — each result may contain a `findings` array
    interface RawFinding {
      severity?: string;
      file_path?: string;
      description?: string;
      remediation?: string;
      [key: string]: unknown;
    }

    interface Finding {
      task_id: string;
      agent_type: string;
      severity: string;
      file_path: string;
      description: string;
      remediation: string;
      scanned_at: string;
    }

    const findings: Finding[] = [];

    for (const row of rows) {
      if (!row.result) continue;
      const rawFindings = Array.isArray(row.result.findings) ? row.result.findings : [];
      const scannedAt = row.completed_at
        ? new Date(row.completed_at).toISOString()
        : new Date(row.updated_at).toISOString();

      for (const f of rawFindings as RawFinding[]) {
        if (typeof f !== 'object' || f === null) continue;
        findings.push({
          task_id: row.id,
          agent_type: row.agent_type,
          severity: typeof f.severity === 'string' ? f.severity : 'unknown',
          file_path: typeof f.file_path === 'string' ? f.file_path : '',
          description: typeof f.description === 'string' ? f.description : '',
          remediation: typeof f.remediation === 'string' ? f.remediation : '',
          scanned_at: scannedAt,
        });
      }
    }

    // Build summary counts per agent type and severity
    const summary: Record<string, Record<string, number>> = {};
    for (const at of FINDINGS_AGENT_TYPES) {
      summary[at] = {};
    }

    for (const f of findings) {
      if (!summary[f.agent_type]) summary[f.agent_type] = {};
      summary[f.agent_type][f.severity] = (summary[f.agent_type][f.severity] ?? 0) + 1;
    }

    return json({ findings, summary, limit, offset });
  }

  // -----------------------------------------------------------------------
  // User management endpoints
  // -----------------------------------------------------------------------

  const { sql } = appState;

  // GET /api/admin/users — paginated user list with optional role filter
  if (req.method === 'GET' && url.pathname === '/api/admin/users') {
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
    const offset = (page - 1) * limit;
    const roleFilter = url.searchParams.get('role') ?? null;

    interface UserRow {
      id: string;
      properties: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }

    let users: UserRow[];
    let totalRows: { count: string }[];

    if (roleFilter) {
      users = await sql<UserRow[]>`
        SELECT id, properties, created_at, updated_at
        FROM entities
        WHERE type = 'user'
          AND properties->>'role' = ${roleFilter}
        ORDER BY created_at ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
      totalRows = await sql<{ count: string }[]>`
        SELECT COUNT(*) AS count
        FROM entities
        WHERE type = 'user'
          AND properties->>'role' = ${roleFilter}
      `;
    } else {
      users = await sql<UserRow[]>`
        SELECT id, properties, created_at, updated_at
        FROM entities
        WHERE type = 'user'
        ORDER BY created_at ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
      totalRows = await sql<{ count: string }[]>`
        SELECT COUNT(*) AS count
        FROM entities
        WHERE type = 'user'
      `;
    }

    const total = Number(totalRows[0]?.count ?? 0);

    // Strip password hashes from the response
    const sanitized = users.map((u) => {
      const { password_hash: _pwHash, ...safeProps } = u.properties as Record<string, unknown> & {
        password_hash?: string;
      };
      void _pwHash;
      return {
        id: u.id,
        properties: safeProps,
        created_at: u.created_at,
        updated_at: u.updated_at,
      };
    });

    return json({ users: sanitized, total, page, limit });
  }

  // PATCH /api/admin/users/:id — change role or active status
  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/users\/[^/]+$/)) {
    const targetId = url.pathname.split('/')[4];
    if (!targetId) return json({ error: 'Missing user id' }, 400);

    let body: { role?: string; active?: boolean };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    // Validate that at least one field is provided
    if (body.role === undefined && body.active === undefined) {
      return json({ error: 'At least one of role or active must be provided' }, 400);
    }

    // Look up the target user
    const [target] = await sql<{ id: string; properties: Record<string, unknown> }[]>`
      SELECT id, properties
      FROM entities
      WHERE id = ${targetId} AND type = 'user'
    `;

    if (!target) return json({ error: 'Not found' }, 404);

    const beforeProps = { ...target.properties };
    const updatedProps = { ...target.properties };

    if (body.role !== undefined) {
      updatedProps.role = body.role;
    }

    if (body.active !== undefined) {
      updatedProps.active = body.active;
    }

    await sql`
      UPDATE entities
      SET properties = ${sql.json(updatedProps as never)},
          updated_at = NOW()
      WHERE id = ${targetId}
    `;

    // Audit log — role changes
    if (body.role !== undefined && body.role !== beforeProps.role) {
      await emitAuditEvent({
        actor_id: user.id,
        action: 'user.role_change',
        entity_type: 'user',
        entity_id: targetId,
        before: { role: beforeProps.role ?? null },
        after: { role: body.role },
        ts: new Date().toISOString(),
      }).catch((err) => console.warn('[audit] user.role_change audit write failed:', err));
    }

    // Audit log — activation / deactivation
    if (body.active !== undefined && body.active !== beforeProps.active) {
      await emitAuditEvent({
        actor_id: user.id,
        action: body.active ? 'user.reactivate' : 'user.deactivate',
        entity_type: 'user',
        entity_id: targetId,
        before: { active: beforeProps.active ?? null },
        after: { active: body.active },
        ts: new Date().toISOString(),
      }).catch((err) => console.warn('[audit] user.active_change audit write failed:', err));
    }

    // Return updated user without password hash
    const { password_hash: _pwHash2, ...safeProps } = updatedProps as Record<string, unknown> & {
      password_hash?: string;
    };
    void _pwHash2;
    return json({ id: targetId, properties: safeProps });
  }

  return null;
}
