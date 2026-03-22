/**
 * Worker startup role verification.
 *
 * Blueprint reference: TQ-C-008 `startup-role-verification-tested`
 *
 * On startup, the worker queries whether the currently connected database role
 * has INSERT privilege on the `task_queue` table. If it does, the worker logs
 * an error and calls `process.exit(1)` — it refuses to start with a write-capable
 * role. This ensures that even a misconfigured deployment fails loudly rather than
 * silently operating with excessive DB privileges.
 *
 * A read-only agent role must never have INSERT on task_queue. If this check fires,
 * it means the wrong credentials were injected into AGENT_DATABASE_URL.
 */

export interface VerifyResult {
  canInsert: boolean;
}

export async function verifyReadOnlyRole(db: {
  unsafe: (sql: string) => Promise<{ can_insert: boolean }[]>;
}): Promise<VerifyResult> {
  const rows = await db.unsafe(
    `SELECT has_table_privilege(current_user, 'task_queue', 'INSERT') AS can_insert`,
  );
  return { canInsert: rows[0]?.can_insert ?? false };
}

export async function assertReadOnlyRole(
  db: { unsafe: (sql: string) => Promise<{ can_insert: boolean }[]> },
  logger: { error: (msg: string) => void } = console,
): Promise<void> {
  const { canInsert } = await verifyReadOnlyRole(db);
  if (canInsert) {
    logger.error(
      'Worker DB role has INSERT on task_queue — refusing to start. ' +
        'Check AGENT_DATABASE_URL and ensure it uses a read-only agent role.',
    );
    process.exit(1);
  }
}
