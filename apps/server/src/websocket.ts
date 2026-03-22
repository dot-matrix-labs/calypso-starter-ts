/**
 * @file websocket
 * Manages connected WebSocket clients and provides a fire-and-forget
 * broadcast helper used by mutation handlers to push entity change events.
 *
 * Clients connect via `GET /ws`. The JWT is validated before the upgrade;
 * unauthenticated requests receive HTTP 401 and are not upgraded.
 *
 * Message format: `{"event": "task.created" | "task.updated" | "task.deleted", "data": {...}}`
 */

import type { ServerWebSocket } from 'bun';

/** The set of all currently connected WebSocket clients. */
const clients = new Set<ServerWebSocket<unknown>>();

/**
 * Bun WebSocket lifecycle handler — attach to the `websocket` key on the
 * Bun.serve config object.
 */
export const websocketHandler = {
  open(ws: ServerWebSocket<unknown>): void {
    clients.add(ws);
  },
  close(ws: ServerWebSocket<unknown>): void {
    clients.delete(ws);
  },
  // Required by the Bun WebSocket handler interface even if unused.
  message(_ws: ServerWebSocket<unknown>, _message: string | Buffer): void {
    // Clients do not send messages in this protocol.
  },
};

/**
 * Broadcasts an entity change event to all connected clients.
 * Fire-and-forget: does not block the calling HTTP response.
 *
 * @param event - The event type, e.g. `"task.created"`.
 * @param data  - The event payload.
 */
export function broadcast(event: string, data: unknown): void {
  if (clients.size === 0) return;
  const message = JSON.stringify({ event, data });
  for (const ws of clients) {
    try {
      ws.send(message);
    } catch {
      // Silently remove a client that failed to receive the message.
      clients.delete(ws);
    }
  }
}

/** Exposed for testing only. Returns the current connected-client count. */
export function connectedClientCount(): number {
  return clients.size;
}
