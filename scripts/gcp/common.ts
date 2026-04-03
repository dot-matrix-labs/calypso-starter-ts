#!/usr/bin/env bun

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { createHash, createSign } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const textDecoder = new TextDecoder();
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

interface GoogleApiOptions {
  allow404?: boolean;
}

type CloudProviderHttpMode = 'live' | 'record' | 'replay';

interface CommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string;
  allowFailure?: boolean;
}

interface ServiceAccountKey {
  type?: string;
  project_id?: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
}

interface CredentialDescriptor {
  key?: ServiceAccountKey;
  source: string;
  oauth?: LocalOAuthCredential;
  type: 'service-account-json' | 'access-token' | 'oauth-token-file';
}

interface LocalOAuthCredential {
  access_token?: string;
  client_id: string;
  client_secret?: string;
  expires_at_ms?: number;
  refresh_token: string;
  scope?: string;
  token_uri?: string;
  type?: string;
}

export interface ParsedArgs {
  flags: Map<string, string | boolean>;
  positionals: string[];
}

export interface TempFile {
  path: string;
  cleanup: () => void;
}

export interface SshAuthMaterial {
  mode: 'agent' | 'key-file';
  privateKeyPath?: string;
  cleanup: () => void;
}

export interface GoogleCredentialInfo {
  principal?: string;
  projectId?: string;
  source: string;
  type: 'service-account-json' | 'access-token' | 'oauth-token-file';
}

export interface ComputeOperation {
  selfLink?: string;
  status?: string;
  error?: { errors?: Array<{ message?: string }> };
}

export interface LongRunningOperation {
  name?: string;
  done?: boolean;
  error?: { code?: number; message?: string };
}

interface RecordedHttpFixture {
  request: RecordedHttpRequest;
  response: RecordedHttpResponse;
}

interface RecordedHttpRequest {
  body?: JsonValue | string;
  headers: Record<string, string>;
  method: string;
  url: string;
}

interface RecordedHttpResponse {
  body: JsonValue | string | null;
  headers: Record<string, string>;
  status: number;
  statusText: string;
}

interface ReplayFixtureState {
  fixtures: RecordedHttpFixture[];
  nextIndex: number;
}

let cachedToken: CachedToken | null = null;
const replayFixtureStates = new Map<string, ReplayFixtureState>();

export function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) {
      positionals.push(raw);
      continue;
    }

    const trimmed = raw.slice(2);
    if (trimmed.includes('=')) {
      const [name, ...parts] = trimmed.split('=');
      flags.set(name, parts.join('='));
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags.set(trimmed, true);
      continue;
    }

    flags.set(trimmed, next);
    index += 1;
  }

  return { flags, positionals };
}

export function getFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

export function resolveOption(
  args: ParsedArgs,
  flagName: string,
  envNames: string[],
  fallback?: string,
): string | undefined {
  const fromFlag = getFlag(args, flagName);
  if (fromFlag) return fromFlag;
  for (const envName of envNames) {
    const value = process.env[envName];
    if (value) return value;
  }
  return fallback;
}

export function resolveRequiredOption(
  args: ParsedArgs,
  flagName: string,
  envNames: string[],
  label: string,
  fallback?: string,
): string {
  const value = resolveOption(args, flagName, envNames, fallback);
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
}

export function resolveBooleanOption(
  args: ParsedArgs,
  flagName: string,
  envNames: string[],
  fallback: boolean,
): boolean {
  if (hasFlag(args, flagName)) return true;
  const fromFlag = getFlag(args, flagName);
  if (fromFlag) return parseBoolean(fromFlag, flagName);
  for (const envName of envNames) {
    const value = process.env[envName];
    if (value) return parseBoolean(value, envName);
  }
  return fallback;
}

export function parseBoolean(value: string, label: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  throw new Error(`${label} must be a boolean value`);
}

