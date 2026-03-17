import { test, expect, beforeAll, afterAll } from 'vitest';
import type { Subprocess } from 'bun';
import { startPostgres, type PgContainer } from '../helpers/pg-container';

const PORT = 31420;
const BASE = `http://localhost:${PORT}`;
const SERVER_READY_TIMEOUT_MS = 20_000;
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const SERVER_ENTRY = 'apps/server/src/index.ts';

let pg: PgContainer;
let server: Subprocess;
let authCookie = '';

beforeAll(async () => {
  pg = await startPostgres();

  server = Bun.spawn(['bun', 'run', SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: pg.url, PORT: String(PORT) },
    stdout: 'ignore',
    stderr: 'ignore',
  });

  await waitForServer(BASE);

  const username = `crm_test_${Date.now()}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'testpass123' }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  authCookie = setCookie.split(';')[0];
}, 60_000);

afterAll(async () => {
  server?.kill();
  await pg?.stop();
});

// ── Person routes ─────────────────────────────────────────────────────────────

test('GET /api/persons returns 200 with empty array initially', async () => {
  const res = await fetch(`${BASE}/api/persons`, { headers: { Cookie: authCookie } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test('GET /api/persons returns 401 when unauthenticated', async () => {
  const res = await fetch(`${BASE}/api/persons`);
  expect(res.status).toBe(401);
});

test('POST /api/persons creates a person with only a name', async () => {
  const res = await fetch(`${BASE}/api/persons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ name: 'João Silva' }),
  });
  expect(res.status).toBe(201);
  const person = await res.json();
  expect(person.id).toBeTruthy();
  expect(person.name).toBe('João Silva');
  expect(person.properties).toBeTruthy();
  expect(person.properties.education).toBeTruthy();
  expect(person.properties.employment).toBeTruthy();
});

test('POST /api/persons returns 400 when name is missing', async () => {
  const res = await fetch(`${BASE}/api/persons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
});

test('GET /api/persons/:id returns 404 for unknown person', async () => {
  const res = await fetch(`${BASE}/api/persons/nonexistent-id`, {
    headers: { Cookie: authCookie },
  });
  expect(res.status).toBe(404);
});

test('GET /api/persons/:id returns the person after creation', async () => {
  const createRes = await fetch(`${BASE}/api/persons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ name: 'Maria Costa' }),
  });
  const created = await createRes.json();

  const getRes = await fetch(`${BASE}/api/persons/${created.id}`, {
    headers: { Cookie: authCookie },
  });
  expect(getRes.status).toBe(200);
  const fetched = await getRes.json();
  expect(fetched.id).toBe(created.id);
  expect(fetched.name).toBe('Maria Costa');
});

test('biographical data types have configurable tempo fields', async () => {
  const res = await fetch(`${BASE}/api/persons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ name: 'Carlos Neves' }),
  });
  const person = await res.json();
  expect(person.properties.education.tempo).toBe('stable');
  expect(person.properties.employment.tempo).toBe('annual');
  expect(person.properties.geography.tempo).toBe('quarterly');
  expect(person.properties.boardPositions.tempo).toBe('annual');
});

// ── Relationship routes ───────────────────────────────────────────────────────

test('POST /api/relationships creates a relationship between two persons', async () => {
  // Create two persons
  const [pa, pb] = await Promise.all([
    fetch(`${BASE}/api/persons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ name: 'Pessoa A' }),
    }).then((r) => r.json()),
    fetch(`${BASE}/api/persons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ name: 'Pessoa B' }),
    }).then((r) => r.json()),
  ]);

  const res = await fetch(`${BASE}/api/relationships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({
      personAId: pa.id,
      personBId: pb.id,
      score: 5,
      reason: 'co-conselheiros de uma ONG',
    }),
  });
  expect(res.status).toBe(201);
  const rel = await res.json();
  expect(rel.id).toBeTruthy();
  expect(rel.personAId).toBe(pa.id);
  expect(rel.personBId).toBe(pb.id);
  expect(rel.score).toBe(5);
  expect(rel.reason).toBe('co-conselheiros de uma ONG');
});

