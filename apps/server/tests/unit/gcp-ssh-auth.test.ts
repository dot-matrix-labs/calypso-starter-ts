import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  buildSshOptions,
  ensureSshAuthMaterial,
  resolveAdminPublicKey,
  sshTarget,
} from '../../../../scripts/gcp/common';

const ENV_KEYS = [
  'CALYPSO_SSH_PRIVATE_KEY_FILE',
  'CALYPSO_SSH_PUBLIC_KEY_FILE',
  'SSH_AGENT_PID',
  'SSH_AUTH_SOCK',
];

describe('Google SSH auth resolution', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'calypso-gcp-ssh-auth-'));
  });

  afterEach(() => {
    if (process.env.SSH_AGENT_PID) {
      Bun.spawnSync(['ssh-agent', '-k'], {
        env: {
          ...process.env,
        },
        stderr: 'ignore',
        stdout: 'ignore',
      });
    }

    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('uses key-file fallback when no ssh-agent is available', () => {
    const keyPath = generateKeyPair(tempDir, 'fallback');
    process.env.CALYPSO_SSH_PRIVATE_KEY_FILE = keyPath;

    const sshAuth = ensureSshAuthMaterial();

    expect(sshAuth.mode).toBe('key-file');
    expect(sshAuth.privateKeyPath).toBe(keyPath);
    expect(resolveAdminPublicKey(sshAuth)).toBe(readFileSync(`${keyPath}.pub`, 'utf8').trim());
    expect(buildSshOptions(sshAuth)).toEqual([
      'ssh',
      '-i',
      keyPath,
      '-o',
      'StrictHostKeyChecking=accept-new',
    ]);
    expect(sshTarget('superfield', '203.0.113.10')).toBe('superfield@203.0.113.10');
  });

  test('prefers ambient ssh-agent identities', () => {
    const keyPath = generateKeyPair(tempDir, 'agent');
    const agentEnv = startAgent();
    process.env.SSH_AUTH_SOCK = agentEnv.SSH_AUTH_SOCK;
    process.env.SSH_AGENT_PID = agentEnv.SSH_AGENT_PID;

    const addResult = Bun.spawnSync(['ssh-add', keyPath], {
      env: {
        ...process.env,
      },
      stderr: 'pipe',
      stdout: 'pipe',
    });
    expect(addResult.exitCode).toBe(0);

    const sshAuth = ensureSshAuthMaterial();
    const listed = Bun.spawnSync(['ssh-add', '-L'], {
      env: {
        ...process.env,
      },
      stderr: 'pipe',
      stdout: 'pipe',
    });

    expect(sshAuth.mode).toBe('agent');
    expect(sshAuth.privateKeyPath).toBeUndefined();
    expect(resolveAdminPublicKey(sshAuth)).toBe(decode(listed.stdout).split('\n')[0].trim());
    expect(buildSshOptions(sshAuth)).toEqual(['ssh', '-o', 'StrictHostKeyChecking=accept-new']);
  });
});

function generateKeyPair(directory: string, name: string): string {
  const keyPath = join(directory, name);
  const result = Bun.spawnSync(['ssh-keygen', '-q', '-N', '', '-t', 'ed25519', '-f', keyPath], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  expect(result.exitCode).toBe(0);
  return keyPath;
}

function startAgent(): { SSH_AGENT_PID: string; SSH_AUTH_SOCK: string } {
  const result = Bun.spawnSync(['ssh-agent', '-s'], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  expect(result.exitCode).toBe(0);
  const output = decode(result.stdout);
  const authSock = output.match(/SSH_AUTH_SOCK=([^;]+)/)?.[1];
  const agentPid = output.match(/SSH_AGENT_PID=([^;]+)/)?.[1];
  expect(authSock).toBeTruthy();
  expect(agentPid).toBeTruthy();
  return {
    SSH_AGENT_PID: agentPid!,
    SSH_AUTH_SOCK: authSock!,
  };
}

function decode(value: ArrayBufferLike | Uint8Array | null | undefined): string {
  if (!value) return '';
  const array = value instanceof Uint8Array ? value : new Uint8Array(value);
  return new TextDecoder().decode(array);
}