export function requireCommands(names: string[]): void {
  for (const name of names) {
    const result = nodeSpawnSync('which', [name], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    if (result.status !== 0) {
      throw new Error(`Missing required command: ${name}`);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export function runCommand(
  command: string[],
  options: CommandOptions = {},
): { stdout: string; stderr: string; exitCode: number } {
  const result = nodeSpawnSync(command[0], command.slice(1), {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    input: options.stdin,
    stdio: [options.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });

  const stdout = decodeOutput(result.stdout);
  const stderr = decodeOutput(result.stderr);
  const exitCode = result.status ?? 0;

  if (exitCode !== 0 && !options.allowFailure) {
    const commandLabel = command.join(' ');
    const detail = stderr || stdout || `exit code ${exitCode}`;
    throw new Error(`Command failed: ${commandLabel}\n${detail}`);
  }

  return { stdout, stderr, exitCode };
}

async function performGoogleHttpRequest(url: string, init: RequestInit = {}): Promise<Response> {
  const normalizedRequest = normalizeRecordedRequest(url, init);
  const mode = resolveCloudProviderHttpMode();
  if (mode === 'replay') {
    return replayGoogleHttpFixture(normalizedRequest);
  }

  const response = await fetch(url, init);
  if (mode === 'record') {
    await recordGoogleHttpFixture(normalizedRequest, response.clone());
  }
  return response;
}

export async function googleJsonRequest<T>(
  url: string,
  init: RequestInit = {},
  options: GoogleApiOptions = {},
): Promise<T | null> {
  const accessToken = await getGoogleAccessToken();
  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', `Bearer ${accessToken}`);

  const isJsonBody =
    init.body !== undefined &&
    init.body !== null &&
    typeof init.body === 'string' &&
    !headers.has('Content-Type');
  if (isJsonBody) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await performGoogleHttpRequest(url, {
    ...init,
    headers,
  });

  if (options.allow404 && response.status === 404) {
    return null;
  }

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Google API request failed (${response.status} ${response.statusText}): ${bodyText}`,
    );
  }

  if (!bodyText) {
    return null;
  }

  return JSON.parse(bodyText) as T;
}

export async function getGoogleAccessToken(): Promise<string> {
  if (process.env.GCP_ACCESS_TOKEN) {
    return process.env.GCP_ACCESS_TOKEN;
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs - now > 60_000) {
    return cachedToken.accessToken;
  }

  const descriptor = resolveCredentialDescriptor();
  if (descriptor.type === 'oauth-token-file') {
    const oauth = descriptor.oauth;
    if (!oauth) {
      throw new Error(
        `OAuth token file source ${descriptor.source} did not include token material`,
      );
    }

    if (oauth.access_token && oauth.expires_at_ms && oauth.expires_at_ms - now > 60_000) {
      cachedToken = {
        accessToken: oauth.access_token,
        expiresAtMs: oauth.expires_at_ms,
      };
      return oauth.access_token;
    }

    const tokenUri = oauth.token_uri ?? 'https://oauth2.googleapis.com/token';
    const response = await performGoogleHttpRequest(tokenUri, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: oauth.client_id,
        ...(oauth.client_secret ? { client_secret: oauth.client_secret } : {}),
        refresh_token: oauth.refresh_token,
      }),
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Failed to refresh OAuth access token from ${descriptor.source}: ${bodyText}`,
      );
    }

    const refreshed = JSON.parse(bodyText) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      scope?: string;
      token_type?: string;
    };
    if (!refreshed.access_token || typeof refreshed.expires_in !== 'number') {
      throw new Error(
        `OAuth refresh response from ${descriptor.source} is missing access_token or expires_in`,
      );
    }

    const expiresAtMs = now + refreshed.expires_in * 1_000;
    const updatedCredential: LocalOAuthCredential = {
      ...oauth,
      access_token: refreshed.access_token,
      expires_at_ms: expiresAtMs,
      refresh_token: refreshed.refresh_token ?? oauth.refresh_token,
      scope: refreshed.scope ?? oauth.scope,
      type: refreshed.token_type ?? oauth.type,
      token_uri: tokenUri,
    };
    persistLocalOAuthCredential(updatedCredential, descriptor.source);

    cachedToken = {
      accessToken: refreshed.access_token,
      expiresAtMs,
    };
    return refreshed.access_token;
  }

  const { key } = descriptor;
  if (!key) {
    throw new Error('No service account key is available for OAuth token minting');
  }
  const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const assertion = createSignedJwt(key, tokenUri);

  const response = await performGoogleHttpRequest(tokenUri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to mint Google access token: ${bodyText}`);
  }

  const json = JSON.parse(bodyText) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: json.access_token,
    expiresAtMs: now + json.expires_in * 1_000,
  };
  return json.access_token;
}

export function getGoogleCredentialInfo(): GoogleCredentialInfo {
  const descriptor = resolveCredentialDescriptor();
  if (descriptor.type === 'access-token') {
    return {
      source: descriptor.source,
      type: descriptor.type,
    };
  }

  return {
    principal: descriptor.key?.client_email,
    projectId: descriptor.key?.project_id,
    source: descriptor.source,
    type: descriptor.type,
  };
}

export async function waitForGoogleOperation(
  description: string,
  pollUrl: string,
  timeoutMs = 15 * 60_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const operation = (await googleJsonRequest<JsonValue>(pollUrl)) as
      | ComputeOperation
      | LongRunningOperation
      | null;
    if (!operation) {
      throw new Error(`Operation poll returned no payload for ${description}`);
    }

    const errorMessage = extractOperationError(operation);
    if (errorMessage) {
      throw new Error(`${description} failed: ${errorMessage}`);
    }

    if (operationIsDone(operation)) {
      return;
    }

    await sleep(3_000);
  }

  throw new Error(`Timed out waiting for ${description}`);
}

export function extractNatIp(instance: {
  networkInterfaces?: Array<{ accessConfigs?: Array<{ natIP?: string }> }>;
}): string | undefined {
  return instance.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP;
}

export function createTempFile(prefix: string, contents: string, mode = 0o600): TempFile {
  const dir = mkdtempSync(join(tmpdir(), 'calypso-gcp-'));
  const path = join(dir, prefix);
  writeFileSync(path, contents, { mode });
  chmodSync(path, mode);
  return {
    path,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function ensureSshAuthMaterial(): SshAuthMaterial {
  if (process.env.SSH_AUTH_SOCK) {
    const listedKeys = runCommand(['ssh-add', '-L'], { allowFailure: true });
    if (listedKeys.exitCode !== 0 || !listedKeys.stdout.trim()) {
      throw new Error(
        'SSH_AUTH_SOCK is set but ssh-agent does not expose any loaded identities. Load a key with ssh-add first.',
      );
    }
    return {
      mode: 'agent',
      cleanup: () => {},
    };
  }

  const fromFile = process.env.CALYPSO_SSH_PRIVATE_KEY_FILE;
  if (fromFile) {
    if (!existsSync(fromFile)) {
      throw new Error(`CALYPSO_SSH_PRIVATE_KEY_FILE does not exist: ${fromFile}`);
    }
    return {
      mode: 'key-file',
      privateKeyPath: fromFile,
      cleanup: () => {},
    };
  }

  throw new Error(
    'SSH authentication requires either an agent identity via SSH_AUTH_SOCK or CALYPSO_SSH_PRIVATE_KEY_FILE as a local fallback',
  );
}

export function derivePublicKey(privateKeyPath: string): string {
  const { stdout } = runCommand(['ssh-keygen', '-y', '-f', privateKeyPath]);
  return stdout.trim();
}

export function resolveAdminPublicKey(sshAuth: SshAuthMaterial): string {
  const fromFile = process.env.CALYPSO_SSH_PUBLIC_KEY_FILE;
  if (fromFile) {
    if (!existsSync(fromFile)) {
      throw new Error(`CALYPSO_SSH_PUBLIC_KEY_FILE does not exist: ${fromFile}`);
    }
    return readFileSync(fromFile, 'utf8').trim();
  }

  if (sshAuth.mode === 'agent') {
    const { stdout } = runCommand(['ssh-add', '-L']);
    const firstKey = stdout
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('The agent has no identities'));
    if (!firstKey) {
      throw new Error('ssh-agent does not expose a usable public key');
    }
    return firstKey;
  }

  if (!sshAuth.privateKeyPath) {
    throw new Error('Unable to resolve an SSH public key from the current auth material');
  }
  return derivePublicKey(sshAuth.privateKeyPath);
}

export function buildSshOptions(sshAuth: SshAuthMaterial): string[] {
  const command = ['ssh'];
  if (sshAuth.privateKeyPath) {
    command.push('-i', sshAuth.privateKeyPath);
  }
  command.push('-o', 'StrictHostKeyChecking=accept-new');
  return command;
}

export function sshTarget(sshUser: string, hostIp: string): string {
  return `${sshUser}@${hostIp}`;
}

export function shellQuote(value: string): string {
  return `'${value.split("'").join(`'"'"'`)}'`;
}

export async function waitForTcpPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host, port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (reachable) return;
    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for TCP ${host}:${port}`);
}

export async function getProjectNumber(projectId: string): Promise<string> {
  const project = await googleJsonRequest<{ projectNumber?: string }>(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`,
  );
  if (!project?.projectNumber) {
    throw new Error(`Unable to resolve project number for ${projectId}`);
  }
  return project.projectNumber;
}

