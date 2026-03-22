/**
 * Audit service — append-only, hash-chained audit event writer.
 *
 * Every call to emitAuditEvent:
 *  1. Fetches the hash from the most recently inserted audit row (or the
 *     genesis hash when the table is empty).
 *  2. Computes the SHA-256 hash chain entry for the new event.
 *  3. Inserts the row into the audit_events table.
 *
 * The caller MUST invoke this BEFORE committing the primary database write.
 * If the audit write fails the primary write must not proceed.
 */

import { auditSql } from 'db';
import { computeAuditHash, type AuditEventInput, type AuditEventRow } from 'core';

const DEFAULT_GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

function resolveGenesisHash(): string {
  return process.env.AUDIT_GENESIS_HASH ?? DEFAULT_GENESIS_HASH;
}

/**
 * Writes one audit event to the append-only hash-chained audit log.
 *
 * @throws if the insert fails — callers must treat this as fatal and abort
 *         the associated primary database write.
 */
export async function emitAuditEvent(event: AuditEventInput): Promise<AuditEventRow> {
  // Fetch the latest hash inside a serialisable transaction so concurrent
  // writers do not race on prev_hash selection.
  const result = await auditSql.begin(async (tx) => {
    // Lock the most recent row to prevent concurrent inserts racing on prev_hash.
    const latestRows = (await tx`
      SELECT hash FROM audit_events ORDER BY ts DESC, id DESC LIMIT 1 FOR UPDATE
    `) as unknown as { hash: string }[];

    const prevHash = latestRows[0]?.hash ?? resolveGenesisHash();

    const hash = await computeAuditHash(prevHash, event);

    const rows = (await tx`
      INSERT INTO audit_events (actor_id, action, entity_type, entity_id, before, after, ip, user_agent, ts, prev_hash, hash)
      VALUES (
        ${event.actor_id},
        ${event.action},
        ${event.entity_type},
        ${event.entity_id},
        ${event.before !== null ? tx.json(event.before as never) : null},
        ${event.after !== null ? tx.json(event.after as never) : null},
        ${event.ip ?? null},
        ${event.user_agent ?? null},
        ${event.ts}::timestamptz,
        ${prevHash},
        ${hash}
      )
      RETURNING id, actor_id, action, entity_type, entity_id, before, after, ip, user_agent, ts, prev_hash, hash
    `) as unknown as AuditEventRow[];

    return rows[0];
  });

  return result;
}