test('POST /api/relationships returns 400 when score is out of range', async () => {
  const [pa, pb] = await Promise.all([
    fetch(`${BASE}/api/persons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ name: 'Pessoa X' }),
    }).then((r) => r.json()),
    fetch(`${BASE}/api/persons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ name: 'Pessoa Y' }),
    }).then((r) => r.json()),
  ]);

  const res = await fetch(`${BASE}/api/relationships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ personAId: pa.id, personBId: pb.id, score: 6 }),
  });
  expect(res.status).toBe(400);
});

test('GET /api/persons/:id/relationships shows relationship from both A and B perspectives', async () => {
  const [pA, pB] = await Promise.all([
    fetch(`${BASE}/api/persons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ name: 'Diretora Alpha' }),
    }).then((r) => r.json()),
    fetch(`${BASE}/api/persons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({ name: 'Diretor Beta' }),
    }).then((r) => r.json()),
  ]);

  await fetch(`${BASE}/api/relationships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({
      personAId: pA.id,
      personBId: pB.id,
      score: 5,
      reason: 'co-conselheiros',
    }),
  });

  // Relationship is visible from A's profile
  const relsA = await fetch(`${BASE}/api/persons/${pA.id}/relationships`, {
    headers: { Cookie: authCookie },
  }).then((r) => r.json());
  expect(relsA.length).toBeGreaterThanOrEqual(1);
  const relFromA = relsA.find(
    (r: { personAId: string; personBId: string }) =>
      (r.personAId === pA.id && r.personBId === pB.id) ||
      (r.personAId === pB.id && r.personBId === pA.id),
  );
  expect(relFromA).toBeTruthy();
  expect(relFromA.score).toBe(5);

  // Relationship is also visible from B's profile (bidirectional)
  const relsB = await fetch(`${BASE}/api/persons/${pB.id}/relationships`, {
    headers: { Cookie: authCookie },
  }).then((r) => r.json());
  expect(relsB.length).toBeGreaterThanOrEqual(1);
  const relFromB = relsB.find(
    (r: { personAId: string; personBId: string }) =>
      (r.personAId === pA.id && r.personBId === pB.id) ||
      (r.personAId === pB.id && r.personBId === pA.id),
  );
  expect(relFromB).toBeTruthy();
  expect(relFromB.score).toBe(5);
});

test('GET /api/persons/:id/relationships returns empty array for person with no relationships', async () => {
  const person = await fetch(`${BASE}/api/persons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ name: 'Pessoa Isolada' }),
  }).then((r) => r.json());

  const res = await fetch(`${BASE}/api/persons/${person.id}/relationships`, {
    headers: { Cookie: authCookie },
  });
  expect(res.status).toBe(200);
  const rels = await res.json();
  expect(Array.isArray(rels)).toBe(true);
  expect(rels.length).toBe(0);
});

// ── Task-Person linkage ───────────────────────────────────────────────────────

test('POST /api/tasks supports targetPersonId field', async () => {
  const person = await fetch(`${BASE}/api/persons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ name: 'Alvo da Tarefa' }),
  }).then((r) => r.json());

  const taskRes = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({
      name: 'Contactar pessoa alvo',
      targetPersonId: person.id,
    }),
  });
  expect(taskRes.status).toBe(201);
  const task = await taskRes.json();
  expect(task.targetPersonId).toBe(person.id);
});

test('PATCH /api/tasks/:id supports setting targetPersonId', async () => {
  const person = await fetch(`${BASE}/api/persons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ name: 'Novo Alvo' }),
  }).then((r) => r.json());

  const taskRes = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ name: 'Tarefa sem alvo inicial' }),
  }).then((r) => r.json());

  const patchRes = await fetch(`${BASE}/api/tasks/${taskRes.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ targetPersonId: person.id }),
  });
  expect(patchRes.status).toBe(200);
  const updated = await patchRes.json();
  expect(updated.targetPersonId).toBe(person.id);
});

test('task without targetPersonId has null targetPersonId', async () => {
  const taskRes = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ name: 'Tarefa padrão' }),
  });
  expect(taskRes.status).toBe(201);
  const task = await taskRes.json();
  expect(task.targetPersonId).toBeNull();
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function waitForServer(base: string): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/api/tasks`);
      return;
    } catch {
      await Bun.sleep(300);
    }
  }
  throw new Error(`Server at ${base} did not become ready within ${SERVER_READY_TIMEOUT_MS}ms`);
}