export function computeGlobalOperationUrl(projectId: string, name: string): string {
  return `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/operations/${name}`;
}

export function computeRegionalOperationUrl(
  projectId: string,
  region: string,
  name: string,
): string {
  return `https://compute.googleapis.com/compute/v1/projects/${projectId}/regions/${region}/operations/${name}`;
}

export function computeZonalOperationUrl(projectId: string, zone: string, name: string): string {
  return `https://compute.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/operations/${name}`;
}

export function operationPollUrl(
  operation: ComputeOperation | LongRunningOperation,
  fallbackBase?: string,
): string {
  if ('selfLink' in operation && operation.selfLink) {
    return operation.selfLink;
  }
  if ('name' in operation && operation.name) {
    return fallbackBase ? `${fallbackBase}/${operation.name}` : operation.name;
  }
  throw new Error('Operation payload does not include a pollable URL');
}

export function printHelp(title: string, body: string): void {
  console.log(`${title}\n\n${body}`.trim());
}

function decodeOutput(value: ArrayBufferLike | Uint8Array | null | undefined): string {
  if (!value) return '';
  const uint8Array = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBufferLike);
  return textDecoder.decode(uint8Array).trim();
}

function resolveCredentialDescriptor(): CredentialDescriptor {
  if (process.env.GCP_ACCESS_TOKEN) {
    return {
      source: 'GCP_ACCESS_TOKEN',
      type: 'access-token',
    };
  }

  const oauthFilePath = resolveOAuthTokenFilePath();
  if (existsSync(oauthFilePath)) {
    const rawCredential = readFileSync(oauthFilePath, 'utf8');
    return {
      oauth: parseLocalOAuthCredential(rawCredential, oauthFilePath),
      source: oauthFilePath,
      type: 'oauth-token-file',
    };
  }

  const inlineJsonEnvs = ['GCP_SERVICE_ACCOUNT_JSON', 'GCP_SERVICE_ACCOUNT_KEY_JSON'];
  for (const envName of inlineJsonEnvs) {
    const value = process.env[envName];
    if (!value) continue;
    return {
      key: parseServiceAccountKey(value, envName),
      source: envName,
      type: 'service-account-json',
    };
  }

  const filePathEnvs = [
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GCP_SERVICE_ACCOUNT_FILE',
    'GCP_SERVICE_ACCOUNT_KEY_FILE',
  ];
  for (const envName of filePathEnvs) {
    const value = process.env[envName];
    if (!value) continue;
    return {
      key: parseServiceAccountKey(readFileSync(value, 'utf8'), envName),
      source: envName,
      type: 'service-account-json',
    };
  }

  throw new Error(
    `Google credentials are required via GCP_ACCESS_TOKEN, ${resolveOAuthTokenFilePath()}, GCP_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS, GCP_SERVICE_ACCOUNT_FILE, GCP_SERVICE_ACCOUNT_KEY_JSON, or GCP_SERVICE_ACCOUNT_KEY_FILE`,
  );
}

