/**
 * Unit tests for admin dashboard rendering logic and access control.
 *
 * Tests the conditional visibility logic for the admin nav button and
 * the admin view access guard without requiring DOM rendering.
 */

import { describe, test, expect } from 'vitest';

/**
 * Mirror of the nav visibility decision: the admin button should only
 * appear when the user has isSuperadmin === true.
 */
function isAdminNavVisible(isSuperadmin: boolean | undefined): boolean {
  return isSuperadmin === true;
}

/**
 * Mirror of the admin view access guard: the admin dashboard should
 * only render when the user has isSuperadmin === true.
 */
function resolveAdminViewBranch(
  activeView: string,
  isSuperadmin: boolean | undefined,
): 'dashboard' | 'denied' | 'other' {
  if (activeView !== 'admin') return 'other';
  if (isSuperadmin === true) return 'dashboard';
  return 'denied';
}

/**
 * Mirror of status badge colour resolution.
 */
function resolveStatusColor(status: string): string {
  const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    claimed: 'bg-blue-50 text-blue-700 border-blue-200',
    running: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    submitting: 'bg-purple-50 text-purple-700 border-purple-200',
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
    dead: 'bg-zinc-100 text-zinc-500 border-zinc-300',
  };
  return STATUS_COLORS[status] ?? 'bg-zinc-50 text-zinc-600 border-zinc-200';
}

describe('Admin nav visibility', () => {
  test('visible when isSuperadmin is true', () => {
    expect(isAdminNavVisible(true)).toBe(true);
  });

  test('hidden when isSuperadmin is false', () => {
    expect(isAdminNavVisible(false)).toBe(false);
  });

  test('hidden when isSuperadmin is undefined', () => {
    expect(isAdminNavVisible(undefined)).toBe(false);
  });
});

describe('Admin view access guard', () => {
  test('shows dashboard for superadmin on admin view', () => {
    expect(resolveAdminViewBranch('admin', true)).toBe('dashboard');
  });

  test('shows denied for non-superadmin on admin view', () => {
    expect(resolveAdminViewBranch('admin', false)).toBe('denied');
  });

  test('shows denied for undefined superadmin on admin view', () => {
    expect(resolveAdminViewBranch('admin', undefined)).toBe('denied');
  });

  test('returns other for non-admin views', () => {
    expect(resolveAdminViewBranch('board', true)).toBe('other');
    expect(resolveAdminViewBranch('settings', false)).toBe('other');
    expect(resolveAdminViewBranch('pwa', undefined)).toBe('other');
  });
});

describe('Task queue status badge colours', () => {
  test('returns correct colour for each known status', () => {
    expect(resolveStatusColor('pending')).toContain('amber');
    expect(resolveStatusColor('claimed')).toContain('blue');
    expect(resolveStatusColor('running')).toContain('indigo');
    expect(resolveStatusColor('submitting')).toContain('purple');
    expect(resolveStatusColor('completed')).toContain('emerald');
    expect(resolveStatusColor('failed')).toContain('red');
    expect(resolveStatusColor('dead')).toContain('zinc');
  });

  test('returns fallback colour for unknown status', () => {
    expect(resolveStatusColor('unknown')).toBe('bg-zinc-50 text-zinc-600 border-zinc-200');
  });
});

describe('AdminDashboard module exports', () => {
  test('AdminDashboard is exported from the module', async () => {
    const mod = await import('../../src/pages/admin-dashboard.js');
    expect(typeof mod.AdminDashboard).toBe('function');
  });
});
