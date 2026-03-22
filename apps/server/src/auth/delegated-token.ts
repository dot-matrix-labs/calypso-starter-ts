/**
 * Single-use task-scoped delegated tokens.
 *
 * issueDelegatedToken produces a short-lived JWT that authorises exactly one
 * worker result submission for a specific task.  The token is consumed on first
 * use by inserting its jti into the revoked_tokens table; a second use is
 * rejected at step 2 of the verification chain.
 *
 * Token payload shape:
 *   { sub: user_id, task_id, agent_type, jti, scope: 'task_result', exp }
 *
 * Verification checks (in order):
 *   1. Signature valid
 *   2. JTI not in revoked_tokens
 *   3. token.task_id === path :id
 *   4. token.agent_type === task.agent_type
 *   5. token.sub === task.created_by
 *   6. token.scope === 'task_result'
 */

import { signJwt, verifyJwt } from './jwt';
import { sql } from 'db';

/** TTL for delegated tokens in hours (15 minutes). */
const DELEGATED_TOKEN_TTL_HOURS = 15 / 60;

export interface DelegatedTokenPayload {
  sub: string;
  task_id: string;
  agent_type: string;
  jti: string;
  scope: 'task_result';
  exp: number;
}

export interface DelegatedTokenInput {
  /** The user who created / owns the task (task.created_by). */
  userId: string;
  taskId: string;
  agentType: string;
}

/**
 * Issues a single-use delegated JWT for worker result submission.
 *
 * The token is signed with the shared HMAC key used by the rest of the
 * application.  Its TTL is 15 minutes from issuance.  The jti is a random
 * UUID to support JTI-based revocation.
 */
export async function issueDelegatedToken(input: DelegatedTokenInput): Promise<string> {
  const jti = crypto.randomUUID();
  const payload: Omit<DelegatedTokenPayload, 'exp'> = {
    sub: input.userId,
    task_id: input.taskId,
    agent_type: input.agentType,
    jti,
    scope: 'task_result',
  };
  return signJwt(payload, DELEGATED_TOKEN_TTL_HOURS);
}

export interface VerifyDelegatedTokenOptions {
  /** Expected task id — must match token.task_id (check 3). */
  expectedTaskId: string;
  /** Expected agent type from the task row (check 4). */
  expectedAgentType: string;
  /** Expected created_by from the task row (check 5). */
  expectedCreatedBy: string;
}

/**
 * Verifies a delegated token against all 6 checks described in issue #40.
 *
 * On success the jti is inserted into revoked_tokens so the token cannot be
 * reused.  Throws a descriptive Error on any failed check.
 */
export async function verifyDelegatedToken(
  token: string,
  options: VerifyDelegatedTokenOptions,
): Promise<DelegatedTokenPayload> {
  // Check 1: signature valid (verifyJwt also checks exp)
  const payload = await verifyJwt<DelegatedTokenPayload>(token);

  // Check 2: JTI not already revoked
  const rows = await sql<{ jti: string }[]>`
    SELECT jti FROM revoked_tokens WHERE jti = ${payload.jti}
  `;
  if (rows.length > 0) {
    throw new Error('Token already used');
  }

  // Check 3: task_id matches the requested path
  if (payload.task_id !== options.expectedTaskId) {
    throw new Error('Token task_id mismatch');
  }

  // Check 4: agent_type matches the task's agent_type
  if (payload.agent_type !== options.expectedAgentType) {
    throw new Error('Token agent_type mismatch');
  }

  // Check 5: sub matches the task's created_by
  if (payload.sub !== options.expectedCreatedBy) {
    throw new Error('Token sub mismatch');
  }

  // Check 6: scope must be 'task_result'
  if (payload.scope !== 'task_result') {
    throw new Error('Token scope is not task_result');
  }

  // Consume: insert jti into revoked_tokens so this token cannot be reused
  const expiresAt = new Date(payload.exp * 1000).toISOString();
  await sql`
    INSERT INTO revoked_tokens (jti, expires_at)
    VALUES (${payload.jti}, ${expiresAt})
    ON CONFLICT (jti) DO NOTHING
  `;

  return payload;
}
