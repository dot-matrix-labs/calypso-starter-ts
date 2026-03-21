# Delegated Tokens

## What it is

Single-use, task-scoped JWT tokens issued by the API at task creation time. Workers use the
delegated token to submit their result through the API. The token is invalidated on first use
(via JTI revocation) and expires by TTL if unused. A delegated token cannot be used for a
different task, to read out-of-scope data, or to initiate a new task.

## Why it's needed

Workers need to submit results as an authenticated API request (writes must pass through the
API layer). But workers must not hold long-lived user credentials — a compromised worker would
then have persistent write access. Delegated tokens provide the minimal credential surface: one
token, one task, one use, short TTL.

Without task-scoped tokens, a worker that completes its task could reuse its credential to
initiate new tasks, read other users' data, or impersonate the original user for subsequent
requests.

## Token structure

```ts
interface DelegatedTokenPayload {
  sub: string;        // user_id (task owner)
  task_id: string;    // UUID of the specific task
  agent_type: string; // must match the task's agent_type
  jti: string;        // unique token ID (for revocation)
  iat: number;
  exp: number;        // short TTL: iat + 15 minutes
  scope: 'task_result'; // restricts which endpoints accept this token
}
```

## Lifecycle

```
Task created → delegated_token generated and stored in task_queue.delegated_token
                    (encrypted at rest using field-level encryption)

Worker claims task → receives delegated_token in claim response

Worker executes → POST /api/tasks/:id/result
  Authorization: Bearer <delegated_token>
  API verifies:
    1. token signature valid
    2. token not in revoked_tokens (JTI check)
    3. token.task_id === path param :id
    4. token.agent_type === task.agent_type
    5. token.sub === task.created_by
    6. token.scope === 'task_result'
  On success: JTI inserted into revoked_tokens (token consumed)
```

## Token issuance

```ts
function issueDelegatedToken(task: Task): string {
  const jti = crypto.randomUUID();
  return jwt.sign(
    {
      sub: task.created_by,
      task_id: task.id,
      agent_type: task.agent_type,
      jti,
      scope: 'task_result',
    },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  );
}
```

## Blueprint references

- `WORKER-P-006` `single-use-task-scoped-tokens`
- `WORKER-T-005` `delegated-token-outlives-task` — threat this prevents
- `WORKER-T-006` `agent-impersonates-different-user` — sub + task_id binding prevents this

## Dependencies

- **JTI revocation** (`docs/jti-revocation.md`) — persistent revoked_tokens table required
  (in-process Map is insufficient; workers may run on different nodes than the API)
- **Field-level encryption** (`docs/field-level-encryption.md`) — delegated_token column encrypted
- **Task queue schema** (`docs/task-queue-schema.md`) — `delegated_token` column on `task_queue`

## Files to create / modify

- `apps/server/src/api/tasks-queue.ts` — `issueDelegatedToken()`, revocation check in result endpoint
- `apps/server/src/middleware/auth.ts` — delegated token verification middleware
- `packages/db/schema.sql` — `delegated_token TEXT` column in `task_queue` table
