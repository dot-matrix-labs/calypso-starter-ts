/**
 * @file api/users
 * User management API.
 *
 * DELETE /api/users/:id
 *   Deletes the specified user entity. Returns 403 Forbidden unless the caller
 *   is the target user themselves or a superuser. Returns 409 Conflict if
 *   deleting the user would remove the last remaining superuser account,
 *   preventing the system from being locked out after a fresh deployment.
 *
 * Callers must be authenticated and authorized.
 */

import type { AppState } from '../index';
import { getCorsHeaders, getAuthenticatedUser } from './auth';
import { isSuperuser, makeJson } from '../lib/response';

export async function handleUsersRequest(
  req: Request,
  url: URL,
  appState: AppState,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/users')) return null;

  const corsHeaders = getCorsHeaders(req);
  const { sql } = appState;
  const json = makeJson(corsHeaders);

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

    // Authorisation: only the user themselves or a superuser may delete.
    if (user.id !== targetId && !isSuperuser(user.id)) {
      return json({ error: 'Forbidden' }, 403);
    }

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
