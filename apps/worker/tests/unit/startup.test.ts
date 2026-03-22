/**
 * Unit tests for worker startup role verification.
 *
 * Blueprint: TQ-C-008 startup-role-verification-tested
 *
 * Tests that:
 *  1. A role without INSERT privilege passes the check (read-only role)
 *  2. A role with INSERT privilege triggers process.exit(1) and logs an error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyReadOnlyRole, assertReadOnlyRole } from '../../src/startup';

function makeDb(canInsert: boolean) {
  return {
    unsafe: vi.fn().mockResolvedValue([{ can_insert: canInsert }]),
  };
}

describe('verifyReadOnlyRole', () => {
  it('returns canInsert: false for a read-only role', async () => {
    const db = makeDb(false);
    const result = await verifyReadOnlyRole(db);
    expect(result.canInsert).toBe(false);
  });

  it('returns canInsert: true when the role has INSERT privilege', async () => {
    const db = makeDb(true);
    const result = await verifyReadOnlyRole(db);
    expect(result.canInsert).toBe(true);
  });

  it('queries has_table_privilege for task_queue INSERT', async () => {
    const db = makeDb(false);
    await verifyReadOnlyRole(db);
    expect(db.unsafe).toHaveBeenCalledWith(
      expect.stringContaining("has_table_privilege(current_user, 'task_queue', 'INSERT')"),
    );
  });
});

describe('assertReadOnlyRole', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((_code: number | string | null | undefined) => {
        throw new Error(`process.exit(${_code}) called`);
      });
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('does not exit when the role is read-only', async () => {
    const db = makeDb(false);
    const logger = { error: vi.fn() };
    await assertReadOnlyRole(db, logger);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('calls process.exit(1) and logs error when role has INSERT privilege', async () => {
    const db = makeDb(true);
    const logger = { error: vi.fn() };
    await expect(assertReadOnlyRole(db, logger)).rejects.toThrow('process.exit(1) called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('INSERT on task_queue'));
  });
});
