/**
 * @file api/users
 * User management API.
 *
 * DELETE /api/users/:id
 *   Deletes the specified user entity. Returns 409 Conflict if deleting the
 *   user would remove the last remaining superuser account, preventing the
 *   system from being locked out after a fresh deployment.
 *
 * Callers must be authenticated. The endpoint does not currently enforce that
 * only superusers may delete other users — that authorization layer is future
 * work.
 */

import type { AppState } from '../index';
import { getCorsHeaders, getAuthenticatedUser } from './auth';

export async function handleUsersRequest(
  req: Request,
  url: URL,
  appState: AppState,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/users')) return null;

  const corsHeaders = getCorsHeaders(req);
  const { sql } = appState;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  // DELETE /api/users/:id
  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/users\/[^/]+$/)) {
    const user = await getAuthenticatedUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const targetId = url.pathname.split('/')[3];

    // Verify the target user exists.
    const [target] = await sql<{ id: string; properties: { role?: string } }[]>`
      SELECT id, properties
      FROM entities
      WHERE id = ${targetId} AND type = 'user'
    `;

    if (!target) return json({ error: 'Not found' }, 404);

    // Guard: refuse if this would remove the last superuser.
    if (target.properties.role === 'superuser') {
      const superuserCount = await sql<{ count: string }[]>`
        SELECT COUNT(*) AS count
        FROM entities
        WHERE type = 'user'
          AND properties->>'role' = 'superuser'
      `;

      const remaining = Number(superuserCount[0]?.count ?? 0);
      if (remaining <= 1) {
        return json(
          {
            error: 'Cannot delete the last superuser account.',
            code: 'LAST_SUPERUSER',
          },
          409,
        );
      }
    }

    await sql`
      DELETE FROM entities WHERE id = ${targetId}
    `;

    return json({ success: true });
  }

  return null;
}
