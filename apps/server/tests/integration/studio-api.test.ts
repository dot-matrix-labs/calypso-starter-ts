import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Subprocess } from 'bun';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { delimiter, join } from 'path';
import { startPostgres, type PgContainer } from '../helpers/pg-container';

const PORT = 31417;
const BASE = `http://localhost:${PORT}`;
const SERVER_READY_TIMEOUT_MS = 20_000;
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const CLONE_ROOT = join('/tmp', `calypso-studio-api-${Date.now()}`);
const SERVER_ENTRY = join(REPO_ROOT, 'apps/server/src/index.ts');
const CLAUDE_STUB_DIR = join(REPO_ROOT, 'tests', 'fixtures');
const CLAUDE_LOG_PATH = join(CLONE_ROOT, 'tests', 'fixtures', 'claude-integration.log');
const GIT_ENV = sanitizedGitEnv();

let pg: PgContainer;
let server: Subprocess;
let studioBranch = '';
let studioFilePath = '';
let sessionDir = '';
let changesPath = '';

beforeAll(async () => {
  const clone = spawnGitSync(['clone', REPO_ROOT, CLONE_ROOT], REPO_ROOT);
  expect(clone.exitCode).toBe(0);

  spawnGitSync(['config', 'user.name', 'Studio API Test'], CLONE_ROOT);
  spawnGitSync(['config', 'user.email', 'studio-api-test@example.com'], CLONE_ROOT);
  spawnGitSync(['branch', '-f', 'main', 'HEAD'], CLONE_ROOT);

  const mainHash = spawnGitSync(['rev-parse', '--short', 'main'], CLONE_ROOT);
  expect(mainHash.exitCode).toBe(0);

  studioBranch = `studio/session-${(mainHash.stdout ?? new Uint8Array()).toString().trim()}-itest`;
  spawnGitSync(['checkout', '-b', studioBranch], CLONE_ROOT);

  studioFilePath = join(CLONE_ROOT, '.studio');
  sessionDir = join(CLONE_ROOT, 'docs', 'studio-sessions', studioBranch);
  changesPath = join(sessionDir, 'changes.md');

  pg = await startPostgres();
  mkdirSync(join(CLONE_ROOT, 'tests', 'fixtures'), { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    changesPath,
    `# Studio Session — ${studioBranch}
**Started:** ${new Date().toISOString()}

## Changes

`,
  );

  server = Bun.spawn(['bun', 'run', SERVER_ENTRY], {
    cwd: CLONE_ROOT,
    env: {
      ...process.env,
      CALYPSO_REPO_ROOT: CLONE_ROOT,
      DATABASE_URL: pg.url,
      PORT: String(PORT),
      PATH: `${CLAUDE_STUB_DIR}${delimiter}${process.env.PATH ?? ''}`,
      CLAUDE_E2E_LOG_PATH: CLAUDE_LOG_PATH,
    },
    stdout: 'ignore',
    stderr: 'ignore',
  });

  await waitForServer(BASE);
}, 60_000);

afterAll(async () => {
  server?.kill();
  cleanupStudioArtifacts();
  rmSync(CLAUDE_LOG_PATH, { force: true });
  await pg?.stop();
  rmSync(CLONE_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  cleanupStudioArtifacts();
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    changesPath,
    `# Studio Session — ${studioBranch}
**Started:** ${new Date().toISOString()}

## Changes

`,
  );
  rmSync(CLAUDE_LOG_PATH, { force: true });
});

describe('Studio API integration', () => {
  test('GET /studio/status returns inactive when .studio is absent', async () => {
    const res = await fetch(`${BASE}/studio/status`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active: false });
  });

  test('GET /studio/status returns session metadata when .studio is present', async () => {
    writeStudioFile();

    const res = await fetch(`${BASE}/studio/status`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.active).toBe(true);
    expect(body.sessionId).toBe('itest');
    expect(body.branch).toBe(studioBranch);
    expect(Array.isArray(body.commits)).toBe(true);
  });

  test('POST /studio/chat returns 403 when studio mode is inactive', async () => {
    const res = await fetch(`${BASE}/studio/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Please adjust the header.' }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Studio mode is not active' });
  });

  test('POST /studio/chat returns 400 when message is missing', async () => {
    writeStudioFile();

    const res = await fetch(`${BASE}/studio/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'message required' });
  });

  test('POST /studio/chat preserves prior turns across a multi-turn session', async () => {
    writeStudioFile();

    const firstMessage = 'Please group dispatches by status.';
    const secondMessage = 'Now rename Tasks to Dispatches.';

    const firstRes = await fetch(`${BASE}/studio/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: firstMessage }),
    });
    expect(firstRes.status).toBe(200);

    const secondRes = await fetch(`${BASE}/studio/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: secondMessage }),
    });
    expect(secondRes.status).toBe(200);

    const prompt = await waitForLatestPromptContains(secondMessage);
    expect(prompt).toContain(`Partner: ${firstMessage}`);
    expect(prompt).toContain('Agent: Mocked Claude response for studio e2e.');
    expect(prompt).toContain(`Partner: ${secondMessage}`);
  });

  test('POST /studio/reset clears prior session context', async () => {
    writeStudioFile();

    const firstMessage = 'Add a priority badge to each card.';
    const secondMessage = 'Rename Tasks to Dispatches.';

    const firstRes = await fetch(`${BASE}/studio/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: firstMessage }),
    });
    expect(firstRes.status).toBe(200);

    const resetRes = await fetch(`${BASE}/studio/reset`, {
      method: 'POST',
    });
    expect(resetRes.status).toBe(200);

    rmSync(CLAUDE_LOG_PATH, { force: true });

    const secondRes = await fetch(`${BASE}/studio/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: secondMessage }),
    });
    expect(secondRes.status).toBe(200);

    const prompt = await waitForLatestPromptContains(secondMessage);
    expect(prompt).not.toContain(`Partner: ${firstMessage}`);
    expect(prompt).not.toContain('Agent: Mocked Claude response for studio e2e.');
    expect(prompt).toContain(`Partner: ${secondMessage}`);
  });

  test('POST /studio/rollback returns 400 when hash is missing', async () => {
    writeStudioFile();

    const res = await fetch(`${BASE}/studio/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'hash required' });
  });
});

function writeStudioFile() {
  writeFileSync(
    studioFilePath,
    JSON.stringify(
      {
        sessionId: 'itest',
        branch: studioBranch,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function cleanupStudioArtifacts() {
  rmSync(studioFilePath, { force: true });
  rmSync(sessionDir, { recursive: true, force: true });
}

function sanitizedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.GIT_CONFIG;
  delete env.GIT_DIR;
  delete env.GIT_EXEC_PATH;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_PREFIX;
  delete env.GIT_WORK_TREE;
  return env;
}

function spawnGitSync(args: string[], cwd: string) {
  return Bun.spawnSync(['git', ...args], {
    cwd,
    env: GIT_ENV,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

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

async function waitForLatestPromptContains(message: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (existsSync(CLAUDE_LOG_PATH)) {
      const log = readFileSync(CLAUDE_LOG_PATH, 'utf8');
      const prompts = log
        .split('PROMPT: ')
        .map((entry) => entry.trim())
        .filter(Boolean);
      const latestPrompt = prompts.at(-1) ?? '';
      if (latestPrompt.includes(message)) return latestPrompt;
    }
    await Bun.sleep(200);
  }
  throw new Error(`Timed out waiting for Claude log to include ${message}`);
}
