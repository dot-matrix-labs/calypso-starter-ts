import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  clearGoogleAccessTokenCache,
  clearGoogleHttpFixtureState,
  createTempFile,
  extractNatIp,
  operationPollUrl,
  parseArgs,
  parseBoolean,
  requireCommands,
  resolveBooleanOption,
  resolveOption,
  resolveRequiredOption,
  runCommand,
  shellQuote,
  waitForGoogleOperation,
  waitForTcpPort,
  type ComputeOperation,
  type LongRunningOperation,
  type ParsedArgs,
} from '../../../../scripts/gcp/common';

const FIXTURE_BASE = join(process.cwd(), 'tests', 'fixtures', 'cloud-providers', 'gcp');

describe('parseArgs', () => {
  test('parses positional arguments', () => {
    const result = parseArgs(['foo', 'bar']);
    expect(result.positionals).toEqual(['foo', 'bar']);
    expect(result.flags.size).toBe(0);
  });

  test('parses --key value pairs', () => {
    const result = parseArgs(['--project', 'my-proj', '--zone', 'us-central1-a']);
    expect(result.flags.get('project')).toBe('my-proj');
    expect(result.flags.get('zone')).toBe('us-central1-a');
    expect(result.positionals).toEqual([]);
  });

  test('parses --key=value syntax', () => {
    const result = parseArgs(['--project=my-proj', '--zone=us-central1-a']);
    expect(result.flags.get('project')).toBe('my-proj');
    expect(result.flags.get('zone')).toBe('us-central1-a');
  });

  test('parses bare flags as boolean true', () => {
    const result = parseArgs(['--check-only', '--verbose']);
    expect(result.flags.get('check-only')).toBe(true);
    expect(result.flags.get('verbose')).toBe(true);
  });

  test('handles mixed positionals, flags, and key-value pairs', () => {
    const result = parseArgs(['pos1', '--flag', '--key', 'val', 'pos2']);
    expect(result.positionals).toEqual(['pos1', 'pos2']);
    expect(result.flags.get('flag')).toBe(true);
    expect(result.flags.get('key')).toBe('val');
  });

  test('handles --key=value with equals in value', () => {
    const result = parseArgs(['--tag=a=b=c']);
    expect(result.flags.get('tag')).toBe('a=b=c');
  });

  test('adjacent flags without values are both boolean', () => {
    const result = parseArgs(['--alpha', '--beta']);
    expect(result.flags.get('alpha')).toBe(true);
    expect(result.flags.get('beta')).toBe(true);
  });
});

describe('parseBoolean', () => {
  test.each(['1', 'true', 'True', 'TRUE', 'yes', 'YES', 'y', 'Y', 'on', 'ON'])(
    'parses "%s" as true',
    (value) => {
      expect(parseBoolean(value, 'test')).toBe(true);
    },
  );

  test.each(['0', 'false', 'False', 'FALSE', 'no', 'NO', 'n', 'N', 'off', 'OFF'])(
    'parses "%s" as false',
    (value) => {
      expect(parseBoolean(value, 'test')).toBe(false);
    },
  );

  test('throws on invalid boolean value', () => {
    expect(() => parseBoolean('maybe', 'test-flag')).toThrow('test-flag must be a boolean value');
  });

  test('trims whitespace before parsing', () => {
    expect(parseBoolean('  true  ', 'test')).toBe(true);
  });
});

describe('resolveOption', () => {
  const makeArgs = (flags: Record<string, string | boolean> = {}): ParsedArgs => ({
    flags: new Map(Object.entries(flags)),
    positionals: [],
  });

  afterEach(() => {
    delete process.env.TEST_RESOLVE_OPT;
  });

  test('returns flag value when present', () => {
    expect(resolveOption(makeArgs({ project: 'from-flag' }), 'project', ['TEST_RESOLVE_OPT'])).toBe(
      'from-flag',
    );
  });

  test('falls back to environment variable', () => {
    process.env.TEST_RESOLVE_OPT = 'from-env';
    expect(resolveOption(makeArgs(), 'project', ['TEST_RESOLVE_OPT'])).toBe('from-env');
  });

  test('falls back to default value', () => {
    expect(resolveOption(makeArgs(), 'project', ['TEST_RESOLVE_OPT'], 'default-val')).toBe(
      'default-val',
    );
  });

  test('returns undefined when nothing matches and no fallback', () => {
    expect(resolveOption(makeArgs(), 'project', ['TEST_RESOLVE_OPT'])).toBeUndefined();
  });
});

