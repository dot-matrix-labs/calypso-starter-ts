/**
 * Task Queue API endpoints (issue #43).
 *
 * Implements TQ-D-001 (postgres-queue-table) via three endpoints:
 *   POST /api/tasks-queue           — idempotent task enqueue
 *   POST /api/tasks-queue/:id/claim — atomic single-winner claim
 *   PATCH /api/tasks-queue/:id      — status update
 *   POST /api/tasks-queue/:id/result — submit result (terminal success)
 *
 * The API gateway is the sole writer to task_queue (TQ-A-001).
 * Payloads must contain only opaque identifiers (TQ-P-002).
 */

import type { AppState } from '../index';
import { getCorsHeaders, getAuthenticatedUser } from './auth';
import {
  enqueueTask,
  claimNextTask,
  updateTaskStatus,
  submitTaskResult,
  type TaskQueueStatus,
} from 'db/task-queue';
import { validateTaskPayload, PayloadValidationError } from './task-payload-validation';
import { makeJson } from '../lib/response';

export async function handleTasksQueueRequest(
  req: Request,
  url: URL,
  appState: AppState,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/tasks-queue')) return null;

  // Suppress unused variable lint warning — appState is part of the standard
  // handler contract and may be used by future middleware (audit writes, etc.)
  void appState;

  const corsHeaders = getCorsHeaders(req);
  const json = makeJson(corsHeaders);

  const user = await getAuthenticatedUser(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // POST /api/tasks-queue — idempotent enqueue (TQ-P-003)
  if (req.method === 'POST' && url.pathname === '/api/tasks-queue') {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const {
      idempotency_key,
      agent_type,
      job_type,
      payload,
      correlation_id,
      priority,
      max_attempts,
    } = body as Record<string, unknown>;

    if (!idempotency_key || typeof idempotency_key !== 'string') {
      return json({ error: 'idempotency_key is required' }, 400);
    }
    if (!agent_type || typeof agent_type !== 'string') {
      return json({ error: 'agent_type is required' }, 400);
    }
    if (!job_type || typeof job_type !== 'string') {
      return json({ error: 'job_type is required' }, 400);
    }

    const safePayload = payload ?? {};
    try {
      validateTaskPayload(safePayload);
    } catch (err) {
      if (err instanceof PayloadValidationError) {
        return json({ error: err.message }, 400);
      }
      throw err;
    }

    const task = await enqueueTask({
      idempotency_key: idempotency_key as string,
      agent_type: agent_type as string,
      job_type: job_type as string,
      payload: safePayload,
      correlation_id: typeof correlation_id === 'string' ? correlation_id : undefined,
      created_by: user.id,
      priority: typeof priority === 'number' ? priority : undefined,
      max_attempts: typeof max_attempts === 'number' ? max_attempts : undefined,
    });

    return json(task);
  }

  // Extract task id from path for sub-resource routes
  const pathParts = url.pathname.split('/');
  // Expected shapes:
  //   /api/tasks-queue/:id          → parts[3] = id
  //   /api/tasks-queue/:id/claim    → parts[3] = id, parts[4] = 'claim'
  //   /api/tasks-queue/:id/result   → parts[3] = id, parts[4] = 'result'
  const taskId = pathParts[3];
  const subRoute = pathParts[4];

  // POST /api/tasks-queue/claim — atomic claim (TQ-P-001)
  // Agent supplies agent_type; the claim winner is determined by DB
  if (req.method === 'POST' && taskId === 'claim' && !subRoute) {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const { agent_type, delegated_token, claim_ttl_seconds } = body as Record<string, unknown>;

    if (!agent_type || typeof agent_type !== 'string') {
      return json({ error: 'agent_type is required' }, 400);
    }

    const task = await claimNextTask({
      agent_type: agent_type as string,
      claimed_by: user.id,
      delegated_token: typeof delegated_token === 'string' ? delegated_token : undefined,
      claim_ttl_seconds: typeof claim_ttl_seconds === 'number' ? claim_ttl_seconds : undefined,
    });

    if (!task) {
      return json({ error: 'No task available' }, 204);
    }
    return json(task);
  }

  if (!taskId) return null;

  // PATCH /api/tasks-queue/:id — update status
  if (req.method === 'PATCH' && !subRoute) {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const { status, error_message, next_retry_at } = body as Record<string, unknown>;

    const allowedStatuses: TaskQueueStatus[] = [
      'pending',
      'claimed',
      'running',
      'submitting',
      'completed',
      'failed',
      'dead',
    ];
    if (!status || !allowedStatuses.includes(status as TaskQueueStatus)) {
      return json(
        {
          error: `status must be one of: ${allowedStatuses.join(', ')}`,
        },
        400,
      );
    }

    const task = await updateTaskStatus({
      id: taskId,
      status: status as TaskQueueStatus,
      error_message: typeof error_message === 'string' ? error_message : undefined,
      next_retry_at: typeof next_retry_at === 'string' ? new Date(next_retry_at) : undefined,
    });

    if (!task) return json({ error: 'Not found' }, 404);
    return json(task);
  }

  // POST /api/tasks-queue/:id/result — submit result (TQ-D-002 terminal success)
  if (req.method === 'POST' && subRoute === 'result') {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const { result } = body as Record<string, unknown>;
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      return json({ error: 'result must be a JSON object' }, 400);
    }

    const task = await submitTaskResult({
      id: taskId,
      result: result as Record<string, unknown>,
    });

    if (!task) return json({ error: 'Not found' }, 404);
    return json(task);
  }

  return null;
}
