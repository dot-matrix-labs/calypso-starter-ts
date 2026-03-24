/**
 * E2E test: Studio panel send/receive flow with mocked Claude and cluster endpoints.
 *
 * Starts a minimal fixture server that stubs:
 *   POST /studio/chat   → returns a mocked Claude reply
 *   GET  /studio/cluster/events → returns SSE with a configurable cluster status
 *
 * The test exercises these endpoints directly (HTTP + SSE stream reads), which
 * validates the same interfaces that the StudioPanel browser components consume.
 *
 * Note: the studio server itself (in the `studio/` git submodule) is NOT
 * required — these tests validate the mocked endpoint contracts only.
 *
 * Canonical docs: docs/studio-mode.md
 */

import { afterAll, beforeAll, expect, test } from 'vitest';

// ---------------------------------------------------------------------------
// In-process fixture server
// ---------------------------------------------------------------------------

type ChatState = { reply: string };
type ClusterState = 'healthy' | 'restarting' | 'degraded' | 'unknown';

interface StudioFixture {
  chat: ChatState;
  cluster: ClusterState;
}

let fixtureState: StudioFixture = {
  chat: { reply: '' },
  cluster: 'healthy',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let server: import('bun').Server<any>;
let baseUrl: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0, // pick a random available port
    fetch(req: Request) {
      const url = new URL(req.url);

      // POST /studio/chat — returns a mocked Claude reply
      if (req.method === 'POST' && url.pathname === '/studio/chat') {
        return new Response(JSON.stringify({ reply: fixtureState.chat.reply }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // GET /studio/cluster/events — SSE stream with one cluster-status event
      if (req.method === 'GET' && url.pathname === '/studio/cluster/events') {
        const encoder = new TextEncoder();
        const status = fixtureState.cluster;
        const stream = new ReadableStream({
          start(controller) {
            const event = `event: cluster-status\ndata: ${JSON.stringify({ status })}\n\n`;
            controller.enqueue(encoder.encode(event));
            // Stream stays open; the client will close it when done.
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      }

      return new Response(JSON.stringify({ error: `Not found: ${url.pathname}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('mocked Claude endpoint returns the configured reply', async () => {
  fixtureState.chat = { reply: 'Hello from mocked Claude!' };

  const res = await fetch(`${baseUrl}/studio/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello' }),
  });

  expect(res.ok).toBe(true);
  expect(res.headers.get('Content-Type')).toContain('application/json');

  const body = (await res.json()) as { reply?: string };
  expect(body.reply).toBe('Hello from mocked Claude!');
});

test('cluster events endpoint emits SSE with healthy status', async () => {
  fixtureState.cluster = 'healthy';

  const res = await fetch(`${baseUrl}/studio/cluster/events`);

  expect(res.ok).toBe(true);
  expect(res.headers.get('Content-Type')).toContain('text/event-stream');

  const buffer = await readFirstSseEvent(res);

  expect(buffer).toContain('event: cluster-status');
  expect(buffer).toContain('"status":"healthy"');
});

test('cluster events endpoint emits SSE with restarting status', async () => {
  fixtureState.cluster = 'restarting';

  const res = await fetch(`${baseUrl}/studio/cluster/events`);

  expect(res.ok).toBe(true);

  const buffer = await readFirstSseEvent(res);

  expect(buffer).toContain('"status":"restarting"');
});

test('cluster events endpoint emits SSE with degraded status', async () => {
  fixtureState.cluster = 'degraded';

  const res = await fetch(`${baseUrl}/studio/cluster/events`);

  expect(res.ok).toBe(true);

  const buffer = await readFirstSseEvent(res);

  expect(buffer).toContain('"status":"degraded"');
});

test('full send/receive flow: chat message returns expected reply', async () => {
  fixtureState.chat = { reply: 'I fixed the bug in the auth module.' };

  // Simulate the full send/receive cycle: POST a message, parse the JSON reply.
  const res = await fetch(`${baseUrl}/studio/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Fix the auth bug' }),
  });

  expect(res.status).toBe(200);
  const body = (await res.json()) as { reply?: string };
  expect(body.reply).toBe('I fixed the bug in the auth module.');
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function readFirstSseEvent(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Stop once we have at least one complete SSE event (terminated by \n\n)
        if (buffer.includes('\n\n')) break;
      }
    } finally {
      reader.cancel();
    }
  }

  return buffer;
}
