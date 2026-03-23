/**
 * Task-queue result submission endpoint.
 *
 * POST /api/tasks/:id/result
 *
 * Workers submit results through this endpoint using a single-use delegated
 * token issued at task creation.  The endpoint:
 *   - Extracts the Bearer token from the Authorization header
 *   - Looks up the task_queue row to obtain expected agent_type and created_by
 *   - Delegates all 6 verification checks to verifyDelegatedToken
 *   - Records the result payload on success
 *
 * This route does NOT use the cookie-based session auth used by the rest of the
 * API.  Cookie auth would require the worker to hold a user session, violating
 * the principle that workers must not hold long-lived user credentials.
 */

import type { AppState } from '../index';
import { getCorsHeaders } from './auth';
import { verifyDelegatedToken } from '../auth/delegated-token';
import { makeJson } from '../lib/response';

export async function handleTaskQueueResultRequest(
  req: Request,
  url: URL,
  appState: AppState,
): Promise<Response | null> {
  // Match: POST /api/tasks/:id/result
  const match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/result$/);
  if (!match || req.method !== 'POST') return null;

  const taskId = match[1];
  const corsHeaders = getCorsHeaders(req);
  const { sql } = appState;
  const json = makeJson(corsHeaders);

  // Extract Bearer token from Authorization header
  const authHeader = req.headers.get('Authorization') ?? '';
  const tokenMatch = authHeader.match(/^Bearer (.+)$/);
  if (!tokenMatch) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const token = tokenMatch[1];

  // Fetch the task_queue row to get expected agent_type and created_by
  const rows = await sql<{ agent_type: string; created_by: string; status: string }[]>`
    SELECT agent_type, created_by, status
    FROM task_queue
    WHERE id = ${taskId}
  `;

  if (rows.length === 0) {
    return json({ error: 'Task not found' }, 404);
  }

  const task = rows[0];

  // Verify the delegated token (all 6 checks + JTI revocation)
  try {
    await verifyDelegatedToken(token, {
      expectedTaskId: taskId,
      expectedAgentType: task.agent_type,
      expectedCreatedBy: task.created_by,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid token';
    return json({ error: message }, 401);
  }

  // Parse and store the result
  let resultPayload: unknown;
  try {
    resultPayload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  await sql`
    UPDATE task_queue
    SET
      status = 'completed',
      result = ${sql.json(resultPayload as never)},
      updated_at = NOW()
    WHERE id = ${taskId}
  `;

  return json({ ok: true, task_id: taskId });
}
