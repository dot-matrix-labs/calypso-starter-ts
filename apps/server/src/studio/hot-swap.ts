/**
 * @file studio/hot-swap.ts
 *
 * Hot-swap engine for Studio Mode.
 *
 * Responsibilities:
 * - File-to-service mapping: determines which services are affected by a set of
 *   changed file paths.
 * - Migration detection: identifies whether drizzle migration files changed.
 * - Binary build: spawns bun build commands for affected services, streaming
 *   stdout/stderr to a provided writer.
 * - Pod cycling: deletes affected pods via kubectl so the deployment controller
 *   recreates them from the updated volume-mounted binary.
 * - Pod restart timeout: warns after 60 seconds if pods are not Ready.
 *
 * Error handling:
 * - Build failure aborts before touching the cluster; error is streamed.
 * - Migration failure skips pod cycling; error is streamed.
 */

export type Service = 'api' | 'web' | 'agents';

export const ALL_SERVICES: Service[] = ['api', 'web', 'agents'];

/** Maps a set of changed file paths to the affected cluster services. */
export function mapFilesToServices(changedFiles: string[]): Service[] {
  const affected = new Set<Service>();

  for (const file of changedFiles) {
    if (file.startsWith('apps/server/') || file.startsWith('apps/worker/')) {
      affected.add('api');
    }
    if (file.startsWith('apps/web/')) {
      affected.add('web');
    }
    if (file.startsWith('packages/')) {
      // packages affect all services
      return [...ALL_SERVICES];
    }
  }

  return [...affected];
}

/** Returns true if any changed file is a drizzle migration file. */
export function hasMigrationChanges(changedFiles: string[]): boolean {
  return changedFiles.some((f) => f.includes('packages/core/drizzle/'));
}

export interface StreamWriter {
  write(chunk: string): void;
}

export interface HotSwapOptions {
  changedFiles: string[];
  writer: StreamWriter;
  /** kubectl context, defaults to 'default' */
  kubectlContext?: string;
  /** pod restart timeout in ms, defaults to 60_000 */
  podRestartTimeoutMs?: number;
  /** override Bun.spawn for testing */
  spawnFn?: SpawnFn;
  /** override kubectl pod watch for testing */
  watchPodsFn?: WatchPodsFn;
  /** override kubectl delete pod for testing */
  deletePodFn?: DeletePodFn;
}

export type SpawnResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type SpawnFn = (cmd: string[], opts?: { cwd?: string }) => Promise<SpawnResult>;
export type WatchPodsFn = (
  service: Service,
  context: string,
  onTransition: (line: string) => void,
  signal: AbortSignal,
) => Promise<void>;
export type DeletePodFn = (service: Service, context: string) => Promise<SpawnResult>;

const DEFAULT_POD_RESTART_TIMEOUT_MS = 60_000;

async function defaultSpawn(cmd: string[], opts?: { cwd?: string }): Promise<SpawnResult> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function defaultDeletePod(service: Service, context: string): Promise<SpawnResult> {
  return defaultSpawn([
    'kubectl',
    '--context',
    context,
    'delete',
    'pod',
    '-l',
    `app=${service}`,
    '--grace-period=0',
  ]);
}

async function defaultWatchPods(
  service: Service,
  context: string,
  onTransition: (line: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const proc = Bun.spawn(
    ['kubectl', '--context', context, 'get', 'pods', '-l', `app=${service}`, '--watch'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  signal.addEventListener('abort', () => {
    proc.kill();
  });

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) onTransition(line);
      }
    }
  } finally {
    reader.releaseLock();
    proc.kill();
  }
}

export interface HotSwapResult {
  ok: boolean;
  error?: string;
  servicesRestarted?: Service[];
}

/**
 * Runs the full hot-swap flow:
 * 1. Determine affected services.
 * 2. Run migrations if drizzle files changed.
 * 3. Build affected service binaries.
 * 4. Delete affected pods.
 * 5. Wait for pods to become Ready (with timeout warning).
 */
