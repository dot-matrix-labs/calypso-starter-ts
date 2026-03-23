import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { runAgent, REPO_ROOT } from '../studio/agent';
import { getCurrentBranch, getSessionCommits, rollbackTo } from '../studio/git';
import {
  parseStudioInfo,
  validateRollbackHash,
  validateStudioMessage,
  type StudioMessage,
} from '../studio/helpers';
import { getCorsHeaders, getAuthenticatedUser } from './auth';
import { makeJson } from '../lib/response';

// In-memory session context per studio session
const sessionMessages: StudioMessage[] = [];

function isStudioMode(): boolean {
  return existsSync(join(REPO_ROOT, '.studio'));
}

function getStudioInfo(): { sessionId: string; branch: string } | null {
  const studioFile = join(REPO_ROOT, '.studio');
  if (!existsSync(studioFile)) return null;
  return parseStudioInfo(readFileSync(studioFile, 'utf8'));
}

export async function handleStudioRequest(req: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/studio')) return null;

  const corsHeaders = getCorsHeaders(req);
  const json = makeJson(corsHeaders);

  // Authentication guard — applied at route registration level so all current
  // and future studio routes are protected without per-handler checks.
  const user = await getAuthenticatedUser(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // GET /studio/status — is studio mode active?
  if (req.method === 'GET' && url.pathname === '/studio/status') {
    const info = getStudioInfo();
    if (!info) return json({ active: false });
    const branch = await getCurrentBranch();
    const commits = await getSessionCommits();
    return json({ active: true, ...info, branch, commits });
  }

  if (!isStudioMode()) {
    return json({ error: 'Studio mode is not active' }, 403);
  }

  const info = getStudioInfo()!;

  // GET /studio/commits — session commit log
  if (req.method === 'GET' && url.pathname === '/studio/commits') {
    const commits = await getSessionCommits();
    return json({ commits });
  }

  // POST /studio/rollback — rollback to a prior commit
  if (req.method === 'POST' && url.pathname === '/studio/rollback') {
    const { hash } = await req.json();
    const validatedHash = validateRollbackHash(hash);
    if (!validatedHash) return json({ error: 'hash required' }, 400);
    await rollbackTo(validatedHash);
    const commits = await getSessionCommits();
    return json({ ok: true, commits });
  }

  // POST /studio/reset — clear session context
  if (req.method === 'POST' && url.pathname === '/studio/reset') {
    sessionMessages.length = 0;
    return json({ ok: true });
  }

  // POST /studio/chat — main agent interaction
  if (req.method === 'POST' && url.pathname === '/studio/chat') {
    const { message } = await req.json();
    const validatedMessage = validateStudioMessage(message);
    if (!validatedMessage) return json({ error: 'message required' }, 400);

    sessionMessages.push({ role: 'user', content: validatedMessage });

    const reply = await runAgent(sessionMessages, info.branch);

    sessionMessages.push({ role: 'assistant', content: reply });

    const commits = await getSessionCommits();
    return json({ reply, commits });
  }

  return null;
}