describe('resolveRequiredOption', () => {
  const makeArgs = (flags: Record<string, string | boolean> = {}): ParsedArgs => ({
    flags: new Map(Object.entries(flags)),
    positionals: [],
  });

  test('returns value when present', () => {
    expect(resolveRequiredOption(makeArgs({ project: 'val' }), 'project', [], 'GCP project')).toBe(
      'val',
    );
  });

  test('throws when value is missing', () => {
    expect(() => resolveRequiredOption(makeArgs(), 'project', [], 'GCP project')).toThrow(
      'GCP project is required',
    );
  });
});

describe('resolveBooleanOption', () => {
  const makeArgs = (flags: Record<string, string | boolean> = {}): ParsedArgs => ({
    flags: new Map(Object.entries(flags)),
    positionals: [],
  });

  afterEach(() => {
    delete process.env.TEST_BOOL_OPT;
  });

  test('returns true for bare flag', () => {
    expect(resolveBooleanOption(makeArgs({ 'check-only': true }), 'check-only', [], false)).toBe(
      true,
    );
  });

  test('parses string flag value', () => {
    expect(resolveBooleanOption(makeArgs({ 'check-only': 'false' }), 'check-only', [], true)).toBe(
      false,
    );
  });

  test('reads from environment variable', () => {
    process.env.TEST_BOOL_OPT = '1';
    expect(resolveBooleanOption(makeArgs(), 'check-only', ['TEST_BOOL_OPT'], false)).toBe(true);
  });

  test('returns fallback when nothing matches', () => {
    expect(resolveBooleanOption(makeArgs(), 'check-only', ['TEST_BOOL_OPT'], true)).toBe(true);
  });
});

describe('shellQuote', () => {
  test('wraps value in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'");
  });

  test('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe(`'it'"'"'s'`);
  });

  test('handles empty string', () => {
    expect(shellQuote('')).toBe("''");
  });
});

describe('extractNatIp', () => {
  test('extracts IP from valid instance', () => {
    const instance = {
      networkInterfaces: [{ accessConfigs: [{ natIP: '34.56.78.90' }] }],
    };
    expect(extractNatIp(instance)).toBe('34.56.78.90');
  });

  test('returns undefined when no network interfaces', () => {
    expect(extractNatIp({})).toBeUndefined();
    expect(extractNatIp({ networkInterfaces: [] })).toBeUndefined();
  });

  test('returns undefined when no access configs', () => {
    const instance = { networkInterfaces: [{}] };
    expect(extractNatIp(instance)).toBeUndefined();
  });

  test('returns undefined when natIP is missing', () => {
    const instance = { networkInterfaces: [{ accessConfigs: [{}] }] };
    expect(extractNatIp(instance)).toBeUndefined();
  });
});

describe('operationPollUrl', () => {
  test('returns selfLink for compute operations', () => {
    const op: ComputeOperation = {
      selfLink: 'https://compute.googleapis.com/compute/v1/projects/proj/global/operations/op-1',
    };
    expect(operationPollUrl(op)).toBe(op.selfLink);
  });

  test('returns fallbackBase + name for long-running operations', () => {
    const op: LongRunningOperation = { name: 'operations/op-2' };
    expect(operationPollUrl(op, 'https://alloydb.googleapis.com/v1')).toBe(
      'https://alloydb.googleapis.com/v1/operations/op-2',
    );
  });

  test('returns name alone when no fallbackBase', () => {
    const op: LongRunningOperation = { name: 'operations/op-3' };
    expect(operationPollUrl(op)).toBe('operations/op-3');
  });

  test('throws when no pollable URL is present', () => {
    expect(() => operationPollUrl({} as ComputeOperation)).toThrow(
      'Operation payload does not include a pollable URL',
    );
  });
});

