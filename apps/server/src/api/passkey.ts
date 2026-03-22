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
import { getCorsHeaders } from './auth';
import { signJwt } from '../auth/jwt';

// The Relying Party configuration.
// RP_ID must match the effective domain of the origin.
// In development (localhost) the rpID is 'localhost'.
// For production, override via RP_ID / RP_NAME / ORIGIN env vars.
const RP_ID = process.env.RP_ID ?? 'localhost';
const RP_NAME = process.env.RP_NAME ?? 'Calypso';
const ORIGIN = process.env.ORIGIN ?? `http://localhost:5174`;

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
      const excludeCredentials = existingCreds.map((row: { credential_id: string }) => ({
        id: row.credential_id,
      }));

      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
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

      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return json({ error: 'Registration verification failed' }, 400, corsHeaders);
      }

      const { credential, aaguid } = verification.registrationInfo;

      // Store the credential
      await sql`
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
      `;

      return json({ verified: true }, 200, corsHeaders);
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
        allowCredentials = creds.map((row: { credential_id: string }) => ({
          id: row.credential_id,
        }));
      }

      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
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

      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
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