function parseServiceAccountKey(rawJson: string, source: string): ServiceAccountKey {
  let parsed: ServiceAccountKey;
  try {
    parsed = JSON.parse(rawJson) as ServiceAccountKey;
  } catch (error) {
    throw new Error(
      `Failed to parse service account JSON from ${source}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {
        cause: error,
      },
    );
  }

  if (parsed.type && parsed.type !== 'service_account') {
    throw new Error(
      `Credential from ${source} is type "${parsed.type}", but this tool expects a service account JSON key`,
    );
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      `Credential from ${source} is missing client_email or private_key and is not a valid service account JSON key`,
    );
  }
  return parsed;
}

function parseLocalOAuthCredential(rawJson: string, source: string): LocalOAuthCredential {
  let parsed: LocalOAuthCredential;
  try {
    parsed = JSON.parse(rawJson) as LocalOAuthCredential;
  } catch (error) {
    throw new Error(
      `Failed to parse local OAuth token JSON from ${source}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {
        cause: error,
      },
    );
  }

  if (!parsed.client_id || !parsed.refresh_token) {
    throw new Error(
      `Credential from ${source} is missing client_id or refresh_token and is not a valid local OAuth token record`,
    );
  }
  if (parsed.expires_at_ms !== undefined && !Number.isFinite(parsed.expires_at_ms)) {
    throw new Error(`Credential from ${source} has invalid expires_at_ms`);
  }
  return parsed;
}

