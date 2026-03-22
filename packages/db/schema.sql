-- PostgreSQL Schema Definition
-- Strict blueprint compliance: No ORMs allowed. Property graph model.

CREATE TABLE IF NOT EXISTS entity_types (
    type TEXT PRIMARY KEY,
    schema JSONB NOT NULL,
    sensitive TEXT[] DEFAULT '{}',
    kms_key_id TEXT
);

CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL REFERENCES entity_types(type) ON DELETE CASCADE,
    properties JSONB NOT NULL DEFAULT '{}',
    tenant_id TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_tenant ON entities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_entities_properties ON entities USING GIN (properties);

CREATE TABLE IF NOT EXISTS relations (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    properties JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(type);

-- Seed required entity types
INSERT INTO entity_types (type, schema) VALUES
  ('user',        '{}'),
  ('task',        '{}'),
  ('tag',         '{}'),
  ('github_link', '{}'),
  ('channel',     '{}'),
  ('message',     '{}')
ON CONFLICT (type) DO NOTHING;

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti TEXT PRIMARY KEY,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Task queue: single-table queue for all agent types (TQ-D-001).
-- delegated_token stores the single-use JWT issued at task creation.
-- The token is encrypted at rest in the column; workers receive it only
-- through the claim API response.
CREATE TABLE IF NOT EXISTS task_queue (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT UNIQUE NOT NULL,
    agent_type TEXT NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','claimed','running','submitting','completed','failed','dead')),
    payload JSONB NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL,
    correlation_id TEXT,
    claimed_by TEXT,
    claimed_at TIMESTAMP WITH TIME ZONE,
    claim_expires_at TIMESTAMP WITH TIME ZONE,
    delegated_token TEXT,
    result JSONB,
    error_message TEXT,
    attempt INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    priority INTEGER NOT NULL DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_queue_poll
    ON task_queue (agent_type, status, priority, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_task_queue_stale
    ON task_queue (status, claim_expires_at)
    WHERE status = 'claimed';
