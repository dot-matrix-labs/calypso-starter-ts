import { existsSync, readFileSync } from 'fs';

type Commit = { hash: string; message: string };
type StudioStatus = {
  active: boolean;
  sessionId?: string;
  branch?: string;
  commits?: Commit[];
};
type StudioChatResponse = { reply: string; commits?: Commit[] };
type StudioRollbackResponse = { commits?: Commit[] };
type ClusterStatus = 'healthy' | 'restarting' | 'degraded' | 'unknown';
type FixtureResponse<T> = {
  status?: number;
  body?: T | { error?: string };
  delayMs?: number;
};

type FixtureTask = {
  id: string;
  name: string;
  description: string;
  owner: string;
  priority: string;
  status: string;
  estimatedDeliver: string | null;
  estimateStart: string | null;
  dependsOn: string[];
  tags: string[];
  createdAt: string;
};

type OAuthStatus = { connected: boolean };
type OAuthInitResponse = { url: string };
type OAuthCompleteResponse = { connected: boolean };

type FixtureState = {
  tasks?: FixtureTask[];
  studioStatus?: StudioStatus | FixtureResponse<StudioStatus>;
  studioChatResponse?: StudioChatResponse | FixtureResponse<StudioChatResponse>;
  studioRollbackResponse?: StudioRollbackResponse | FixtureResponse<StudioRollbackResponse>;
  /** Cluster status emitted as a single SSE event then the stream stays open */
  studioClusterStatus?: ClusterStatus;
  /** OAuth status response */
  oauthStatus?: OAuthStatus | FixtureResponse<OAuthStatus>;
  /** OAuth init response */
  oauthInit?: OAuthInitResponse | FixtureResponse<OAuthInitResponse>;
  /** OAuth complete response */
  oauthComplete?: OAuthCompleteResponse | FixtureResponse<OAuthCompleteResponse>;
};

type FixtureStore = Record<string, FixtureState>;

function loadState(path: string): FixtureStore {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as FixtureStore;
  } catch {
    return {};
  }
}

export async function handleFixtureRequest(req: Request, statePath: string): Promise<Response> {
  const url = new URL(req.url);
  const store = loadState(statePath);
  const fixtureId = url.searchParams.get('fixtureId') ?? 'default';
  const state = store[fixtureId] ?? {};

  if (req.method === 'GET' && url.pathname === '/api/tasks') {
    return json(state.tasks ?? []);
  }

  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    const body = (await req.json()) as Record<string, unknown>;
    const created = {
      id: 'task-new',
      name: String(body.name ?? 'New task'),
      description: String(body.description ?? ''),
      owner: String(body.owner ?? ''),
      priority: String(body.priority ?? 'low'),
      status: 'todo',
      estimatedDeliver: null,
      estimateStart: null,
      dependsOn: [],
      tags: [],
      createdAt: new Date().toISOString(),
    } satisfies FixtureTask;
    return json(created);
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/tasks/')) {
    const body = (await req.json()) as Record<string, unknown>;
    return json({
      id: url.pathname.split('/').at(-1) ?? 'task-1',
      name: String(body.name ?? 'Task'),
      description: String(body.description ?? ''),
      owner: String(body.owner ?? ''),
      priority: String(body.priority ?? 'low'),
      status: String(body.status ?? 'todo'),
      estimatedDeliver: null,
      estimateStart: null,
      dependsOn: [],
      tags: [],
      createdAt: new Date().toISOString(),
    });
  }

  if (req.method === 'GET' && url.pathname === '/studio/status') {
    return fixtureJson(state.studioStatus ?? { active: false });
  }

  if (req.method === 'POST' && url.pathname === '/studio/chat') {
    return fixtureJson(state.studioChatResponse ?? { reply: '' });
  }

  if (req.method === 'POST' && url.pathname === '/studio/rollback') {
    return fixtureJson(state.studioRollbackResponse ?? { commits: [] });
  }

  // SSE stream: GET /studio/cluster/events
  // Emits one "cluster-status" event with the fixture's studioClusterStatus value
  // then keeps the stream open. Closes when the client disconnects.
  if (req.method === 'GET' && url.pathname === '/studio/cluster/events') {
    const clusterStatus: ClusterStatus = state.studioClusterStatus ?? 'healthy';
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const event = `event: cluster-status\ndata: ${JSON.stringify({ status: clusterStatus })}\n\n`;
        controller.enqueue(encoder.encode(event));
        // Stream stays open; test-side components will close the SSE connection
        // via AbortController when the component unmounts.
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

  // OAuth status endpoint
  if (req.method === 'GET' && url.pathname === '/api/auth/oauth/status') {
    return fixtureJson(state.oauthStatus ?? { connected: false });
  }

  // OAuth init endpoint
  if (req.method === 'GET' && url.pathname === '/api/auth/oauth/init') {
    return fixtureJson(
      state.oauthInit ?? {
        url: 'https://auth.claude.ai/oauth/authorize?client_id=test&redirect_uri=http://localhost:7000/api/auth/oauth/complete&response_type=code&state=test-state',
      },
    );
  }

  // OAuth complete endpoint
  if (req.method === 'POST' && url.pathname === '/api/auth/oauth/complete') {
    return fixtureJson(state.oauthComplete ?? { connected: true });
  }

  return new Response(
    JSON.stringify({ error: `Unhandled fixture route ${req.method} ${url.pathname}` }),
    {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function fixtureJson<T>(fixture: T | FixtureResponse<T>): Promise<Response> {
  const response =
    typeof fixture === 'object' &&
    fixture !== null &&
    ('status' in fixture || 'body' in fixture || 'delayMs' in fixture)
      ? (fixture as FixtureResponse<T>)
      : ({ status: 200, body: fixture } satisfies FixtureResponse<T>);

  if (response.delayMs) {
    await Bun.sleep(response.delayMs);
  }

  return new Response(JSON.stringify(response.body ?? {}), {
    status: response.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
