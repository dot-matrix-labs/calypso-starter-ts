/**
 * Audit API — superuser-only audit log verification endpoint.
 *
 * GET /api/audit/verify
 *   Reads all rows in insertion order, recomputes each hash from the chain,
 *   and returns { valid: true } or { valid: false, firstInvalidId: '<uuid>' }.
 *
 * Superuser is determined by the SUPERUSER_ID environment variable.
 * If it is not set, this endpoint returns 403 to all callers.
 */

import type { AppState } from '../index';
import { getCorsHeaders, getAuthenticatedUser } from './auth';
import { computeAuditHash } from 'core';
import { isSuperuser, makeJson } from '../lib/response';

const DEFAULT_GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

function resolveGenesisHash(): string {
  return process.env.AUDIT_GENESIS_HASH ?? DEFAULT_GENESIS_HASH;
}

export async function handleAuditRequest(
  req: Request,
  url: URL,
  appState: AppState,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/audit')) return null;

  const corsHeaders = getCorsHeaders(req);
  const { auditSql } = appState;
  const json = makeJson(corsHeaders);

  // GET /api/audit/verify — superuser only
  if (req.method === 'GET' && url.pathname === '/api/audit/verify') {
    const user = await getAuthenticatedUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    if (!isSuperuser(user.id)) return json({ error: 'Forbidden' }, 403);

    interface AuditRow {
      id: string;
      actor_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      ts: string;
      prev_hash: string;
      hash: string;
    }

    const rows = await auditSql<AuditRow[]>`
      SELECT id, actor_id, action, entity_type, entity_id, before, after, ts, prev_hash, hash
      FROM audit_events
      ORDER BY ts ASC, id ASC
    `;

    if (rows.length === 0) {
      return json({ valid: true });
    }

    let expectedPrevHash = resolveGenesisHash();

    for (const row of rows) {
      if (row.prev_hash !== expectedPrevHash) {
        return json({ valid: false, firstInvalidId: row.id });
      }

      const computed = await computeAuditHash(row.prev_hash, {
        actor_id: row.actor_id,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        before: row.before,
        after: row.after,
        ts: typeof row.ts === 'string' ? row.ts : (row.ts as Date).toISOString(),
      });

      if (computed !== row.hash) {
        return json({ valid: false, firstInvalidId: row.id });
      }

      expectedPrevHash = row.hash;
    }

    return json({ valid: true });
  }

  return null;
}
