/**
 * MSW helper that loads golden fixture files from disk and serves them
 * as sequential HTTP responses. This replaces the custom
 * CALYPSO_CLOUD_PROVIDER_HTTP_MODE=replay transport with network-level
 * interception so that real fetch() code paths execute.
 *
 * Usage:
 *   const { server } = createFixtureServer('/path/to/fixture-dir');
 *   beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
 *   afterAll(() => server.close());
 *   afterEach(() => server.resetHandlers());
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { http, HttpResponse } from 'msw';
import { setupServer, type SetupServerApi } from 'msw/node';

interface RecordedFixture {
  request: {
    body?: unknown;
    method: string;
    url: string;
  };
  response: {
    body: unknown;
    headers: Record<string, string>;
    status: number;
    statusText: string;
  };
}

function loadFixtures(fixtureDir: string): RecordedFixture[] {
  const files = readdirSync(fixtureDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  return files.map((file) => JSON.parse(readFileSync(join(fixtureDir, file), 'utf8')));
}

/**
 * Creates an MSW server that replays fixtures from a directory in sequence.
 * Each incoming request consumes the next fixture. The request URL and method
 * must match the fixture; if they don't, the handler throws.
 */
export function createFixtureServer(fixtureDir: string): {
  server: SetupServerApi;
  fixtures: RecordedFixture[];
} {
  const fixtures = loadFixtures(fixtureDir);
  let nextIndex = 0;

  const handler = http.all('*', ({ request }) => {
    if (nextIndex >= fixtures.length) {
      throw new Error(
        `No replay fixture remains for ${request.method} ${request.url} in ${fixtureDir}`,
      );
    }

    const fixture = fixtures[nextIndex];
    const expectedUrl = new URL(fixture.request.url);
    const actualUrl = new URL(request.url);

    // Compare method and URL path (ignore query param order)
    if (
      fixture.request.method !== request.method ||
      expectedUrl.origin + expectedUrl.pathname !== actualUrl.origin + actualUrl.pathname
    ) {
      throw new Error(
        [
          `Unexpected request at fixture index ${nextIndex + 1} in ${fixtureDir}`,
          `Expected: ${fixture.request.method} ${expectedUrl.origin}${expectedUrl.pathname}`,
          `Received: ${request.method} ${actualUrl.origin}${actualUrl.pathname}`,
        ].join('\n'),
      );
    }

    nextIndex++;

    // Strip content-encoding — fixtures store decoded JSON but may retain
    // the original gzip/br header from the real API recording.
    const headers = { ...fixture.response.headers };
    delete headers['content-encoding'];

    const body = fixture.response.body === null ? undefined : JSON.stringify(fixture.response.body);
    return new HttpResponse(body, {
      status: fixture.response.status,
      statusText: fixture.response.statusText,
      headers,
    });
  });

  const server = setupServer(handler);

  return { server, fixtures };
}

/**
 * Resets the fixture replay index so the same server can be reused
 * across tests with different fixture directories.
 */
export function createFixtureHandler(fixtureDir: string) {
  const fixtures = loadFixtures(fixtureDir);
  let nextIndex = 0;

  const handler = http.all('*', ({ request }) => {
    if (nextIndex >= fixtures.length) {
      return HttpResponse.json(
        { error: `No fixture remains for ${request.method} ${request.url}` },
        { status: 500 },
      );
    }

    const fixture = fixtures[nextIndex];
    nextIndex++;

    // Strip content-encoding — fixtures store decoded JSON but may retain
    // the original gzip/br header from the real API recording.
    const headers = { ...fixture.response.headers };
    delete headers['content-encoding'];

    const body = fixture.response.body === null ? undefined : JSON.stringify(fixture.response.body);
    return new HttpResponse(body, {
      status: fixture.response.status,
      statusText: fixture.response.statusText,
      headers,
    });
  });

  const reset = () => {
    nextIndex = 0;
  };

  return { handler, fixtures, reset };
}
