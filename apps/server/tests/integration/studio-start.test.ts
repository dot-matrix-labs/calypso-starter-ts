import { afterEach, expect, test } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const CLONE_ROOT = join('/tmp', `calypso-studio-test-${Date.now()}`);
const GIT_ENV = sanitizedGitEnv();

function resolveStudioMainHash(cwd: string): string {
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    const result = spawnGitSync(['rev-parse', '--short', ref], cwd);
    if (result.exitCode === 0) {
      return (result.stdout ?? new Uint8Array()).toString().trim();
    }
  }

  throw new Error('Could not resolve a main branch ref for the Studio test clone.');
}

function cloneRepoRootWithWorkspaceChanges(): void {
  const clone = spawnGitSync(['clone', REPO_ROOT, CLONE_ROOT], REPO_ROOT);
  expect(clone.exitCode).toBe(0);

  const diff = spawnGitSync(['diff', '--binary', 'HEAD'], REPO_ROOT);
  expect(diff.exitCode).toBe(0);
  const patch = (diff.stdout ?? new Uint8Array()).toString();
  if (!patch.trim()) {
    return;
  }

  const apply = Bun.spawnSync(['git', 'apply', '--index'], {
    cwd: CLONE_ROOT,
    env: GIT_ENV,
    stdin: diff.stdout,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(apply.exitCode).toBe(0);
}

afterEach(() => {
  rmSync(CLONE_ROOT, { recursive: true, force: true });
});

test('bun run studio bootstraps an existing studio branch checkout and exits after bootstrap in test mode', async () => {
  cloneRepoRootWithWorkspaceChanges();

  spawnGitSync(['config', 'user.name', 'Studio Start Test'], CLONE_ROOT);
  spawnGitSync(['config', 'user.email', 'studio-start-test@example.com'], CLONE_ROOT);
  spawnGitSync(['branch', '-f', 'main', 'HEAD'], CLONE_ROOT);
  spawnGitSync(['checkout', 'main'], CLONE_ROOT);
  const mainHash = resolveStudioMainHash(CLONE_ROOT);
  const branchName = `studio/session-${mainHash}-a1b2`;
  spawnGitSync(['checkout', '-b', branchName], CLONE_ROOT);

  const studio = Bun.spawnSync(['bun', 'run', 'studio'], {
    cwd: CLONE_ROOT,
    env: {
      ...process.env,
      STUDIO_EXIT_AFTER_BOOTSTRAP: '1',
      STUDIO_SKIP_PUSH: '1',
      STUDIO_PORT: '5179',
      STUDIO_API_PORT: '31419',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  expect(studio.exitCode).toBe(0);

  const branch = spawnGitSync(['branch', '--show-current'], CLONE_ROOT);
  const checkedOutBranchName = (branch.stdout ?? new Uint8Array()).toString().trim();

  expect(checkedOutBranchName).toBe(branchName);

  const studioFilePath = join(CLONE_ROOT, '.studio');
  expect(existsSync(studioFilePath)).toBe(true);

  const studioInfo = JSON.parse(readFileSync(studioFilePath, 'utf8')) as {
    sessionId: string;
    branch: string;
    databaseUrl: string;
    containerId: string;
  };
  expect(studioInfo.branch).toBe(branchName);
  expect(studioInfo.sessionId).toBe('a1b2');
  expect(studioInfo.databaseUrl).toContain('postgres://');
  expect(studioInfo.containerId).toBeTruthy();

  const changesPath = join(CLONE_ROOT, 'docs', 'studio-sessions', branchName, 'changes.md');
  expect(existsSync(changesPath)).toBe(true);
  expect(readFileSync(changesPath, 'utf8')).toContain(`# Studio Session — ${branchName}`);

  const headCommit = Bun.spawnSync(['git', 'log', '-1', '--pretty=%s'], {
    cwd: CLONE_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect((headCommit.stdout ?? new Uint8Array()).toString().trim()).toBe(
    `studio: start session ${studioInfo.sessionId}`,
  );

  const deadline = Date.now() + 5_000;
  let containerInspect: ReturnType<typeof Bun.spawnSync>;
  do {
    containerInspect = Bun.spawnSync(['docker', 'inspect', studioInfo.containerId], {
      cwd: CLONE_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (containerInspect.exitCode !== 0) break;
    await Bun.sleep(200);
  } while (Date.now() < deadline);
  expect(containerInspect.exitCode).not.toBe(0);
}, 90_000);

test('bun run studio fails on a non-studio branch', () => {
  cloneRepoRootWithWorkspaceChanges();

  spawnGitSync(['config', 'user.name', 'Studio Start Test'], CLONE_ROOT);
  spawnGitSync(['config', 'user.email', 'studio-start-test@example.com'], CLONE_ROOT);
  spawnGitSync(['branch', '-f', 'main', 'HEAD'], CLONE_ROOT);
  spawnGitSync(['checkout', 'main'], CLONE_ROOT);

  const studio = Bun.spawnSync(['bun', 'run', 'studio'], {
    cwd: CLONE_ROOT,
    env: {
      ...process.env,
      STUDIO_EXIT_AFTER_BOOTSTRAP: '1',
      STUDIO_SKIP_PUSH: '1',
      STUDIO_PORT: '5179',
      STUDIO_API_PORT: '31419',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  expect(studio.exitCode).toBe(1);
  expect((studio.stderr ?? new Uint8Array()).toString()).toContain(
    'Studio requires a branch named studio/session-',
  );
  expect(existsSync(join(CLONE_ROOT, '.studio'))).toBe(false);
});

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
