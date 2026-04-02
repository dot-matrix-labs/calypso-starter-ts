/**
 * Passkey / WebAuthn authentication API handler.
 *
 * Implements two ceremonies using @simplewebauthn/server:
 *
 * Registration:
 *   POST /api/auth/passkey/register/begin   → PublicKeyCredentialCreationOptions
 *   POST /api/auth/passkey/register/complete → verify attestation, store credential
 *
 * Authentication:
 *   POST /api/auth/passkey/login/begin   → PublicKeyCredentialRequestOptions
 *   POST /api/auth/passkey/login/complete → verify assertion, issue JWT
 *
 * Challenges are 32-byte random values stored in the passkey_challenges table
 * with a 5-minute TTL. Counter-based clone detection rejects authentication if
 * the presented counter ≤ stored counter.
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { AppState } from '../index';
import { getCorsHeaders, getAuthenticatedUser, parseCookies } from './auth';
import { verifyCsrf } from '../auth/csrf';
import { signJwt } from '../auth/jwt';

// The Relying Party name (display only, not security-critical).
const RP_NAME = process.env.RP_NAME ?? 'Calypso';

// Default fallback values when no request headers or env vars are available.
const DEFAULT_RP_ID = 'localhost';
const DEFAULT_ORIGIN = 'http://localhost:5174';

/**
 * Derive WebAuthn RP ID and origin dynamically from the incoming request.
 *
 * Precedence:
 *   1. Environment variables RP_ID + ORIGIN (both must be set to take effect)
 *   2. Request Origin header
 *   3. Request Referer header
 *   4. Localhost defaults
 *
 * URL parsing errors fall back to localhost defaults.
 */
export function getRpConfig(req: Request): { rpId: string; origin: string } {
  // Env vars take precedence when both are set
  const envRpId = process.env.RP_ID;
  const envOrigin = process.env.ORIGIN;
  if (envRpId && envOrigin) {
    return { rpId: envRpId, origin: envOrigin };
  }

  // Try Origin header first, then Referer
  const headerValue = req.headers.get('origin') ?? req.headers.get('referer');
  if (headerValue) {
    try {
      const parsed = new URL(headerValue);
      return { rpId: parsed.hostname, origin: parsed.origin };
    } catch {
      // URL parsing failed — fall through to defaults
    }
  }

  return { rpId: DEFAULT_RP_ID, origin: DEFAULT_ORIGIN };
}

