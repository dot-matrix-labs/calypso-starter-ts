/**
 * CSRF double-submit cookie protection.
 *
 * On login/register the server mints a random 32-byte hex token and sends it
 * back in a readable (HttpOnly=false) `__Host-csrf-token` cookie. Browser JS
 * must echo that value in the `X-CSRF-Token` request header for every
 * state-mutating method. Because a cross-origin attacker cannot read the
 * cookie (same-origin policy), they cannot forge the header even though the
 * browser auto-sends the cookie.
 *
 * Safe methods (GET, HEAD, OPTIONS) are not checked.
 * `CSRF_DISABLED=true` bypasses the check — use only in test environments or
 * for API-key-authenticated routes.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_COOKIE_NAME = '__Host-csrf-token';

/**
 * Generate a random 32-byte hex CSRF token.
 */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build the `Set-Cookie` header value for the CSRF token cookie.
 * HttpOnly is intentionally omitted (defaults to false) so browser JS can
 * read the value and include it in the X-CSRF-Token header.
 */
export function csrfCookieHeader(token: string): string {
  return `${CSRF_COOKIE_NAME}=${token}; SameSite=Strict; Secure; Path=/`;
}

/**
 * Verify CSRF protection for a request.
 *
 * Returns a 403 Response when the check fails, or null when the request is
 * allowed to proceed.
 */
export function verifyCsrf(req: Request, cookies: Record<string, string>): Response | null {
  if (process.env.CSRF_DISABLED === 'true') return null;
  if (SAFE_METHODS.has(req.method)) return null;

  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers.get('X-CSRF-Token');

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return new Response(JSON.stringify({ error: 'CSRF token mismatch' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}
