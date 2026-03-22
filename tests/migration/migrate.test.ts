import { afterAll, beforeAll, expect, test } from 'vitest';
import { migrate } from '../../packages/db';
import { startPostgres, type PgContainer } from '../../packages/db/pg-container';

const EXPECTED_TABLES = [
  'entities',
  'entity_types',
  'passkey_challenges',
  'passkey_credentials',
  'relations',
  'revoked_tokens',
  'task_queue',
  'task_queue_view_analysis',
  'task_queue_view_coding',
] as const;

let pg: PgContainer;

beforeAll(async () => {
  pg = await startPostgres();
}, 60_000);

afterAll(async () => {
  await pg?.stop();
});

test('migrate() creates the expected tables and is idempotent', async () => {
  await migrate({ databaseUrl: pg.url });
  expect(new Set(listPublicTables(pg.containerId))).toEqual(new Set(EXPECTED_TABLES));

  await expect(migrate({ databaseUrl: pg.url })).resolves.toBeUndefined();
});

function listPublicTables(containerId: string): string[] {
  const query = [
    'SELECT table_name',
    'FROM information_schema.tables',
    "WHERE table_schema = 'public'",
    'ORDER BY table_name',
  ].join(' ');
  const proc = Bun.spawnSync([
    'docker',
    'exec',
    containerId,
    'psql',
    '-U',
    'calypso',
    '-d',
    'calypso',
    '-At',
    '-c',
    query,
  ]);

  expect(proc.exitCode).toBe(0);

  return new TextDecoder()
    .decode(proc.stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
