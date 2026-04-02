#!/usr/bin/env bun

import { createSign } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  type: 'service-account-json' | 'access-token';
}

export interface ParsedArgs {
  flags: Map<string, string | boolean>;
  positionals: string[];
}

export interface TempFile {
  path: string;
  cleanup: () => void;
}

export interface GoogleCredentialInfo {
  principal?: string;
  projectId?: string;
  source: string;
  type: 'service-account-json' | 'access-token';
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

let cachedToken: CachedToken | null = null;

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
    const result = Bun.spawnSync(['which', name], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    if (result.exitCode !== 0) {
      throw new Error(`Missing required command: ${name}`);
    }
  }
}

export function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export function runCommand(
  command: string[],
  options: CommandOptions = {},
): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(command, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdin: options.stdin ? new TextEncoder().encode(options.stdin) : undefined,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = decodeOutput(result.stdout);
  const stderr = decodeOutput(result.stderr);
  const exitCode = result.exitCode ?? 0;

  if (exitCode !== 0 && !options.allowFailure) {
    const commandLabel = command.join(' ');
    const detail = stderr || stdout || `exit code ${exitCode}`;
    throw new Error(`Command failed: ${commandLabel}\n${detail}`);
  }

  return { stdout, stderr, exitCode };
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

  const response = await fetch(url, {
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

  const { key } = resolveCredentialDescriptor();
  if (!key) {
    throw new Error('No service account key is available for OAuth token minting');
  }
  const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const assertion = createSignedJwt(key, tokenUri);

  const response = await fetch(tokenUri, {
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

    await Bun.sleep(3_000);
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

export function ensurePrivateKeyFile(): TempFile {
  const fromFile = process.env.CALYPSO_SSH_PRIVATE_KEY_FILE;
  if (fromFile) {
    if (!existsSync(fromFile)) {
      throw new Error(`CALYPSO_SSH_PRIVATE_KEY_FILE does not exist: ${fromFile}`);
    }
    return { path: fromFile, cleanup: () => {} };
  }

  const fromEnv = process.env.CALYPSO_SSH_PRIVATE_KEY;
  if (!fromEnv) {
    throw new Error(
      'A private SSH key is required via CALYPSO_SSH_PRIVATE_KEY or CALYPSO_SSH_PRIVATE_KEY_FILE',
    );
  }

  return createTempFile('id_ed25519', fromEnv.endsWith('\n') ? fromEnv : `${fromEnv}\n`);
}

export function derivePublicKey(privateKeyPath: string): string {
  const { stdout } = runCommand(['ssh-keygen', '-y', '-f', privateKeyPath]);
  return stdout.trim();
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
    await Bun.sleep(2_000);
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
    'Google credentials are required via GCP_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS, GCP_SERVICE_ACCOUNT_FILE, GCP_SERVICE_ACCOUNT_KEY_JSON, GCP_SERVICE_ACCOUNT_KEY_FILE, or GCP_ACCESS_TOKEN',
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
