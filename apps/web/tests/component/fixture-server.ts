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
  targetPersonId: string | null;
  createdAt: string;
};

type FixturePerson = {
  id: string;
  name: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type FixtureRelationship = {
  id: string;
  personAId: string;
  personBId: string;
  score: number;
  reason: string;
  createdAt: string;
};

type FixtureState = {
  tasks?: FixtureTask[];
  persons?: FixturePerson[];
  relationships?: FixtureRelationship[];
  studioStatus?: StudioStatus | FixtureResponse<StudioStatus>;
  studioChatResponse?: StudioChatResponse | FixtureResponse<StudioChatResponse>;
  studioRollbackResponse?: StudioRollbackResponse | FixtureResponse<StudioRollbackResponse>;
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
      targetPersonId: (body.targetPersonId as string | null) ?? null,
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
      targetPersonId: null,
      createdAt: new Date().toISOString(),
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/persons') {
    return json(state.persons ?? []);
  }

  if (req.method === 'POST' && url.pathname === '/api/persons') {
    const body = (await req.json()) as Record<string, unknown>;
    const created: FixturePerson = {
      id: 'person-new',
      name: String(body.name ?? ''),
      properties: { name: String(body.name ?? '') } as Record<string, unknown>,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return json(created, 201);
  }

  if (req.method === 'GET' && url.pathname.match(/^\/api\/persons\/[^/]+\/relationships$/)) {
    const personId = url.pathname.split('/')[3];
    const rels = (state.relationships ?? []).filter(
      (r) => r.personAId === personId || r.personBId === personId,
    );
    return json(rels);
  }

  if (req.method === 'GET' && url.pathname === '/api/relationships') {
    return json(state.relationships ?? []);
  }

  if (req.method === 'POST' && url.pathname === '/api/relationships') {
    const body = (await req.json()) as Record<string, unknown>;
    const created: FixtureRelationship = {
      id: 'rel-new',
      personAId: String(body.personAId ?? ''),
      personBId: String(body.personBId ?? ''),
      score: Number(body.score ?? 3),
      reason: String(body.reason ?? ''),
      createdAt: new Date().toISOString(),
    };
    return json(created, 201);
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

  return new Response(
    JSON.stringify({ error: `Unhandled fixture route ${req.method} ${url.pathname}` }),
    {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
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
