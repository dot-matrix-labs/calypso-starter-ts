/**
 * @file studio/cluster-events.ts
 *
 * Long-lived kubectl get pods --watch subprocess for the Studio Mode cluster
 * status stream. Pod state transitions are pushed to all subscribed SSE
 * connections.
 *
 * The stream is started once at server boot and runs for the lifetime of the
 * process. SSE subscribers register and unregister dynamically.
 */

export interface PodEvent {
  name: string;
  ready: string;
  status: string;
  restarts: string;
  age: string;
  raw: string;
}

export function parsePodLine(line: string): PodEvent | null {
  // Expected columns: NAME  READY  STATUS  RESTARTS  AGE
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) return null;
  // Skip header lines
  if (parts[0] === 'NAME') return null;
  return {
    name: parts[0],
    ready: parts[1],
    status: parts[2],
    restarts: parts[3],
    age: parts[4],
    raw: line.trim(),
  };
}

export function formatSseEvent(event: PodEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

type Subscriber = (chunk: string) => void;

export class ClusterEventStream {
  private subscribers: Set<Subscriber> = new Set();
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private running = false;
  private kubectlContext: string;

  constructor(kubectlContext = 'default') {
    this.kubectlContext = kubectlContext;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private broadcast(chunk: string): void {
    for (const fn of this.subscribers) {
      try {
        fn(chunk);
      } catch {
        // subscriber gone — it will unsubscribe on next request close
      }
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.runWatch();
      } catch {
        // restart after brief delay
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private async runWatch(): Promise<void> {
    this.proc = Bun.spawn(
      ['kubectl', '--context', this.kubectlContext, 'get', 'pods', '--watch', '--all-namespaces'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    const stdout = this.proc.stdout as ReadableStream<Uint8Array>;
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
      while (this.running) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = parsePodLine(line);
          if (event) {
            this.broadcast(formatSseEvent(event));
          }
        }
      }
    } finally {
      reader.releaseLock();
      if (this.proc) {
        this.proc.kill();
        this.proc = null;
      }
    }
  }
}

/**
 * Returns a Response that streams SSE cluster events for the lifetime of the
 * HTTP connection. Subscribes to the shared ClusterEventStream and
 * unsubscribes when the client disconnects.
 */
export function clusterEventsResponse(stream: ClusterEventStream): Response {
  let unsubscribe: (() => void) | null = null;

  const body = new ReadableStream({
    start(controller) {
      // Send an initial heartbeat comment so the browser considers the
      // connection open immediately.
      controller.enqueue(new TextEncoder().encode(': connected\n\n'));

      unsubscribe = stream.subscribe((chunk) => {
        try {
          controller.enqueue(new TextEncoder().encode(chunk));
        } catch {
          // controller closed — nothing to do
        }
      });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
