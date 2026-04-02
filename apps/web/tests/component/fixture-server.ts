import { existsSync, readFileSync, writeFileSync } from 'fs';

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
type FixturePasskeyCredential = {
  id: string;
  credential_id: string;
  created_at: string;
  last_used_at: string | null;
};

type FixtureState = {
  tasks?: FixtureTask[];
  /** OAuth status response */
  oauthStatus?: OAuthStatus | FixtureResponse<OAuthStatus>;
  /** OAuth init response */
  oauthInit?: OAuthInitResponse | FixtureResponse<OAuthInitResponse>;
  /** OAuth complete response */
  oauthComplete?: OAuthCompleteResponse | FixtureResponse<OAuthCompleteResponse>;
  passkeys?: FixturePasskeyCredential[];
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

function writeState(path: string, store: FixtureStore): void {
  writeFileSync(path, JSON.stringify(store, null, 2));
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

  if (req.method === 'GET' && url.pathname === '/api/auth/passkey/credentials') {
    return json(state.passkeys ?? []);
  }

  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/auth\/passkey\/credentials\/[^/]+$/)) {
    const credentialId = url.pathname.split('/').at(-1);
    const existing = state.passkeys ?? [];
    const next = existing.filter((credential) => credential.id !== credentialId);

    if (existing.length === next.length) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    store[fixtureId] = { ...state, passkeys: next };
    writeState(statePath, store);
    return new Response(null, { status: 204 });
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
