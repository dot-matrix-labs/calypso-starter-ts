import { scrubPii } from 'core';
import type { AppState } from '../index';
import { signJwt, verifyJwt } from '../auth/jwt';
import { revokeToken } from 'db/revocation';
import { generateCsrfToken, csrfCookieHeader, verifyCsrf } from '../auth/csrf';

// Starter auth note:
// These routes are intentionally simple so the current app can register and log
// in during development. They do not satisfy the full blueprint posture yet:
// passkeys, dual attribution for consequential actions, separate audit writes,
// and scoped sandbox credentials are all still future implementation work.

// Helper to parse cookies from headers
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
  });
  return cookies;
}

// Helper to verify auth from a Request object
export async function getAuthenticatedUser(
  req: Request,
): Promise<{ id: string; username: string } | null> {
  const cookies = parseCookies(req.headers.get('Cookie'));
  const token = cookies['calypso_auth'];

  if (!token) return null;

  try {
    const payload = await verifyJwt<{ id: string; username: string }>(token);
    return payload;
  } catch {
    return null;
  }
}

// Helper to get CORS headers dynamically
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || 'http://localhost:5174';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
  };
}

export async function handleAuthRequest(
  req: Request,
  url: URL,
  appState: AppState,
): Promise<Response | null> {
  const corsHeaders = getCorsHeaders(req);
  const { sql } = appState;

  // Preflight CORS
  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/auth')) {
    return new Response(null, { headers: corsHeaders });
  }

  // CSRF check for state-mutating auth routes (register, login, logout)
  // Login and register are exempt because no authenticated session cookie
  // exists yet — the CSRF token is issued as part of the response.
  // Logout mutates server state, so it is checked.
  const cookies = parseCookies(req.headers.get('Cookie'));
  if (
    url.pathname === '/api/auth/logout' ||
    (req.method !== 'POST' &&
      req.method !== 'GET' &&
      req.method !== 'OPTIONS' &&
      req.method !== 'HEAD' &&
      url.pathname.startsWith('/api/auth'))
  ) {
    const csrfError = verifyCsrf(req, cookies);
    if (csrfError) return csrfError;
  }

  // 1. POST /api/auth/register
  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    try {
      const { username, password } = await req.json();
      if (!username || !password || password.length < 6) {
        return new Response(JSON.stringify({ error: 'Invalid username or password' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if user exists (checking JSONB property 'username' where type is 'user')
      const existingUser = await sql`
                SELECT id FROM entities 
                WHERE type = 'user' AND properties->>'username' = ${username}
            `;

      if (existingUser.length > 0) {
        return new Response(JSON.stringify({ error: 'Username already taken' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const id = crypto.randomUUID();
      const hash = await Bun.password.hash(password);

      const properties = {
        username,
        password_hash: hash,
      };

      // Starter implementation: identity material still lives in the generic
      // entities table. The target posture separates auth controls, audit, and
      // sensitive-data handling more explicitly.
      await sql`
                INSERT INTO entities (id, type, properties, tenant_id) 
                VALUES (${id}, 'user', ${sql.json(properties)}, null)
            `;

      const token = await signJwt({ id, username });
      const csrfToken = generateCsrfToken();

      const res = new Response(JSON.stringify({ user: { id, username } }), {
        status: 201,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          // Starter cookie settings are intentionally minimal. The blueprint
          // target is HTTP-only secure cookies with stricter session controls.
        },
      });
      res.headers.append(
        'Set-Cookie',
        `calypso_auth=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`,
      );
      res.headers.append('Set-Cookie', csrfCookieHeader(csrfToken));
      return res;
    } catch (err) {
      console.error(
        'REGISTER ERROR:',
        scrubPii(err instanceof Error ? { message: err.message, stack: err.stack } : err),
      );
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  }

  // 2. POST /api/auth/login
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    try {
      const { username, password } = await req.json();

      // Retrieve User Entity
      const users = await sql`
                SELECT id, properties->>'username' as username, properties->>'password_hash' as password_hash 
                FROM entities 
                WHERE type = 'user' AND properties->>'username' = ${username}
            `;

      if (users.length === 0) {
        return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const user = users[0];

      const isMatch = await Bun.password.verify(password, user.password_hash);
      if (!isMatch) {
        return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const token = await signJwt({ id: user.id, username: user.username });
      const csrfToken = generateCsrfToken();

      const res = new Response(JSON.stringify({ user: { id: user.id, username: user.username } }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
      res.headers.append(
        'Set-Cookie',
        `calypso_auth=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`,
      );
      res.headers.append('Set-Cookie', csrfCookieHeader(csrfToken));
      return res;
    } catch (err) {
      console.error(
        'LOGIN ERROR:',
        scrubPii(err instanceof Error ? { message: err.message, stack: err.stack } : err),
      );
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  }

  // 3. GET /api/auth/me
  // Validates the session cookie and returns user profile
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ user }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 4. POST /api/auth/logout
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const cookies = parseCookies(req.headers.get('Cookie'));
    const token = cookies['calypso_auth'];

    if (token) {
      try {
        // Decode without full verify so we can always revoke even if the token
        // is already near expiry. We only need jti and exp from the payload.
        const parts = token.split('.');
        if (parts.length === 3) {
          const payloadStr = atob(
            parts[1]
              .replace(/-/g, '+')
              .replace(/_/g, '/')
              .padEnd(parts[1].length + ((4 - (parts[1].length % 4)) % 4), '='),
          );
          const payload = JSON.parse(payloadStr) as { jti?: string; exp?: number };
          if (payload.jti && payload.exp) {
            const expiresAt = new Date(payload.exp * 1000);
            await revokeToken(payload.jti, expiresAt);
          }
        }
      } catch {
        // Best-effort: revocation failure should not block logout response.
      }
    }

    const res = new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
    res.headers.append('Set-Cookie', 'calypso_auth=; HttpOnly; Path=/; Max-Age=0');
    res.headers.append(
      'Set-Cookie',
      '__Host-csrf-token=; SameSite=Strict; Secure; Path=/; Max-Age=0',
    );
    return res;
  }

  return null;
}
