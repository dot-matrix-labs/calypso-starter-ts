/**
 * Admin API — superuser-only API key management.
 *
 * POST   /api/admin/keys        — generates a new API key, returns raw key once
 * GET    /api/admin/keys        — lists API key metadata (no raw values)
 * DELETE /api/admin/keys/:id    — revokes an API key
 *
 * Superuser is determined by the SUPERUSER_ID environment variable.
 * All create and revoke operations are written to the audit log.
 */

import type { AppState } from '../index';
import { getCorsHeaders, getAuthenticatedUser } from './auth';
import { createApiKey, listApiKeys, deleteApiKey } from 'db/api-keys';
import { emitAuditEvent } from '../policies/audit-service';

function isSuperuser(userId: string): boolean {
  const superuserId = process.env.SUPERUSER_ID;
  if (!superuserId) return false;
  return userId === superuserId;
}

export async function handleAdminRequest(
  req: Request,
  url: URL,
  appState: AppState,
): Promise<Response | null> {
  void appState; // AppState reserved for future admin operations requiring direct db access
  if (!url.pathname.startsWith('/api/admin')) return null;

  const corsHeaders = getCorsHeaders(req);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

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

  return null;
}
