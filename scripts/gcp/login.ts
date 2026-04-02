#!/usr/bin/env bun

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
  parseArgs,
  printHelp,
  resolveOAuthTokenFilePath,
  resolveOption,
  resolveRequiredOption,
  writeLocalOAuthCredentialFile,
} from './common';

const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const CALLBACK_PATH = '/oauth2/callback';

interface OAuthCallbackPayload {
  code?: string;
  error?: string;
  errorDescription?: string;
  state?: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

const helpText = `
Run a repository-owned local Google OAuth login flow (without gcloud), then
write refreshable token material for Calypso Google scripts.

Required:
  --client-id / GCP_OAUTH_CLIENT_ID

Optional:
  --client-secret / GCP_OAUTH_CLIENT_SECRET
  --scopes / GCP_OAUTH_SCOPES                default: cloud-platform
  --token-file / GCP_OAUTH_TOKEN_FILE        default: ~/.config/calypso/gcp-oauth-token.json
  --listen-host / GCP_OAUTH_LISTEN_HOST      default: 127.0.0.1
  --listen-port / GCP_OAUTH_LISTEN_PORT      default: 0 (ephemeral)
  --timeout-seconds / GCP_OAUTH_TIMEOUT_SECONDS default: 180
  --no-browser                               only print the authorization URL

Example:
  bun run scripts/gcp/login.ts --client-id <oauth-client-id>
`.trim();

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.flags.has('help')) {
    printHelp('scripts/gcp/login.ts', helpText);
    return;
  }

  const clientId = resolveRequiredOption(
    args,
    'client-id',
    ['GCP_OAUTH_CLIENT_ID'],
    'OAuth client ID',
  );
  const clientSecret = resolveOption(args, 'client-secret', ['GCP_OAUTH_CLIENT_SECRET']);
  const scopes = resolveOption(args, 'scopes', ['GCP_OAUTH_SCOPES'], DEFAULT_SCOPE)!;
  const tokenFile = resolveOption(
    args,
    'token-file',
    ['GCP_OAUTH_TOKEN_FILE'],
    resolveOAuthTokenFilePath(),
  )!;
  const listenHost = resolveOption(args, 'listen-host', ['GCP_OAUTH_LISTEN_HOST'], '127.0.0.1')!;
  const listenPort = Number(resolveOption(args, 'listen-port', ['GCP_OAUTH_LISTEN_PORT'], '0'));
  const timeoutSeconds = Number(
    resolveOption(args, 'timeout-seconds', ['GCP_OAUTH_TIMEOUT_SECONDS'], '180'),
  );
  const noBrowser = args.flags.has('no-browser');

  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
    throw new Error('listen-port must be an integer between 0 and 65535');
  }
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error('timeout-seconds must be a positive number');
  }

  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const state = base64Url(randomBytes(24));

  const callbackPromise = waitForOAuthCallback({
    expectedState: state,
    listenHost,
    listenPort,
    timeoutMs: timeoutSeconds * 1_000,
  });

  const { redirectUri } = await callbackPromise.started;
  const authorizationUrl = buildAuthorizationUrl({
    callbackPath: CALLBACK_PATH,
    clientId,
    codeChallenge: challenge,
    redirectUri,
    scope: scopes,
    state,
  });

  console.log('Open this URL to authorize Calypso Google Cloud access:');
  console.log(authorizationUrl);
  console.log('');

  if (!noBrowser) {
    maybeOpenBrowser(authorizationUrl);
  }

  const payload = await callbackPromise.result;
  if (!payload.code) {
    const reason = payload.errorDescription ?? payload.error ?? 'missing authorization code';
    throw new Error(`OAuth callback failed: ${reason}`);
  }

  const tokenResponse = await exchangeAuthorizationCode({
    clientId,
    clientSecret,
    code: payload.code,
    codeVerifier: verifier,
    redirectUri,
  });

  if (!tokenResponse.access_token || typeof tokenResponse.expires_in !== 'number') {
    throw new Error('OAuth token response is missing access_token or expires_in');
  }
  if (!tokenResponse.refresh_token) {
    throw new Error(
      'OAuth token response did not include refresh_token. Re-run with consent to issue offline access.',
    );
  }

  writeLocalOAuthCredentialFile(
    {
      access_token: tokenResponse.access_token,
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      expires_at_ms: Date.now() + tokenResponse.expires_in * 1_000,
      refresh_token: tokenResponse.refresh_token,
      scope: tokenResponse.scope ?? scopes,
      token_uri: 'https://oauth2.googleapis.com/token',
      type: tokenResponse.token_type ?? 'Bearer',
    },
    tokenFile,
  );

  console.log(`OAuth token cache written: ${tokenFile}`);
  console.log('Google scripts will now auto-refresh from this credential file.');
}