export function resolveOAuthTokenFilePath(): string {
  const fromEnv = process.env.GCP_OAUTH_TOKEN_FILE;
  if (fromEnv) {
    return fromEnv;
  }
  return join(homedir(), '.config', 'calypso', 'gcp-oauth-token.json');
}

export function writeLocalOAuthCredentialFile(
  credential: LocalOAuthCredential,
  filePath = resolveOAuthTokenFilePath(),
): void {
  persistLocalOAuthCredential(credential, filePath);
}

function persistLocalOAuthCredential(credential: LocalOAuthCredential, filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const body = `${JSON.stringify(credential, null, 2)}\n`;
  writeFileSync(filePath, body, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

export function clearGoogleAccessTokenCache(): void {
  cachedToken = null;
}

export function clearGoogleHttpFixtureState(): void {
  replayFixtureStates.clear();
}

function createSignedJwt(key: ServiceAccountKey, tokenUri: string): string {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: key.client_email,
    scope: CLOUD_PLATFORM_SCOPE,
    aud: tokenUri,
    exp: issuedAt + 3_600,
    iat: issuedAt,
  };

  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(key.private_key);
  return `${signingInput}.${base64Url(signature)}`;
}

function base64Url(value: string | Uint8Array): string {
  const buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function resolveCloudProviderHttpMode(): CloudProviderHttpMode {
  const rawMode = process.env.CALYPSO_CLOUD_PROVIDER_HTTP_MODE?.trim().toLowerCase();
  if (!rawMode) {
    return 'live';
  }
  if (rawMode === 'live' || rawMode === 'record' || rawMode === 'replay') {
    return rawMode;
  }
  throw new Error(
    `CALYPSO_CLOUD_PROVIDER_HTTP_MODE must be one of live, record, or replay; received "${rawMode}"`,
  );
}

function resolveCloudProviderFixtureDir(): string {
  const fixtureDir = process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR;
  if (!fixtureDir) {
    throw new Error(
      'CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR is required when cloud-provider HTTP mode is record or replay',
    );
  }
  return fixtureDir;
}

function normalizeRecordedRequest(url: string, init: RequestInit): RecordedHttpRequest {
  const headers = new Headers(init.headers ?? {});
  const method = (init.method ?? 'GET').toUpperCase();
  return {
    body: normalizeRecordedBody(readRequestBody(init.body), headers.get('Content-Type')),
    headers: normalizeRecordedHeaders(headers),
    method,
    url: normalizeRecordedUrl(url),
  };
}

async function recordGoogleHttpFixture(
  request: RecordedHttpRequest,
  response: Response,
): Promise<void> {
  const fixtureDir = resolveCloudProviderFixtureDir();
  mkdirSync(fixtureDir, { recursive: true });

  const responseBodyText = await response.text();
  const fixture: RecordedHttpFixture = {
    request,
    response: {
      body: normalizeRecordedBody(responseBodyText, response.headers.get('Content-Type')) ?? null,
      headers: normalizeRecordedHeaders(response.headers),
      status: response.status,
      statusText: response.statusText,
    },
  };

  const nextIndex =
    readdirSync(fixtureDir, { withFileTypes: true }).filter((entry) => entry.isFile()).length + 1;
  const filePath = join(fixtureDir, buildFixtureFilename(nextIndex, request));
  writeFileSync(filePath, `${JSON.stringify(fixture, null, 2)}\n`);
}

function replayGoogleHttpFixture(request: RecordedHttpRequest): Response {
  const fixtureDir = resolveCloudProviderFixtureDir();
  const state = loadReplayFixtureState(fixtureDir);
  if (state.nextIndex >= state.fixtures.length) {
    throw new Error(
      `No replay fixture remains for ${request.method} ${request.url} in ${fixtureDir}`,
    );
  }

  const expected = state.fixtures[state.nextIndex];
  if (!recordedRequestsEqual(expected.request, request)) {
    throw new Error(
      [
        `Unexpected provider request at replay index ${state.nextIndex + 1} in ${fixtureDir}`,
        `Expected: ${expected.request.method} ${expected.request.url}`,
        `Received: ${request.method} ${request.url}`,
      ].join('\n'),
    );
  }

  state.nextIndex += 1;
  return new Response(serializeRecordedBody(expected.response.body), {
    headers: expected.response.headers,
    status: expected.response.status,
    statusText: expected.response.statusText,
  });
}

function loadReplayFixtureState(fixtureDir: string): ReplayFixtureState {
  const existing = replayFixtureStates.get(fixtureDir);
  if (existing) {
    return existing;
  }

  const fixtureFiles = listFixtureFiles(fixtureDir);
  if (fixtureFiles.length === 0) {
    throw new Error(`No replay fixtures were found in ${fixtureDir}`);
  }

  const state: ReplayFixtureState = {
    fixtures: fixtureFiles.map(
      (filePath) => JSON.parse(readFileSync(filePath, 'utf8')) as RecordedHttpFixture,
    ),
    nextIndex: 0,
  };
  replayFixtureStates.set(fixtureDir, state);
  return state;
}

function listFixtureFiles(fixtureDir: string): string[] {
  if (!existsSync(fixtureDir)) {
    throw new Error(`Replay fixture directory does not exist: ${fixtureDir}`);
  }

  const filePaths: string[] = [];
  const walk = (currentDir: string): void => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.json')) {
        filePaths.push(entryPath);
      }
    }
  };
  walk(fixtureDir);
  filePaths.sort();
  return filePaths;
}