export async function hotSwap(opts: HotSwapOptions): Promise<HotSwapResult> {
  const {
    changedFiles,
    writer,
    kubectlContext = 'default',
    podRestartTimeoutMs = DEFAULT_POD_RESTART_TIMEOUT_MS,
    spawnFn = defaultSpawn,
    deletePodFn = defaultDeletePod,
    watchPodsFn = defaultWatchPods,
  } = opts;

  const affected = mapFilesToServices(changedFiles);

  if (affected.length === 0) {
    writer.write('[hot-swap] No affected services — nothing to restart.\n');
    return { ok: true, servicesRestarted: [] };
  }

  writer.write(`[hot-swap] Affected services: ${affected.join(', ')}\n`);

  // Step 2: migrations
  if (hasMigrationChanges(changedFiles)) {
    writer.write('[hot-swap] Migration files changed — running bun run db:migrate...\n');
    const migResult = await spawnFn(['bun', 'run', 'db:migrate']);
    writer.write(migResult.stdout);
    if (migResult.stderr) writer.write(migResult.stderr);
    if (migResult.exitCode !== 0) {
      const msg = `[hot-swap] Migration failed (exit ${migResult.exitCode}) — pod cycling aborted.\n`;
      writer.write(msg);
      return { ok: false, error: msg };
    }
    writer.write('[hot-swap] Migration complete.\n');
  }

  // Step 3: build affected services
  for (const service of affected) {
    writer.write(`[hot-swap] Building service: ${service}...\n`);
    const buildResult = await spawnFn(['bun', 'run', 'build'], {
      cwd: `apps/${serviceToApp(service)}`,
    });
    writer.write(buildResult.stdout);
    if (buildResult.stderr) writer.write(buildResult.stderr);
    if (buildResult.exitCode !== 0) {
      const msg = `[hot-swap] Build failed for ${service} (exit ${buildResult.exitCode}) — cluster untouched.\n`;
      writer.write(msg);
      return { ok: false, error: msg };
    }
    writer.write(`[hot-swap] Build succeeded for ${service}.\n`);
  }

  // Step 4: delete affected pods
  for (const service of affected) {
    writer.write(`[hot-swap] Cycling pods for service: ${service}...\n`);
    const deleteResult = await deletePodFn(service, kubectlContext);
    writer.write(deleteResult.stdout);
    if (deleteResult.stderr) writer.write(deleteResult.stderr);
    if (deleteResult.exitCode !== 0) {
      writer.write(`[hot-swap] Warning: pod delete returned non-zero for ${service}.\n`);
    }
  }

  // Step 5: wait for pods Ready with timeout
  const timeoutWarningMs = podRestartTimeoutMs;
  await Promise.all(
    affected.map((service) =>
      waitForPodsReady({ service, kubectlContext, timeoutMs: timeoutWarningMs, writer, spawnFn }),
    ),
  );

  writer.write(`[hot-swap] Hot-swap complete for: ${affected.join(', ')}\n`);
  return { ok: true, servicesRestarted: affected };
}

function serviceToApp(service: Service): string {
  switch (service) {
    case 'api':
      return 'server';
    case 'web':
      return 'web';
    case 'agents':
      return 'worker';
  }
}

async function waitForPodsReady(opts: {
  service: Service;
  kubectlContext: string;
  timeoutMs: number;
  writer: StreamWriter;
  spawnFn: SpawnFn;
}): Promise<void> {
  const { service, kubectlContext, timeoutMs, writer, spawnFn } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await spawnFn([
      'kubectl',
      '--context',
      kubectlContext,
      'get',
      'pods',
      '-l',
      `app=${service}`,
      '--no-headers',
    ]);

    const lines = result.stdout.trim().split('\n').filter(Boolean);
    const allReady = lines.every((line) => {
      // Typical output: NAME READY STATUS RESTARTS AGE
      // STATUS should be "Running" and READY should show n/n
      const parts = line.split(/\s+/);
      const readyCol = parts[1] ?? '';
      const statusCol = parts[2] ?? '';
      if (statusCol === 'CrashLoopBackOff' || statusCol === 'Error') {
        writer.write(`[hot-swap] Pod in ${statusCol} for ${service}: ${line}\n`);
        return false;
      }
      const [current, total] = readyCol.split('/').map(Number);
      return statusCol === 'Running' && current > 0 && current === total;
    });

    if (allReady && lines.length > 0) {
      writer.write(`[hot-swap] Pods Ready for ${service}.\n`);
      return;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  writer.write(
    `[hot-swap] Warning: pods for ${service} did not reach Ready within ${timeoutMs / 1000}s.\n`,
  );
}