function buildAuthorizationUrl(params: {
  callbackPath: string;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scope: string;
  state: string;
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('state', params.state);
  return url.toString();
}

function waitForOAuthCallback(config: {
  expectedState: string;
  listenHost: string;
  listenPort: number;
  timeoutMs: number;
}): {
  started: Promise<{ callback: OAuthCallbackPayload; redirectUri: string }>;
  result: Promise<OAuthCallbackPayload>;
} {
  let resolveResult: (value: OAuthCallbackPayload) => void;
  let rejectResult: (error: Error) => void;
  const result = new Promise<OAuthCallbackPayload>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const server = createServer((req, res) => {
    handleOAuthCallbackRequest(req, res, config.expectedState, resolveResult);
  });

  const started = new Promise<{ callback: OAuthCallbackPayload; redirectUri: string }>(
    (resolve, reject) => {
      server.once('error', (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      server.listen(config.listenPort, config.listenHost, () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to resolve OAuth callback server address'));
          return;
        }
        const redirectUri = `http://${config.listenHost}:${address.port}${CALLBACK_PATH}`;
        resolve({ callback: {}, redirectUri });
      });
    },
  );

  const timeout = setTimeout(() => {
    server.close();
    rejectResult(new Error('Timed out waiting for OAuth callback'));
  }, config.timeoutMs);

  const wrappedResult = result.finally(() => {
    clearTimeout(timeout);
    server.close();
  });

  return { started, result: wrappedResult };
}

function handleOAuthCallbackRequest(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  expectedState: string,
  resolveResult: (value: OAuthCallbackPayload) => void,
): void {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  if (requestUrl.pathname !== CALLBACK_PATH) {
    respondText(res, 404, 'Not found');
    return;
  }

  const payload: OAuthCallbackPayload = {
    code: requestUrl.searchParams.get('code') ?? undefined,
    error: requestUrl.searchParams.get('error') ?? undefined,
    errorDescription: requestUrl.searchParams.get('error_description') ?? undefined,
    state: requestUrl.searchParams.get('state') ?? undefined,
  };

  if (payload.state !== expectedState) {
    respondText(res, 400, 'Invalid OAuth state');
    resolveResult({
      error: 'invalid_state',
      errorDescription: 'OAuth callback state mismatch',
    });
    return;
  }

  if (payload.error) {
    respondText(res, 400, `OAuth error: ${payload.error}`);
    resolveResult(payload);
    return;
  }

  respondText(res, 200, 'Calypso OAuth login complete. You can close this tab.');
  resolveResult(payload);
}

function respondText(res: ServerResponse<IncomingMessage>, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
}

async function exchangeAuthorizationCode(params: {
  clientId: string;
  clientSecret?: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<OAuthTokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: params.clientId,
      ...(params.clientSecret ? { client_secret: params.clientSecret } : {}),
      code: params.code,
      code_verifier: params.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed: ${bodyText}`);
  }
  return JSON.parse(bodyText) as OAuthTokenResponse;
}

function maybeOpenBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const commandResult = Bun.spawnSync([command, url], {
    stderr: 'ignore',
    stdout: 'ignore',
  });
  if (commandResult.exitCode !== 0) {
    console.log(`Unable to auto-open browser with ${command}. Open the URL manually.`);
  }
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