function buildFixtureFilename(index: number, request: RecordedHttpRequest): string {
  const url = new URL(request.url);
  const hostSlug = slugifyForFixture(url.hostname);
  const pathSlug = slugifyForFixture(url.pathname === '/' ? 'root' : url.pathname);
  const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 10);
  return `${String(index).padStart(4, '0')}-${request.method.toLowerCase()}-${hostSlug}-${pathSlug}-${hash}.json`;
}

function slugifyForFixture(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeRecordedUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const entries = Array.from(url.searchParams.entries()).sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey === bKey) {
      return aValue.localeCompare(bValue);
    }
    return aKey.localeCompare(bKey);
  });
  url.search = '';
  for (const [key, value] of entries) {
    url.searchParams.append(key, value);
  }
  url.hash = '';
  return url.toString();
}

function normalizeRecordedHeaders(headersInit: Headers | HeadersInit): Record<string, string> {
  const headers = headersInit instanceof Headers ? headersInit : new Headers(headersInit);
  const normalizedEntries = Array.from(headers.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => [name.toLowerCase(), sanitizeScalarValue(value, name)] as const);

  return Object.fromEntries(normalizedEntries);
}

function readRequestBody(body: RequestInit['body']): string | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body).toString('utf8');
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8');
  }
  return String(body);
}

