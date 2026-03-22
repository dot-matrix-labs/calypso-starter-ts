import { sql } from 'db';
import type { ConsequentialWriteRequest, PrincipalActorRef, TaskProperties } from 'core';
import { emitAuditEvent } from './audit-service';

export interface TaskWritePayload {
  taskId: string;
  current: TaskProperties;
  patch: Partial<TaskProperties>;
  next: TaskProperties;
}

export interface BuildTaskConsequentialWriteRequestInput {
  taskId: string;
  current: TaskProperties;
  patch: Partial<TaskProperties>;
  principal: PrincipalActorRef;
  executor?: PrincipalActorRef;
  reason: string;
}

export type ApplyTaskPatchInput = BuildTaskConsequentialWriteRequestInput;

export function buildTaskConsequentialWriteRequest(
  input: BuildTaskConsequentialWriteRequestInput,
): ConsequentialWriteRequest<TaskWritePayload> {
  const next: TaskProperties = { ...input.current, ...input.patch };

  return {
    transactionType: 'task.update',
    principal: input.principal,
    executor: input.executor ?? input.principal,
    authorityContext: {
      reason: input.reason,
    },
    payload: {
      taskId: input.taskId,
      current: input.current,
      patch: input.patch,
      next,
    },
  };
}

export async function applyTaskPatchThroughBoundary(
  input: ApplyTaskPatchInput,
): Promise<{ id: string; properties: TaskProperties; created_at: string }> {
  const request = buildTaskConsequentialWriteRequest(input);

  // Emit the audit event BEFORE the primary write.
  // If the audit write fails, the primary write must not proceed.
  await emitAuditEvent({
    actor_id: request.principal.id,
    action: request.transactionType,
    entity_type: 'task',
    entity_id: request.payload.taskId,
    before: request.payload.current as unknown as Record<string, unknown>,
    after: request.payload.next as unknown as Record<string, unknown>,
    ts: new Date().toISOString(),
  });

  const [row] = await sql<{ id: string; properties: TaskProperties; created_at: string }[]>`
    UPDATE entities
    SET properties = ${sql.json(request.payload.next as never)}, updated_at = NOW()
    WHERE id = ${request.payload.taskId} AND type = 'task'
    RETURNING id, properties, created_at
  `;

  return row;
}
