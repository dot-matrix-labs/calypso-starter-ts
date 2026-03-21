# WebSocket Support for Real-Time Updates

## What it is

A WebSocket server integrated into Bun's native `fetch` handler that pushes entity change
events to all connected clients. No separate process or external broker required.

## Why it's needed

The PRD requires the UI to update instantly for all users when tasks are created, modified,
or deleted. Without real-time push, clients must poll — which adds latency, wastes bandwidth,
and makes the UI feel sluggish.

## How it works

Bun exposes `server.upgrade(req)` to upgrade an HTTP connection to WebSocket within the
existing `fetch` handler:

```ts
// apps/server/src/api/websocket.ts
const clients = new Set<ServerWebSocket>();

export function handleWebSocket(req: Request, server: Server): Response | undefined {
  // Validate JWT from request headers or query param
  if (!isAuthenticated(req)) return new Response(null, { status: 401 });
  const upgraded = server.upgrade(req);
  if (!upgraded) return new Response('WebSocket upgrade failed', { status: 400 });
}

export function broadcast(event: string, payload: unknown): void {
  const message = JSON.stringify({ event, data: payload });
  for (const ws of clients) ws.send(message);
}
```

The `wsHandler` object (open, message, close) tracks connected clients in the `Set`.

## Message format

```json
{ "event": "task.created" | "task.updated" | "task.deleted", "data": { ...taskObject } }
```

## Integration with mutation endpoints

After each successful database write in a mutation handler:

```ts
broadcast('task.created', newTask);
```

The broadcast is fire-and-forget. It does not block the HTTP response.

## Authentication

The JWT is validated before the upgrade. Unauthenticated upgrade requests receive HTTP 401
and are not upgraded. There is no way to send messages to a WebSocket after rejecting the
upgrade, so authentication must happen at upgrade time.

## Route

```
GET /ws
```

Registered in `apps/server/src/index.ts` alongside the other routes.

## Source reference (rinzler)

`apps/server/src/api/websocket.ts` — copy verbatim, update event names for the starter's
entity types.

## Files to create / modify

- `apps/server/src/api/websocket.ts`
- `apps/server/src/index.ts` — add `/ws` route + `websocket:` option to `Bun.serve()`
- `apps/server/src/api/tasks.ts` — call `broadcast` after create/update/delete