function normalizeRecordedBody(
  bodyText: string | undefined,
  contentType: string | null,
): JsonValue | string | undefined {
  if (!bodyText) {
    return undefined;
  }

  const normalizedContentType = contentType?.toLowerCase() ?? '';
  if (normalizedContentType.includes('application/json')) {
    try {
      return sanitizeJsonValue(sortJsonValue(JSON.parse(bodyText) as JsonValue));
    } catch {
      return sanitizeScalarValue(bodyText);
    }
  }

  if (normalizedContentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(bodyText);
    const entries = Array.from(params.entries()).sort(([aKey, aValue], [bKey, bValue]) => {
      if (aKey === bKey) {
        return aValue.localeCompare(bValue);
      }
      return aKey.localeCompare(bKey);
    });
    const normalized: Record<string, JsonValue> = {};
    for (const [key, value] of entries) {
      const sanitizedValue = sanitizeScalarValue(value, key);
      const current = normalized[key];
      if (current === undefined) {
        normalized[key] = sanitizedValue;
        continue;
      }
      if (Array.isArray(current)) {
        current.push(sanitizedValue);
        continue;
      }
      normalized[key] = [current, sanitizedValue];
    }
    return normalized;
  }

  return sanitizeScalarValue(bodyText);
}

function sortJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    ) as JsonValue;
  }
  return value;
}

function sanitizeJsonValue(value: JsonValue, key?: string): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonValue(entry, key));
  }
  if (value && typeof value === 'object') {
    const sanitized: Record<string, JsonValue> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      sanitized[entryKey] = sanitizeJsonValue(entryValue, entryKey);
    }
    return sanitized;
  }
  if (typeof value === 'string') {
    return sanitizeScalarValue(value, key);
  }
  return value;
}

function sanitizeScalarValue(value: string, key?: string): string {
  const normalizedKey = key?.trim().toLowerCase();
  if (normalizedKey === 'authorization') {
    return '<redacted-authorization>';
  }
  if (normalizedKey === 'assertion') {
    return '<redacted-jwt>';
  }
  if (normalizedKey === 'access_token') {
    return '<redacted-access-token>';
  }
  if (normalizedKey === 'refresh_token') {
    return '<redacted-refresh-token>';
  }
  if (normalizedKey === 'client_secret') {
    return '<redacted-client-secret>';
  }
  if (normalizedKey === 'private_key') {
    return '<redacted-private-key>';
  }
  if (normalizedKey === 'password') {
    return '<redacted-password>';
  }
  if (normalizedKey === 'ipaddress' || normalizedKey === 'natip') {
    return '<redacted-ip>';
  }
  if (normalizedKey === 'client_email') {
    return '<redacted-email>';
  }
  return value;
}

function recordedRequestsEqual(left: RecordedHttpRequest, right: RecordedHttpRequest): boolean {
  const normalize = (value: RecordedHttpRequest) => ({
    body:
      value.body && typeof value.body === 'object'
        ? sortJsonValue(value.body as JsonValue)
        : (value.body ?? null),
    method: value.method,
    url: value.url,
  });
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function serializeRecordedBody(body: RecordedHttpResponse['body']): string | undefined {
  if (body === null) {
    return undefined;
  }
  if (typeof body === 'string') {
    return body;
  }
  return JSON.stringify(body);
}

function operationIsDone(operation: ComputeOperation | LongRunningOperation): boolean {
  if ('done' in operation && typeof operation.done === 'boolean') {
    return operation.done;
  }
  if ('status' in operation && typeof operation.status === 'string') {
    return operation.status === 'DONE';
  }
  return false;
}

function extractOperationError(
  operation: ComputeOperation | LongRunningOperation,
): string | undefined {
  if ('error' in operation && operation.error) {
    if ('message' in operation.error && operation.error.message) {
      return operation.error.message;
    }
    if ('errors' in operation.error && Array.isArray(operation.error.errors)) {
      return operation.error.errors
        .map((entry) => entry.message)
        .filter(Boolean)
        .join('; ');
    }
    return JSON.stringify(operation.error);
  }
  return undefined;
}
