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

-- Idempotency deduplication index (also enforced by UNIQUE constraint above)
CREATE INDEX IF NOT EXISTS idx_task_queue_idempotency
    ON task_queue (idempotency_key);

-- Note: ALTER TABLE task_queue ENABLE ROW LEVEL SECURITY is executed by
-- init-remote.ts (requires table ownership — the admin user owns the table).
-- Per-type RLS policies are also applied there after agent roles are created.

-- Per-type filtered views: expose only non-sensitive columns to each agent type.
-- Sensitive columns excluded: delegated_token, created_by, result, error_message.
CREATE OR REPLACE VIEW task_queue_view_coding AS
    SELECT
        id,
        agent_type,
        job_type,
        status,
        payload,
        correlation_id,
        claimed_by,
        claimed_at,
        claim_expires_at,
        attempt,
        max_attempts,
        next_retry_at,
        priority,
        created_at,
        updated_at
    FROM task_queue
    WHERE agent_type = 'coding';

CREATE OR REPLACE VIEW task_queue_view_analysis AS
    SELECT
        id,
        agent_type,
        job_type,
        status,
        payload,
        correlation_id,
        claimed_by,
        claimed_at,
        claim_expires_at,
        attempt,
        max_attempts,
        next_retry_at,
        priority,
        created_at,
        updated_at
    FROM task_queue
    WHERE agent_type = 'analysis';

-- LISTEN/NOTIFY trigger: wake the appropriate worker channel on task insertion.
-- Blueprint: TQ-D-005 (listen-notify-wake)
CREATE OR REPLACE FUNCTION notify_task_queue_insert()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('task_queue_' || NEW.agent_type, NEW.id::TEXT);
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_task_queue_notify ON task_queue;
CREATE TRIGGER trg_task_queue_notify
    AFTER INSERT ON task_queue
    FOR EACH ROW EXECUTE FUNCTION notify_task_queue_insert();

-- Passkey / WebAuthn credentials
-- Stores the public key credential registered by the user's authenticator.
-- credential_id: base64url-encoded credential ID from the authenticator
-- public_key: CBOR-encoded public key stored as hex bytes
-- counter: signature counter for clone detection (reject if presented <= stored)
-- aaguid: authenticator AAGUID (identifies the authenticator model)
-- transports: array of transport hints (usb, nfc, ble, hybrid, internal)
CREATE TABLE IF NOT EXISTS passkey_credentials (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key BYTEA NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    aaguid TEXT NOT NULL DEFAULT '',
    transports TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user_id ON passkey_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_passkey_credentials_credential_id ON passkey_credentials(credential_id);

-- Passkey challenge store
-- Short-lived challenges (5-minute TTL) used to prevent replay attacks during
-- WebAuthn registration and authentication ceremonies.
CREATE TABLE IF NOT EXISTS passkey_challenges (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('registration', 'authentication')),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_passkey_challenges_user_id ON passkey_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_challenge ON passkey_challenges(challenge);

-- Worker vendor credentials — encrypted Codex subscription auth material.
-- Stores the minimum authentication state required to restore a Codex session
-- inside an ephemeral worker container at boot.
--
-- auth_bundle: AES-256-GCM encrypted JSON blob (enc:v1:<iv>:<ciphertext> format).
--   Contains the Codex session material (access token, refresh token, expiry, etc.)
--   Never stored in plaintext. Workers decrypt at startup using ENCRYPTION_MASTER_KEY.
-- agent_type:  Agent type this credential is scoped to (e.g. "coding").
-- expires_at:  When the auth bundle itself expires (independent of token expiry).
--   Workers must refuse to use expired bundles.
-- created_by:  User or system that stored the credential.
-- revoked_at:  Set when the credential is explicitly revoked; workers must reject revoked bundles.
CREATE TABLE IF NOT EXISTS worker_credentials (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    agent_type TEXT NOT NULL,
    auth_bundle TEXT NOT NULL,
    created_by TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_worker_credentials_agent_type
    ON worker_credentials (agent_type, expires_at)
    WHERE revoked_at IS NULL;

-- API keys for machine-to-machine authentication
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