describe('createTempFile', () => {
  let tempFile: ReturnType<typeof createTempFile> | null = null;

  afterEach(() => {
    tempFile?.cleanup();
    tempFile = null;
  });

  test('creates a file with given contents and returns path', () => {
    tempFile = createTempFile('test-prefix', 'hello world');
    expect(existsSync(tempFile.path)).toBe(true);
    expect(readFileSync(tempFile.path, 'utf8')).toBe('hello world');
    expect(tempFile.path).toContain('test-prefix');
  });

  test('cleanup removes the file and directory', () => {
    tempFile = createTempFile('cleanup-test', 'data');
    const path = tempFile.path;
    tempFile.cleanup();
    tempFile = null;
    expect(existsSync(path)).toBe(false);
  });
});

describe('requireCommands', () => {
  test('succeeds for commands that exist on the system', () => {
    expect(() => requireCommands(['sh'])).not.toThrow();
  });

  test('throws when a command is missing', () => {
    expect(() => requireCommands(['nonexistent-cmd-xyzzy-12345'])).toThrow(
      'Missing required command: nonexistent-cmd-xyzzy-12345',
    );
  });
});

describe('runCommand', () => {
  test('returns stdout from a real command', () => {
    const result = runCommand(['echo', 'hello']);
    expect(result.stdout).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  test('throws on non-zero exit code by default', () => {
    expect(() => runCommand(['sh', '-c', 'exit 1'])).toThrow('Command failed');
  });

  test('allows failure when allowFailure is true', () => {
    const result = runCommand(['sh', '-c', 'exit 42'], { allowFailure: true });
    expect(result.exitCode).toBe(42);
  });

  test('captures stderr output', () => {
    const result = runCommand(['sh', '-c', 'echo err >&2; exit 1'], { allowFailure: true });
    expect(result.stderr).toBe('err');
  });
});

describe('waitForGoogleOperation (fixture replay)', () => {
  beforeEach(() => {
    clearGoogleAccessTokenCache();
    clearGoogleHttpFixtureState();
    process.env.GCP_ACCESS_TOKEN = 'test-token';
    process.env.CALYPSO_CLOUD_PROVIDER_HTTP_MODE = 'replay';
  });

  afterEach(() => {
    delete process.env.GCP_ACCESS_TOKEN;
    delete process.env.CALYPSO_CLOUD_PROVIDER_HTTP_MODE;
    delete process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR;
    clearGoogleAccessTokenCache();
    clearGoogleHttpFixtureState();
  });

  test('resolves when operation is immediately done (compute style)', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'wait-op-done');
    await expect(
      waitForGoogleOperation(
        'test op',
        'https://compute.googleapis.com/compute/v1/projects/test-project/global/operations/op-done',
      ),
    ).resolves.toBeUndefined();
  });

  test('polls until operation completes', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'wait-op-poll');
    await expect(
      waitForGoogleOperation(
        'test op',
        'https://compute.googleapis.com/compute/v1/projects/test-project/global/operations/op-poll',
      ),
    ).resolves.toBeUndefined();
  });

  test('throws when operation returns a compute-style error', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'operation-error');
    await expect(
      waitForGoogleOperation(
        'create vm',
        'https://compute.googleapis.com/compute/v1/projects/test-project/global/operations/op-error',
      ),
    ).rejects.toThrow('create vm failed: QUOTA_EXCEEDED: Insufficient quota');
  });

  test('throws when operation returns an LRO-style error', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'wait-op-error');
    await expect(
      waitForGoogleOperation(
        'enable api',
        'https://compute.googleapis.com/compute/v1/projects/test-project/global/operations/op-lro-error',
      ),
    ).rejects.toThrow('enable api failed: Permission denied');
  });

  test('throws when poll returns empty payload', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'wait-op-null');
    await expect(
      waitForGoogleOperation(
        'test op',
        'https://compute.googleapis.com/compute/v1/projects/test-project/global/operations/op-null',
      ),
    ).rejects.toThrow('Operation poll returned no payload');
  });
});

describe('waitForTcpPort', () => {
  test('resolves immediately when port is reachable', async () => {
    const { createServer } = await import('node:net');
    const server = createServer();

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address() as { port: number };

    try {
      await expect(waitForTcpPort('127.0.0.1', address.port, 5_000)).resolves.toBeUndefined();
    } finally {
      server.close();
    }
  });
});
