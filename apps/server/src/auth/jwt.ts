import { isRevoked } from 'db/revocation';

// Policy note:
// This JWT helper implements ES256 (ECDSA P-256) signing using the WebCrypto API.
// The private key is loaded from the JWT_EC_PRIVATE_KEY environment variable (as a
// JWK JSON string). If absent, a fresh ephemeral key pair is generated at startup
// (suitable for dev/test). For key rotation, set JWT_EC_PRIVATE_KEY_OLD to the
// previous private key JWK; both old and new public keys are accepted during the
// transition window.
//
// The blueprint target is stricter: passkey-first auth, pinned algorithms by
// deployment, revocation checks, delegated authority for consequential actions,
// and sandbox-only credentials for digital twins.

const ENCODER = new TextEncoder();

/** Algorithm parameters for ECDSA P-256. */
const EC_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' } as const;

export interface EcKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  /** kid — key identifier, a short hex string derived from key material. */
  kid: string;
}

/** Module-level key store, initialised lazily on first use. */
let _currentKeyPair: EcKeyPair | null = null;
let _oldKeyPair: EcKeyPair | null = null;
let _keyStoreInitialised = false;

/**
 * Encodes a string or Uint8Array to a Base64 URL Safe string.
 */
export function base64UrlEncode(str: string | Uint8Array): string {
  const base64 =
    typeof str === 'string'
      ? btoa(str)
      : btoa(String.fromCharCode(...(str.length > 65536 ? Array.from(str) : str)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes a Base64 URL Safe string to a regular string.
 */
export function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

/**
 * Decodes a Base64 URL Safe string to a Uint8Array.
 */
function base64UrlDecodeBytes(str: string): Uint8Array {
  const binary = base64UrlDecode(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derives a stable short kid from a CryptoKey's JWK public material.
 */
async function deriveKid(publicKey: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  const raw = ENCODER.encode(`${jwk.x ?? ''}${jwk.y ?? ''}`);
  const digest = await crypto.subtle.digest('SHA-256', raw);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/**
 * Generates a fresh EC P-256 key pair.
 */
export async function generateEcKeyPair(): Promise<EcKeyPair> {
  const keyPair = await crypto.subtle.generateKey(EC_ALGORITHM, true, ['sign', 'verify']);
  const kid = await deriveKid(keyPair.publicKey);
  return { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey, kid };
}

/**
 * Loads an EC P-256 key pair from a JWK JSON string (private key JWK).
 * The public key is derived from the private key material.
 */
export async function loadKeyPairFromJwk(jwkJson: string): Promise<EcKeyPair> {
  const jwk = JSON.parse(jwkJson) as JsonWebKey;

  const privateKey = await crypto.subtle.importKey('jwk', jwk, EC_ALGORITHM, false, ['sign']);

  // Build the public JWK from the private JWK by stripping private fields
  const publicJwk: JsonWebKey = {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    key_ops: ['verify'],
    ext: true,
  };
  const publicKey = await crypto.subtle.importKey('jwk', publicJwk, EC_ALGORITHM, true, ['verify']);
  const kid = await deriveKid(publicKey);
  return { privateKey, publicKey, kid };
}

/**
 * Initialises the key store from environment variables or generates a fresh key pair.
 * Called lazily on first JWT operation.
 */
async function initKeyStore(): Promise<void> {
  if (_keyStoreInitialised) return;

  const privateKeyJwk = process.env.JWT_EC_PRIVATE_KEY;
  if (privateKeyJwk) {
    _currentKeyPair = await loadKeyPairFromJwk(privateKeyJwk);
  } else {
    // Dev mode: generate an ephemeral key pair
    _currentKeyPair = await generateEcKeyPair();
  }

  const oldPrivateKeyJwk = process.env.JWT_EC_PRIVATE_KEY_OLD;
  if (oldPrivateKeyJwk) {
    _oldKeyPair = await loadKeyPairFromJwk(oldPrivateKeyJwk);
  }

  _keyStoreInitialised = true;
}

/**
 * Returns the current signing key pair, initialising if necessary.
 */
async function getCurrentKeyPair(): Promise<EcKeyPair> {
  await initKeyStore();
  if (!_currentKeyPair) throw new Error('[jwt] Key store not initialised');
  return _currentKeyPair;
}

/**
 * Returns all active verification key pairs (current + optional old for rotation window).
 */
async function getVerificationKeyPairs(): Promise<EcKeyPair[]> {
  await initKeyStore();
  const pairs: EcKeyPair[] = [];
  if (_currentKeyPair) pairs.push(_currentKeyPair);
  if (_oldKeyPair) pairs.push(_oldKeyPair);
  return pairs;
}

/**
 * Returns the JWKS (JSON Web Key Set) for public key distribution.
 * Exposes the current public key (and old key during rotation window) as JWK entries.
 */
export async function getJwks(): Promise<{ keys: object[] }> {
  const pairs = await getVerificationKeyPairs();
  const keys = await Promise.all(
    pairs.map(async ({ publicKey, kid }) => {
      const jwk = await crypto.subtle.exportKey('jwk', publicKey);
      return {
        kty: jwk.kty,
        crv: jwk.crv,
        x: jwk.x,
        y: jwk.y,
        use: 'sig',
        alg: 'ES256',
        kid,
      };
    }),
  );
  return { keys };
}

/**
 * Signs a payload generating a JWT token using ES256 (ECDSA P-256) via WebCrypto.
 * A `jti` (JWT ID) claim is added automatically for revocation tracking.
 */
export async function signJwt(payload: object, expiresInHours = 24 * 7): Promise<string> {
  const keyPair = await getCurrentKeyPair();
  const header = { alg: 'ES256', typ: 'JWT', kid: keyPair.kid };
  const exp = Math.floor(Date.now() / 1000) + expiresInHours * 60 * 60;
  const jti = crypto.randomUUID();

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify({ ...payload, exp, jti }));

  const dataToSign = ENCODER.encode(`${encodedHeader}.${encodedPayload}`);
  const signatureBuffer = await crypto.subtle.sign(SIGN_ALGORITHM, keyPair.privateKey, dataToSign);
  const encodedSignature = base64UrlEncode(new Uint8Array(signatureBuffer));

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * Verifies and decodes a JWT token signed with ES256. Throws if invalid, expired, or revoked.
 * During key rotation, tokens signed with the old key are also accepted.
 */
export async function verifyJwt<T>(token: string): Promise<T> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const dataToVerify = ENCODER.encode(`${encodedHeader}.${encodedPayload}`);

  // Decode the signature bytes
  const signatureBytes = base64UrlDecodeBytes(encodedSignature);

  // Attempt verification against all active keys (current + rotation window)
  const keyPairs = await getVerificationKeyPairs();
  let verified = false;

  for (const { publicKey } of keyPairs) {
    try {
      const ok = await crypto.subtle.verify(
        SIGN_ALGORITHM,
        publicKey,
        signatureBytes,
        dataToVerify,
      );
      if (ok) {
        verified = true;
        break;
      }
    } catch {
      // Key mismatch — try next key
    }
  }

  if (!verified) {
    throw new Error('Invalid signature');
  }

  const payloadStr = base64UrlDecode(encodedPayload);
  const payload = JSON.parse(payloadStr);

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  if (payload.jti && (await isRevoked(payload.jti))) {
    throw new Error('Token revoked');
  }

  return payload as T;
}

/** Exposed for testing only — resets the key store so tests can inject keys. */
export function _resetKeyStoreForTest(): void {
  _currentKeyPair = null;
  _oldKeyPair = null;
  _keyStoreInitialised = false;
}

/** Exposed for testing only — directly seeds a key pair as current. */
export function _seedKeyPairForTest(current: EcKeyPair, old?: EcKeyPair): void {
  _currentKeyPair = current;
  _oldKeyPair = old ?? null;
  _keyStoreInitialised = true;
}
