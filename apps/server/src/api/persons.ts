import { sql } from 'db';
import type { Person, PersonProperties, Relationship, RelationshipProperties } from 'core';
import { getCorsHeaders, getAuthenticatedUser } from './auth';

function emptyPersonProperties(name: string): PersonProperties {
  return {
    name,
    education: { tempo: 'stable', entries: [] },
    employment: { tempo: 'annual', entries: [] },
    boardPositions: { tempo: 'annual', entries: [] },
    partTimeRoles: { tempo: 'annual', entries: [] },
    geography: { tempo: 'quarterly', entries: [] },
    hobbies: { tempo: 'annual', entries: [] },
    donations: { tempo: 'annual', entries: [] },
    family: { tempo: 'stable', married: null, children: null },
    conferences: { tempo: 'annual', entries: [] },
    pressQuotes: { tempo: 'annual', entries: [] },
  };
}

function rowToPerson(row: {
  id: string;
  properties: PersonProperties;
  created_at: string;
  updated_at: string;
}): Person {
  return {
    id: row.id,
    name: row.properties.name ?? '',
    properties: row.properties,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRelationship(row: {
  id: string;
  properties: RelationshipProperties;
  created_at: string;
}): Relationship {
  return {
    id: row.id,
    personAId: row.properties.personAId,
    personBId: row.properties.personBId,
    score: row.properties.score,
    reason: row.properties.reason,
    createdAt: row.created_at,
  };
}

export async function handlePersonsRequest(req: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/persons') && !url.pathname.startsWith('/api/relationships')) {
    return null;
  }

  const corsHeaders = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const user = await getAuthenticatedUser(req);
  if (!user) return json({ error: 'Não autorizado' }, 401);

  // ── Person routes ──────────────────────────────────────────────────────────

  // GET /api/persons
  if (req.method === 'GET' && url.pathname === '/api/persons') {
    const rows = await sql<
      { id: string; properties: PersonProperties; created_at: string; updated_at: string }[]
    >`
      SELECT id, properties, created_at, updated_at
      FROM entities
      WHERE type = 'person'
      ORDER BY created_at DESC
    `;
    return json(rows.map(rowToPerson));
  }

  // POST /api/persons
  if (req.method === 'POST' && url.pathname === '/api/persons') {
    const body = await req.json();
    const { name, properties: incomingProps } = body as {
      name?: string;
      properties?: Partial<PersonProperties>;
    };

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return json({ error: 'name é obrigatório' }, 400);
    }

    const id = crypto.randomUUID();
    const base = emptyPersonProperties(name.trim());
    const properties: PersonProperties = {
      ...base,
      ...(incomingProps ?? {}),
      name: name.trim(),
    };

    const [row] = await sql<
      { id: string; properties: PersonProperties; created_at: string; updated_at: string }[]
    >`
      INSERT INTO entities (id, type, properties, tenant_id)
      VALUES (${id}, 'person', ${sql.json(properties as never)}, null)
      RETURNING id, properties, created_at, updated_at
    `;

    return json(rowToPerson(row), 201);
  }

  // GET /api/persons/:id
  if (req.method === 'GET' && url.pathname.match(/^\/api\/persons\/[^/]+$/)) {
    const id = url.pathname.split('/')[3];
    const [row] = await sql<
      { id: string; properties: PersonProperties; created_at: string; updated_at: string }[]
    >`
      SELECT id, properties, created_at, updated_at
      FROM entities
      WHERE id = ${id} AND type = 'person'
    `;
    if (!row) return json({ error: 'Pessoa não encontrada' }, 404);
    return json(rowToPerson(row));
  }

  // PATCH /api/persons/:id
  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/persons\/[^/]+$/)) {
    const id = url.pathname.split('/')[3];
    const [existing] = await sql<{ properties: PersonProperties }[]>`
      SELECT properties FROM entities WHERE id = ${id} AND type = 'person'
    `;
    if (!existing) return json({ error: 'Pessoa não encontrada' }, 404);

    const patch = await req.json();
    const updated: PersonProperties = {
      ...existing.properties,
      ...patch,
      name: (patch as { name?: string }).name?.trim() ?? existing.properties.name,
    };

    const [row] = await sql<
      { id: string; properties: PersonProperties; created_at: string; updated_at: string }[]
    >`
      UPDATE entities
      SET properties = ${sql.json(updated as never)}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} AND type = 'person'
      RETURNING id, properties, created_at, updated_at
    `;
    return json(rowToPerson(row));
  }

  // GET /api/persons/:id/relationships — relationships for a person (both directions)
  if (req.method === 'GET' && url.pathname.match(/^\/api\/persons\/[^/]+\/relationships$/)) {
    const personId = url.pathname.split('/')[3];
    const rows = await sql<
      { id: string; properties: RelationshipProperties; created_at: string }[]
    >`
      SELECT id, properties, created_at
      FROM entities
      WHERE type = 'relationship'
        AND (properties->>'personAId' = ${personId} OR properties->>'personBId' = ${personId})
      ORDER BY created_at DESC
    `;
    return json(rows.map(rowToRelationship));
  }

  // ── Relationship routes ────────────────────────────────────────────────────

  // GET /api/relationships
  if (req.method === 'GET' && url.pathname === '/api/relationships') {
    const rows = await sql<
      { id: string; properties: RelationshipProperties; created_at: string }[]
    >`
      SELECT id, properties, created_at
      FROM entities
      WHERE type = 'relationship'
      ORDER BY created_at DESC
    `;
    return json(rows.map(rowToRelationship));
  }

  // POST /api/relationships
  if (req.method === 'POST' && url.pathname === '/api/relationships') {
    const body = await req.json();
    const {
      personAId,
      personBId,
      score,
      reason = '',
    } = body as {
      personAId?: string;
      personBId?: string;
      score?: number;
      reason?: string;
    };

    if (!personAId || !personBId) {
      return json({ error: 'personAId e personBId são obrigatórios' }, 400);
    }
    if (personAId === personBId) {
      return json({ error: 'Uma pessoa não pode ter relacionamento consigo mesma' }, 400);
    }
    if (!score || score < 1 || score > 5 || !Number.isInteger(score)) {
      return json({ error: 'score deve ser um inteiro entre 1 e 5' }, 400);
    }

    // Verify both persons exist
    const personCheck = await sql<{ id: string }[]>`
      SELECT id FROM entities
      WHERE id IN (${personAId}, ${personBId}) AND type = 'person'
    `;
    if (personCheck.length < 2) {
      return json({ error: 'Uma ou ambas as pessoas não foram encontradas' }, 404);
    }

    const id = crypto.randomUUID();
    const properties: RelationshipProperties = {
      personAId,
      personBId,
      score: score as 1 | 2 | 3 | 4 | 5,
      reason,
    };

    const [row] = await sql<
      { id: string; properties: RelationshipProperties; created_at: string }[]
    >`
      INSERT INTO entities (id, type, properties, tenant_id)
      VALUES (${id}, 'relationship', ${sql.json(properties as never)}, null)
      RETURNING id, properties, created_at
    `;
    return json(rowToRelationship(row), 201);
  }

  // GET /api/relationships/:id
  if (req.method === 'GET' && url.pathname.match(/^\/api\/relationships\/[^/]+$/)) {
    const id = url.pathname.split('/')[3];
    const [row] = await sql<
      { id: string; properties: RelationshipProperties; created_at: string }[]
    >`
      SELECT id, properties, created_at
      FROM entities
      WHERE id = ${id} AND type = 'relationship'
    `;
    if (!row) return json({ error: 'Relacionamento não encontrado' }, 404);
    return json(rowToRelationship(row));
  }

  // PATCH /api/relationships/:id
  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/relationships\/[^/]+$/)) {
    const id = url.pathname.split('/')[3];
    const [existing] = await sql<{ properties: RelationshipProperties }[]>`
      SELECT properties FROM entities WHERE id = ${id} AND type = 'relationship'
    `;
    if (!existing) return json({ error: 'Relacionamento não encontrado' }, 404);

    const patch = await req.json();
    const updated: RelationshipProperties = {
      ...existing.properties,
      ...(typeof patch.score === 'number' ? { score: patch.score as 1 | 2 | 3 | 4 | 5 } : {}),
      ...(typeof patch.reason === 'string' ? { reason: patch.reason } : {}),
    };

    if (updated.score < 1 || updated.score > 5) {
      return json({ error: 'score deve ser um inteiro entre 1 e 5' }, 400);
    }

    const [row] = await sql<
      { id: string; properties: RelationshipProperties; created_at: string }[]
    >`
      UPDATE entities
      SET properties = ${sql.json(updated as never)}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id} AND type = 'relationship'
      RETURNING id, properties, created_at
    `;
    return json(rowToRelationship(row));
  }

  return null;
}
