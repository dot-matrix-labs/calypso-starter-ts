import { REPO_ROOT } from './agent';
import { parseSessionCommits } from './helpers';
import { readProcStdout } from '../lib/response';

async function resolveCommitBaseRef(explicitBaseBranch?: string): Promise<string | null> {
  const candidates = explicitBaseBranch
    ? [explicitBaseBranch]
    : ['main', 'origin/main', 'master', 'origin/master'];

  for (const ref of candidates) {
    const proc = Bun.spawn(['git', 'rev-parse', '--verify', '--quiet', ref], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = await readProcStdout(proc.stdout);
    await proc.exited;
    if (output.trim()) return ref;
  }

  const mergeParentProc = Bun.spawn(['git', 'rev-parse', '--verify', '--quiet', 'HEAD^1'], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const mergeParent = await readProcStdout(mergeParentProc.stdout);
  await mergeParentProc.exited;
  if (mergeParent.trim()) return 'HEAD^1';

  return null;
}

export async function getCurrentBranch(): Promise<string> {
  const proc = Bun.spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
  });
  const output = await readProcStdout(proc.stdout);
  return output.trim();
}

export async function getSessionCommits(
  baseBranch?: string,
): Promise<{ hash: string; message: string }[]> {
  const baseRef = await resolveCommitBaseRef(baseBranch);
  if (!baseRef) return [];

  const proc = Bun.spawn(['git', 'log', `${baseRef}..HEAD`, '--oneline', '--no-decorate'], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await readProcStdout(proc.stdout);
  return parseSessionCommits(output);
}

export async function rollbackTo(hash: string): Promise<void> {
  const proc = Bun.spawn(['git', 'reset', '--hard', hash], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await proc.exited;
}
