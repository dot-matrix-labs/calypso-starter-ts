import { describe, it, expect } from 'vitest';
import {
  mapFilesToServices,
  hasMigrationChanges,
  hotSwap,
  type SpawnResult,
} from '../../src/studio/hot-swap';

// --- file-to-service mapping ---

describe('mapFilesToServices', () => {
  it('maps apps/server/ changes to api only', () => {
    const result = mapFilesToServices(['apps/server/src/index.ts']);
    expect(result).toEqual(['api']);
  });

  it('maps apps/worker/ changes to api (workers run as api service)', () => {
    const result = mapFilesToServices(['apps/worker/src/worker.ts']);
    expect(result).toEqual(['api']);
  });

  it('maps apps/web/ changes to web only', () => {
    const result = mapFilesToServices(['apps/web/src/App.tsx']);
    expect(result).toEqual(['web']);
  });

  it('maps packages/ changes to all services', () => {
    const result = mapFilesToServices(['packages/core/index.ts']);
    expect(result).toHaveLength(3);
    expect(result).toContain('api');
    expect(result).toContain('web');
    expect(result).toContain('agents');
  });

  it('returns empty array for unrecognised paths', () => {
    const result = mapFilesToServices(['docs/studio-mode.md', 'README.md']);
    expect(result).toEqual([]);
  });

  it('returns each service at most once for multiple server changes', () => {
    const result = mapFilesToServices(['apps/server/src/index.ts', 'apps/server/src/api/auth.ts']);
    expect(result).toEqual(['api']);
  });

  it('handles mixed app/ and web/ changes without packages/', () => {
    const result = mapFilesToServices(['apps/server/src/index.ts', 'apps/web/src/App.tsx']);
    expect(result).toContain('api');
    expect(result).toContain('web');
    expect(result).not.toContain('agents');
  });

  it('escalates to all services as soon as one packages/ file appears', () => {
    const result = mapFilesToServices(['apps/server/src/index.ts', 'packages/db/schema.ts']);
    expect(result).toHaveLength(3);
  });
});

// --- migration detection ---

describe('hasMigrationChanges', () => {
  it('detects drizzle directory changes', () => {
    expect(hasMigrationChanges(['packages/core/drizzle/0001_initial.sql'])).toBe(true);
  });

  it('returns false when no drizzle files changed', () => {
    expect(hasMigrationChanges(['apps/server/src/index.ts'])).toBe(false);
  });

  it('detects nested drizzle files', () => {
    expect(hasMigrationChanges(['packages/core/drizzle/migrations/0002_add_column.sql'])).toBe(
      true,
    );
  });
});

// --- hotSwap integration (with stub spawn functions) ---

const SUCCESS_SPAWN: () => Promise<SpawnResult> = async () => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
});

const FAIL_SPAWN: (code: number, msg: string) => () => Promise<SpawnResult> =
  (code, msg) => async () => ({
    exitCode: code,
    stdout: '',
    stderr: msg,
  });

function makeWriter() {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
    },
    output() {
      return chunks.join('');
    },
  };
}

describe('hotSwap', () => {
  it('returns ok with no services when no recognisable files changed', async () => {
    const writer = makeWriter();
    const result = await hotSwap({
      changedFiles: ['README.md'],
      writer,
      spawnFn: SUCCESS_SPAWN,
      deletePodFn: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    });
    expect(result.ok).toBe(true);
    expect(result.servicesRestarted).toEqual([]);
  });

  it('stops before cluster touch when build fails', async () => {
    const writer = makeWriter();
    let deleteCalled = false;

    const result = await hotSwap({
      changedFiles: ['apps/server/src/index.ts'],
      writer,
      spawnFn: FAIL_SPAWN(1, 'build error'),
      deletePodFn: async () => {
        deleteCalled = true;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Build failed/);
    expect(deleteCalled).toBe(false);
    expect(writer.output()).toMatch(/cluster untouched/);
  });

  it('stops before pod cycling when migration fails', async () => {
    const writer = makeWriter();
    let deleteCalled = false;

    // Migration spawn fails, build spawn would succeed
    let callCount = 0;
    const spawnFn = async (): Promise<SpawnResult> => {
      callCount++;
      if (callCount === 1) {
        // first call is migration
        return { exitCode: 1, stdout: '', stderr: 'migration error' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const result = await hotSwap({
      changedFiles: ['packages/core/drizzle/0001_initial.sql'],
      writer,
      spawnFn,
      deletePodFn: async () => {
        deleteCalled = true;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Migration failed/);
    expect(deleteCalled).toBe(false);
  });
});
