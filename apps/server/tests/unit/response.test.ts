import { describe, test, expect, afterEach } from 'vitest';
import { makeJson, isSuperuser, readProcStdout } from '../../src/lib/response';

// ---------------------------------------------------------------------------
// makeJson
// ---------------------------------------------------------------------------

describe('makeJson()', () => {
  test('returns a 200 JSON response by default', async () => {
    const json = makeJson({});
    const res = json({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  test('honours the status argument', async () => {
    const json = makeJson({});
    const res = json({ error: 'Not found' }, 404);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Not found' });
  });

  test('merges CORS headers alongside Content-Type', () => {
    const corsHeaders = { 'Access-Control-Allow-Origin': 'http://example.com' };
    const json = makeJson(corsHeaders);
    const res = json({});
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com');
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  test('serialises body to JSON', async () => {
    const json = makeJson({});
    const body = { items: [1, 2, 3], nested: { a: 'b' } };
    const res = json(body);
    const parsed = await res.json();
    expect(parsed).toEqual(body);
  });
});

// ---------------------------------------------------------------------------
// isSuperuser
// ---------------------------------------------------------------------------

describe('isSuperuser()', () => {
  const originalEnv = process.env.SUPERUSER_ID;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SUPERUSER_ID;
    } else {
      process.env.SUPERUSER_ID = originalEnv;
    }
  });

  test('returns true when userId matches SUPERUSER_ID', () => {
    process.env.SUPERUSER_ID = 'user-abc-123';
    expect(isSuperuser('user-abc-123')).toBe(true);
  });

  test('returns false when userId does not match SUPERUSER_ID', () => {
    process.env.SUPERUSER_ID = 'user-abc-123';
    expect(isSuperuser('user-xyz-999')).toBe(false);
  });

  test('returns false when SUPERUSER_ID is not set', () => {
    delete process.env.SUPERUSER_ID;
    expect(isSuperuser('any-user-id')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readProcStdout
// ---------------------------------------------------------------------------

describe('readProcStdout()', () => {
  test('returns empty string for undefined', async () => {
    expect(await readProcStdout(undefined)).toBe('');
  });

  test('returns empty string for a numeric file descriptor', async () => {
    expect(await readProcStdout(1)).toBe('');
  });

  test('reads text from a ReadableStream', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('hello from proc'));
        controller.close();
      },
    });
    expect(await readProcStdout(stream)).toBe('hello from proc');
  });
});