export async function handlePasskeyRequest(
  req: Request,
  url: URL,
  appState: AppState,
): Promise<Response | null> {
  const corsHeaders = getCorsHeaders(req);
  const { sql } = appState;

  // Preflight
  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/auth/passkey')) {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ------------------------------------------------------------------
  // GET /api/auth/passkey/credentials
  // ------------------------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/api/auth/passkey/credentials') {
    const user = await getAuthenticatedUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401, corsHeaders);

    try {
      const credentials = await sql`
        SELECT id, credential_id, created_at, last_used_at
        FROM passkey_credentials
        WHERE user_id = ${user.id}
        ORDER BY created_at DESC
      `;
      return json(credentials, 200, corsHeaders);
    } catch (err) {
      console.error('PASSKEY CREDENTIALS LIST ERROR:', err);
      return json({ error: 'Internal Server Error' }, 500, corsHeaders);
    }
  }

  // ------------------------------------------------------------------
  // DELETE /api/auth/passkey/credentials/:id
  // ------------------------------------------------------------------
  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/auth\/passkey\/credentials\/[^/]+$/)) {
    const user = await getAuthenticatedUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401, corsHeaders);

    const credentialId = url.pathname.split('/')[5];

    try {
      const deleted = await sql`
        DELETE FROM passkey_credentials
        WHERE id = ${credentialId}
          AND user_id = ${user.id}
        RETURNING id
      `;
      if (deleted.length === 0) return json({ error: 'Not found' }, 404, corsHeaders);
      return new Response(null, { status: 204, headers: corsHeaders });
    } catch (err) {
      console.error('PASSKEY CREDENTIALS DELETE ERROR:', err);
      return json({ error: 'Internal Server Error' }, 500, corsHeaders);
    }
  }

  // ------------------------------------------------------------------
  // POST /api/auth/passkey/register/begin
  // ------------------------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/api/auth/passkey/register/begin') {
    try {
      const { userId } = await req.json();

      if (!userId) {
        return json({ error: 'userId required' }, 400, corsHeaders);
      }

      // Look up the user
      const users = await sql`
        SELECT id, properties->>'username' AS username
        FROM entities
        WHERE id = ${userId} AND type = 'user'
      `;
      if (users.length === 0) {
        return json({ error: 'User not found' }, 404, corsHeaders);
      }
      const user = users[0] as { id: string; username: string };

      // Fetch existing credentials so the browser can exclude them
      const existingCreds = await sql`
        SELECT credential_id FROM passkey_credentials WHERE user_id = ${userId}
      `;
      const excludeCredentials = (existingCreds as unknown as { credential_id: string }[]).map(
        (row) => ({ id: row.credential_id }),
      );

      const { rpId } = getRpConfig(req);

      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: rpId,
        userName: user.username,
        userDisplayName: user.username,
        excludeCredentials,
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
        timeout: 60_000,
      });

      // Persist the challenge
      await sql`
        INSERT INTO passkey_challenges (user_id, challenge, type)
        VALUES (${userId}, ${options.challenge}, 'registration')
      `;

      return json(options, 200, corsHeaders);
    } catch (err) {
      console.error('PASSKEY REGISTER BEGIN ERROR:', err);
      return json({ error: 'Internal Server Error' }, 500, corsHeaders);
    }
  }

  // ------------------------------------------------------------------
  // POST /api/auth/passkey/register/complete
  // ------------------------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/api/auth/passkey/register/complete') {
    // CSRF guard: registration mutates server state by adding a new credential
    // to the authenticated user's account. An attacker could forge a cross-origin
    // POST to trick the browser into submitting an attacker-controlled attestation.
    const csrfError = verifyCsrf(req, parseCookies(req.headers.get('Cookie')));
    if (csrfError)
      return new Response(csrfError.body, {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    try {
      const { userId, response } = (await req.json()) as {
        userId: string;
        response: RegistrationResponseJSON;
      };

      if (!userId || !response) {
        return json({ error: 'userId and response required' }, 400, corsHeaders);
      }

      // Retrieve unexpired challenge for this user
      const challengeRows = await sql`
        SELECT id, challenge FROM passkey_challenges
        WHERE user_id = ${userId}
          AND type = 'registration'
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (challengeRows.length === 0) {
        return json({ error: 'No valid challenge found' }, 400, corsHeaders);
      }
      const challengeRow = challengeRows[0] as { id: string; challenge: string };

      // Delete the challenge immediately (single-use)
      await sql`DELETE FROM passkey_challenges WHERE id = ${challengeRow.id}`;

      const { rpId, origin: rpOrigin } = getRpConfig(req);

      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpId,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return json({ error: 'Registration verification failed' }, 400, corsHeaders);
      }

      const { credential, aaguid } = verification.registrationInfo;

      // Store the credential, return the persisted credential_id
      const inserted = await sql`
        INSERT INTO passkey_credentials
          (user_id, credential_id, public_key, counter, aaguid, transports)
        VALUES (
          ${userId},
          ${credential.id},
          ${Buffer.from(credential.publicKey)},
          ${credential.counter},
          ${aaguid ?? ''},
          ${credential.transports ?? []}
        )
        RETURNING credential_id
      `;
      const credentialId = (inserted[0] as { credential_id: string }).credential_id;

      return json({ verified: true, credentialId }, 200, corsHeaders);
    } catch (err) {
      console.error('PASSKEY REGISTER COMPLETE ERROR:', err);
      return json({ error: 'Internal Server Error' }, 500, corsHeaders);
    }
  }

  // ------------------------------------------------------------------
  // POST /api/auth/passkey/login/begin
  // ------------------------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/api/auth/passkey/login/begin') {
    try {
      const body = (await req.json().catch(() => ({}))) as { userId?: string };
      const userId = body.userId;

      let allowCredentials: { id: string }[] = [];

      if (userId) {
        const creds = await sql`
          SELECT credential_id FROM passkey_credentials WHERE user_id = ${userId}
        `;
        allowCredentials = (creds as unknown as { credential_id: string }[]).map((row) => ({
          id: row.credential_id,
        }));
      }

      const { rpId } = getRpConfig(req);

      const options = await generateAuthenticationOptions({
        rpID: rpId,
        allowCredentials,
        userVerification: 'preferred',
        timeout: 60_000,
      });

      // Store challenge — user_id may be null for discoverable credential flows
      await sql`
        INSERT INTO passkey_challenges (user_id, challenge, type)
        VALUES (${userId ?? null}, ${options.challenge}, 'authentication')
      `;

      return json(options, 200, corsHeaders);
    } catch (err) {
      console.error('PASSKEY LOGIN BEGIN ERROR:', err);
      return json({ error: 'Internal Server Error' }, 500, corsHeaders);
    }
  }

  // ------------------------------------------------------------------
  // POST /api/auth/passkey/login/complete
  // ------------------------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/api/auth/passkey/login/complete') {
    try {
      const { response } = (await req.json()) as { response: AuthenticationResponseJSON };

      if (!response) {
        return json({ error: 'response required' }, 400, corsHeaders);
      }

      // Look up the credential by credential ID
      const credRows = await sql`
        SELECT pc.id, pc.user_id, pc.credential_id, pc.public_key, pc.counter, pc.transports,
               e.properties->>'username' AS username
        FROM passkey_credentials pc
        JOIN entities e ON e.id = pc.user_id
        WHERE pc.credential_id = ${response.id}
        LIMIT 1
      `;
      if (credRows.length === 0) {
        return json({ error: 'Credential not found' }, 401, corsHeaders);
      }
      const cred = credRows[0] as {
        id: string;
        user_id: string;
        credential_id: string;
        public_key: Buffer;
        counter: number;
        transports: string[];
        username: string;
      };

      // Retrieve unexpired authentication challenge
      const challengeRows = await sql`
        SELECT id, challenge FROM passkey_challenges
        WHERE type = 'authentication'
          AND expires_at > NOW()
          AND (user_id = ${cred.user_id} OR user_id IS NULL)
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (challengeRows.length === 0) {
        return json({ error: 'No valid challenge found' }, 400, corsHeaders);
      }
      const challengeRow = challengeRows[0] as { id: string; challenge: string };

      // Delete challenge immediately (single-use)
      await sql`DELETE FROM passkey_challenges WHERE id = ${challengeRow.id}`;

      const { rpId, origin: rpOrigin } = getRpConfig(req);

      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpId,
        credential: {
          id: cred.credential_id,
          publicKey: new Uint8Array(cred.public_key),
          counter: cred.counter,
          transports: cred.transports as AuthenticatorTransport[],
        },
        requireUserVerification: false,
      });

      if (!verification.verified) {
        return json({ error: 'Authentication verification failed' }, 401, corsHeaders);
      }

      const newCounter = verification.authenticationInfo.newCounter;

      // Counter-based clone detection: reject if new counter ≤ stored counter
      if (newCounter <= cred.counter && newCounter !== 0) {
        return json(
          { error: 'Credential counter invalid — possible cloned authenticator' },
          401,
          corsHeaders,
        );
      }

      // Update counter and last_used_at
      await sql`
        UPDATE passkey_credentials
        SET counter = ${newCounter}, last_used_at = NOW()
        WHERE id = ${cred.id}
      `;

      // Issue JWT (same as password auth)
      const token = await signJwt({ id: cred.user_id, username: cred.username });

      return new Response(JSON.stringify({ user: { id: cred.user_id, username: cred.username } }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': `calypso_auth=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`,
        },
      });
    } catch (err) {
      console.error('PASSKEY LOGIN COMPLETE ERROR:', err);
      return json({ error: 'Internal Server Error' }, 500, corsHeaders);
    }
  }

  return null;
}

/** Convenience helper for JSON responses. */
function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
