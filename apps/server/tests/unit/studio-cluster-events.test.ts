import { describe, it, expect } from 'vitest';
import {
  parsePodLine,
  formatSseEvent,
  ClusterEventStream,
  clusterEventsResponse,
} from '../../src/studio/cluster-events';

// --- parsePodLine ---

describe('parsePodLine', () => {
  it('parses a normal pod line', () => {
    const line = 'api-abc-123   1/1   Running   0   5m';
    const event = parsePodLine(line);
    expect(event).not.toBeNull();
    expect(event!.name).toBe('api-abc-123');
    expect(event!.ready).toBe('1/1');
    expect(event!.status).toBe('Running');
    expect(event!.restarts).toBe('0');
    expect(event!.age).toBe('5m');
  });

  it('parses a CrashLoopBackOff line', () => {
    const line = 'web-xyz-456   0/1   CrashLoopBackOff   3   2m';
    const event = parsePodLine(line);
    expect(event).not.toBeNull();
    expect(event!.status).toBe('CrashLoopBackOff');
  });

  it('returns null for header lines', () => {
    const line = 'NAME   READY   STATUS   RESTARTS   AGE';
    expect(parsePodLine(line)).toBeNull();
  });

  it('returns null for lines with fewer than 5 columns', () => {
    expect(parsePodLine('foo bar')).toBeNull();
  });

  it('returns null for blank lines', () => {
    expect(parsePodLine('')).toBeNull();
    expect(parsePodLine('   ')).toBeNull();
  });
});

// --- formatSseEvent ---

describe('formatSseEvent', () => {
  it('produces data: <json> double-newline format', () => {
    const event = {
      name: 'api-123',
      ready: '1/1',
      status: 'Running',
      restarts: '0',
      age: '1m',
      raw: 'api-123 1/1 Running 0 1m',
    };
    const formatted = formatSseEvent(event);
    expect(formatted).toMatch(/^data: \{/);
    expect(formatted.endsWith('\n\n')).toBe(true);
  });

  it('includes all pod fields in the JSON', () => {
    const event = {
      name: 'web-abc',
      ready: '0/1',
      status: 'Pending',
      restarts: '0',
      age: '30s',
      raw: 'web-abc 0/1 Pending 0 30s',
    };
    const formatted = formatSseEvent(event);
    const json = JSON.parse(formatted.replace(/^data: /, '').trimEnd());
    expect(json.name).toBe('web-abc');
    expect(json.status).toBe('Pending');
  });
});

// --- ClusterEventStream subscribe/unsubscribe ---

describe('ClusterEventStream', () => {
  it('delivers broadcast events to subscribers', () => {
    // Access the private broadcast method via a subclass for unit testing
    class TestableStream extends ClusterEventStream {
      broadcastPublic(chunk: string) {
        // @ts-expect-error — accessing private method for testing
        this.broadcast(chunk);
      }
    }

    const stream = new TestableStream();
    const received: string[] = [];
    stream.subscribe((chunk) => received.push(chunk));
    stream.broadcastPublic('data: {}\n\n');
    expect(received).toEqual(['data: {}\n\n']);
  });

  it('stops delivering after unsubscribe', () => {
    class TestableStream extends ClusterEventStream {
      broadcastPublic(chunk: string) {
        // @ts-expect-error — accessing private method for testing
        this.broadcast(chunk);
      }
    }

    const stream = new TestableStream();
    const received: string[] = [];
    const unsub = stream.subscribe((chunk) => received.push(chunk));
    stream.broadcastPublic('first');
    unsub();
    stream.broadcastPublic('second');
    expect(received).toEqual(['first']);
  });

  it('delivers to multiple subscribers independently', () => {
    class TestableStream extends ClusterEventStream {
      broadcastPublic(chunk: string) {
        // @ts-expect-error — accessing private method for testing
        this.broadcast(chunk);
      }
    }

    const stream = new TestableStream();
    const a: string[] = [];
    const b: string[] = [];
    stream.subscribe((c) => a.push(c));
    stream.subscribe((c) => b.push(c));
    stream.broadcastPublic('event');
    expect(a).toEqual(['event']);
    expect(b).toEqual(['event']);
  });
});

// --- clusterEventsResponse ---

describe('clusterEventsResponse', () => {
  it('returns a text/event-stream response', () => {
    const stream = new ClusterEventStream();
    const response = clusterEventsResponse(stream);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('returns status 200', () => {
    const stream = new ClusterEventStream();
    const response = clusterEventsResponse(stream);
    expect(response.status).toBe(200);
  });

  it('sets Cache-Control: no-cache', () => {
    const stream = new ClusterEventStream();
    const response = clusterEventsResponse(stream);
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });
});
