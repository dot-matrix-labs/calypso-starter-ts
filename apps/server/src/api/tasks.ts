import type { AppState } from '../index';
import type { Task, TaskProperties } from 'core';
import { getCorsHeaders, getAuthenticatedUser, parseCookies } from './auth';
import { applyTaskPatchThroughBoundary } from '../policies/task-write-service';
import { verifyCsrf } from '../auth/csrf';

// Starter task note:
// Task CRUD currently mutates entity rows directly. That is acceptable for the
// current scaffold features, but it is below the target enterprise posture for
// consequential operations. Future state changes that carry financial,
// approval, or agentic workflow significance should move behind a journaled
// write boundary with dual attribution and replay support.

function rowToTask(row: { id: string; properties: TaskProperties; created_at: string }): Task {
  const p = row.properties;
  return {
    id: row.id,
    name: p.name,
    description: p.description ?? '',
    owner: p.owner ?? '',
    priority: p.priority ?? 'medium',
    status: p.status ?? 'todo',
    estimateStart: p.estimateStart ?? null,
    estimatedDeliver: p.estimatedDeliver ?? null,
    dependsOn: p.dependsOn ?? [],
    tags: p.tags ?? [],
    createdAt: row.created_at,
  };
}

export async function handleTasksRequest(
  req: Request,
  url: URL,
  appState: AppState,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/tasks')) return null;

  const corsHeaders = getCorsHeaders(req);
  const { sql } = appState;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const user = await getAuthenticatedUser(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // CSRF check for state-mutating methods
  const cookies = parseCookies(req.headers.get('Cookie'));
  const csrfError = verifyCsrf(req, cookies);
  if (csrfError) return csrfError;

  // GET /api/tasks
  if (req.method === 'GET' && url.pathname === '/api/tasks') {
    const rows = await sql<{ id: string; properties: TaskProperties; created_at: string }[]>`
      SELECT id, properties, created_at
      FROM entities
      WHERE type = 'task'
      ORDER BY created_at DESC
    `;
    return json(rows.map(rowToTask));
  }

  // POST /api/tasks
  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    const body = await req.json();
    const {
      name,
      description = '',
      owner = '',
      priority = 'medium',
      status = 'todo',
      estimateStart = null,
      estimatedDeliver = null,
      dependsOn = [],
      tags = [],
    } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return json({ error: 'name is required' }, 400);
    }

    const id = crypto.randomUUID();
    const properties: TaskProperties = {
      name: name.trim(),
      description,
      owner,
      priority,
      status,
      estimateStart,
      estimatedDeliver,
      dependsOn,
      tags,
    };

    const [row] = await sql<{ id: string; properties: TaskProperties; created_at: string }[]>`
      INSERT INTO entities (id, type, properties, tenant_id)
      VALUES (${id}, 'task', ${sql.json(properties as never)}, null)
      RETURNING id, properties, created_at
    `;

    return json(rowToTask(row), 201);
  }

  // PATCH /api/tasks/:id — partial update (status, etc.)
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/tasks/')) {
    const id = url.pathname.split('/')[3];
    const body = await req.json();

    const [existing] = await sql<{ properties: TaskProperties }[]>`
      SELECT properties FROM entities WHERE id = ${id} AND type = 'task'
    `;
    if (!existing) return json({ error: 'Not found' }, 404);

    const row = await applyTaskPatchThroughBoundary({
      taskId: id,
      current: existing.properties,
      patch: body,
      principal: {
        id: user.id,
        kind: 'human',
      },
      reason: 'task.patch',
    });

    return json(rowToTask(row));
  }

  return null;
}
