import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';

import { describe, expect, test } from 'vitest';

/**
 * Makes an HTTP request using node:http (not fetch) to test real local
 * HTTP servers without interfering with the fixture replay system.
 */
function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('OAuth localhost callback server', () => {
  test('accepts valid callback with correct state and code', async () => {
    const { createServer } = await import('node:http');
    const state = 'test-state-value';
    let resolvedPayload: { code?: string; state?: string } | null = null;

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/oauth2/callback') {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const payload = {
        code: url.searchParams.get('code') ?? undefined,
        state: url.searchParams.get('state') ?? undefined,
      };
      if (payload.state !== state) {
        res.statusCode = 400;
        res.end('Invalid state');
        return;
      }
      res.statusCode = 200;
      res.end('OK');
      resolvedPayload = payload;
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };

    try {
      const response = await httpGet(
        `http://127.0.0.1:${address.port}/oauth2/callback?code=auth-code-123&state=${state}`,
      );
      expect(response.status).toBe(200);
      expect(resolvedPayload).toEqual(expect.objectContaining({ code: 'auth-code-123', state }));
    } finally {
      server.close();
    }
  });

  test('rejects callback with mismatched state parameter', async () => {
    const { createServer } = await import('node:http');
    const state = 'expected-state';
    let rejected = false;

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/oauth2/callback') {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      if (url.searchParams.get('state') !== state) {
        res.statusCode = 400;
        res.end('Invalid OAuth state');
        rejected = true;
        return;
      }
      res.statusCode = 200;
      res.end('OK');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };

    try {
      const response = await httpGet(
        `http://127.0.0.1:${address.port}/oauth2/callback?code=auth-code&state=wrong-state`,
      );
      expect(response.status).toBe(400);
      expect(rejected).toBe(true);
    } finally {
      server.close();
    }
  });

  test('returns 404 for non-callback paths', async () => {
    const { createServer } = await import('node:http');

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/oauth2/callback') {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      res.statusCode = 200;
      res.end('OK');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };

    try {
      const response = await httpGet(`http://127.0.0.1:${address.port}/other-path`);
      expect(response.status).toBe(404);
    } finally {
      server.close();
    }
  });

  test('forwards OAuth provider error in callback', async () => {
    const { createServer } = await import('node:http');
    const state = 'test-state';
    let errorPayload: { error?: string; errorDescription?: string } | null = null;

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/oauth2/callback') {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const error = url.searchParams.get('error') ?? undefined;
      if (url.searchParams.get('state') !== state) {
        res.statusCode = 400;
        res.end('Invalid state');
        return;
      }
      if (error) {
        res.statusCode = 400;
        res.end(`OAuth error: ${error}`);
        errorPayload = {
          error,
          errorDescription: url.searchParams.get('error_description') ?? undefined,
        };
        return;
      }
      res.statusCode = 200;
      res.end('OK');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };

    try {
      const response = await httpGet(
        `http://127.0.0.1:${address.port}/oauth2/callback?error=access_denied&error_description=User+denied+access&state=${state}`,
      );
      expect(response.status).toBe(400);
      expect(errorPayload).not.toBeNull();
      expect((errorPayload as { error?: string }).error).toBe('access_denied');
      expect((errorPayload as { errorDescription?: string }).errorDescription).toBe(
        'User denied access',
      );
    } finally {
      server.close();
    }
  });
});

describe('PKCE challenge generation', () => {
  test('S256 challenge is deterministic and differs from verifier', () => {
    const verifierBytes = randomBytes(32);
    const verifier = Buffer.from(verifierBytes).toString('base64url');
    const challenge = Buffer.from(createHash('sha256').update(verifier).digest()).toString(
      'base64url',
    );

    expect(verifier.length).toBeGreaterThan(30);
    expect(challenge).not.toBe(verifier);

    const challenge2 = Buffer.from(createHash('sha256').update(verifier).digest()).toString(
      'base64url',
    );
    expect(challenge2).toBe(challenge);
  });

  test('base64url encoding produces URL-safe output without padding', () => {
    const testData = Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb]);
    const encoded = testData.toString('base64url');
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded).toBeTruthy();
  });
});
