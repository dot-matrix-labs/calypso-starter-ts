/**
 * @file worker-channel.ts
 *
 * Split-channel worker credential model.
 *
 * Provides explicit types and validation for the two independent credential
 * paths each worker uses:
 *
 * 1. Queue channel credential (`queueDatabaseUrl`)
 *    - Read-only PostgreSQL connection using the per-type agent role.
 *    - Can only SELECT from the agent-type-specific task queue view.
 *    - Cannot write to any table (INSERT/UPDATE/DELETE denied at DB level).
 *    - Independently revocable by rotating the DB role password.
 *
 * 2. Write channel credential (`delegatedToken`)
 *    - Single-use JWT issued at task creation, embedded in the task row.
 *    - Scoped to a specific task ID; consumed on first use.
 *    - Cannot be used to subscribe to the queue or read other tasks.
 *    - Independently revocable via the JTI revocation table.
 *
 * The two channels are deliberately disjoint: compromising one does not grant
 * capability on the other. This limits blast radius for credential leaks.
 *
 * Security constraints
 * ---------------------
 * - A queue credential must never have write authority to any table.
 * - A delegated write token must never grant queue subscription privileges.
 * - Both channels must be independently revocable and auditable.
 *
 * Blueprint reference: WORKER domain
 *   WORKER-T-002  (compromised credential grants DB write)
 *   WORKER-T-001  (agent bypasses API layer)
 */

/**
 * Split-channel credential pair for a single worker instance.
 *
 * Each field represents an independent, non-overlapping access path.
 * Workers must use only the designated credential for each operation.
 */
export interface WorkerChannelCredentials {
  /**
   * Queue-facing credential (PostgreSQL connection string).
   *
   * - Agent-type-specific role (e.g. agent_coding).
   * - SELECT-only on task_queue_view_<agentType>.
   * - No INSERT/UPDATE/DELETE on any table.
   * - No write authority to the API or any other system.
   */
  queueDatabaseUrl: string;

  /**
   * Write-channel credential (single-use JWT).
   *
   * - Scoped to the specific task that was claimed.
   * - Authorises exactly one result submission to the API.
   * - Cannot be used to claim or read queue items.
   * - Consumed and invalidated after first successful use.
   */
  delegatedToken: string;

  /** The agent type this credential pair is scoped to (e.g. "coding"). */
  agentType: string;

  /** The task ID this credential pair was issued for. */
  taskId: string;
}

/**
 * Validate that a queue database URL follows the per-type agent role convention.
 *
 * The URL must use a role name matching `agent_<agentType>`.  This is a
 * structural check — it does not verify DB connectivity or role capabilities.
 *
 * @throws {Error} When the role name does not match the expected pattern.
 */
export function assertQueueCredentialScope(queueDatabaseUrl: string, agentType: string): void {
  const expectedRole = `agent_${agentType}`;

  // Extract the user portion from the PostgreSQL URL.
  // URL format: postgres://USER:PASSWORD@HOST:PORT/DBNAME
  let urlUser: string;
  try {
    const parsed = new URL(queueDatabaseUrl);
    urlUser = parsed.username;
  } catch {
    throw new Error(
      `Queue credential URL is not a valid PostgreSQL URL for agent_type="${agentType}".`,
    );
  }

  if (urlUser !== expectedRole) {
    throw new Error(
      `Queue credential role mismatch for agent_type="${agentType}": ` +
        `expected role "${expectedRole}", got "${urlUser}". ` +
        `Queue credentials must use the per-type agent role.`,
    );
  }
}

/**
 * Create a validated split-channel credential pair from the task claim result.
 *
 * Validates that the queue URL uses the correct per-type agent role before
 * returning the credential pair.
 *
 * @param queueDatabaseUrl  Agent-type DB connection string (AGENT_DATABASE_URL).
 * @param delegatedToken    Single-use JWT from the claimed task row.
 * @param agentType         Agent type name (AGENT_TYPE env var).
 * @param taskId            ID of the claimed task.
 * @throws {Error}          When the queue credential scope does not match.
 */
export function createChannelCredentials(
  queueDatabaseUrl: string,
  delegatedToken: string,
  agentType: string,
  taskId: string,
): WorkerChannelCredentials {
  assertQueueCredentialScope(queueDatabaseUrl, agentType);

  return {
    queueDatabaseUrl,
    delegatedToken,
    agentType,
    taskId,
  };
}
