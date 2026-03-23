import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { config } from 'core/config';
import { buildStudioPrompt, type StudioMessage } from './helpers';
import { readProcStdout } from '../lib/response';

export const REPO_ROOT = config.repoRoot;

export async function runAgent(messages: StudioMessage[], branch: string): Promise<string> {
  const changesPath = join(REPO_ROOT, `docs/studio-sessions/${branch}/changes.md`);
  const changesContent = existsSync(changesPath) ? readFileSync(changesPath, 'utf8') : undefined;
  const fullPrompt = buildStudioPrompt({
    branch,
    messages,
    changesContent,
  });

  const proc = Bun.spawn(['claude', '-p', fullPrompt, '--dangerously-skip-permissions'], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const output = await readProcStdout(proc.stdout);
  await proc.exited;

  return output.trim();
}
