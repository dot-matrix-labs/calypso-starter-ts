/**
 * Worker database pool — read-only agent-type credentials.
 *
 * Workers connect using their type-specific role (`agent_<type>`) which has
 * SELECT-only access on the per-type task queue view. The role is created by
 * `init-remote.ts` during genesis DB init and explicitly denied INSERT, UPDATE,
 * DELETE via the `agent_worker` base role.
 *
 * Environment:
 *   AGENT_DATABASE_URL — connection string for the agent-type role
 *   AGENT_TYPE         — agent type name (e.g. "coding", "analysis")
 */

import postgres from 'postgres';
import { buildSslOptions } from 'db';

export interface AgentDbConfig {
  agentDatabaseUrl: string;
  agentType: string;
}

export function loadAgentDbConfig(env: NodeJS.ProcessEnv = process.env): AgentDbConfig {
  const missing = ['AGENT_DATABASE_URL', 'AGENT_TYPE'].filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return {
    agentDatabaseUrl: env.AGENT_DATABASE_URL!,
    agentType: env.AGENT_TYPE!,
  };
}

export function createAgentPool(agentDatabaseUrl: string) {
  return postgres(agentDatabaseUrl, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: buildSslOptions(),
    connection: { client_min_messages: 'warning' },
  });
}
