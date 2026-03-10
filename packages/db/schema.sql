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
