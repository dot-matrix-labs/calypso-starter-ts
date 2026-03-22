import { describe, it, expect } from 'vitest';
import { loadAgentDbConfig } from '../../src/db';

describe('loadAgentDbConfig', () => {
  it('throws when AGENT_DATABASE_URL is missing', () => {
    expect(() => loadAgentDbConfig({ AGENT_TYPE: 'coding' } as NodeJS.ProcessEnv)).toThrow(
      'Missing required environment variables',
    );
  });

  it('throws when AGENT_TYPE is missing', () => {
    expect(() =>
      loadAgentDbConfig({
        AGENT_DATABASE_URL: 'postgres://agent_coding:pw@localhost/calypso_app',
      } as NodeJS.ProcessEnv),
    ).toThrow('Missing required environment variables');
  });

  it('returns config when all required vars are present', () => {
    const config = loadAgentDbConfig({
      AGENT_DATABASE_URL: 'postgres://agent_coding:pw@localhost/calypso_app',
      AGENT_TYPE: 'coding',
    } as NodeJS.ProcessEnv);
    expect(config).toEqual({
      agentDatabaseUrl: 'postgres://agent_coding:pw@localhost/calypso_app',
      agentType: 'coding',
    });
  });
});
