import React, { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';

/** Polling interval in milliseconds (30 seconds). */
const POLL_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskQueueEntry {
  id: string;
  status: string;
  agent_type: string | null;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  completed_at: string | null;
}

interface AdminUser {
  id: string;
  properties: {
    username?: string;
    role?: string;
    active?: boolean;
    [key: string]: unknown;
  };
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Status badge colour map
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  claimed: 'bg-blue-50 text-blue-700 border-blue-200',
  running: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  submitting: 'bg-purple-50 text-purple-700 border-purple-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  dead: 'bg-zinc-100 text-zinc-500 border-zinc-300',
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? 'bg-zinc-50 text-zinc-600 border-zinc-200';
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${colors}`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string | null): string {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminDashboard() {
  const [tasks, setTasks] = useState<TaskQueueEntry[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [taskRes, userRes] = await Promise.all([
        fetch('/api/admin/task-queue?limit=50', { credentials: 'include' }),
        fetch('/api/admin/users?limit=50', { credentials: 'include' }),
      ]);

      if (taskRes.ok) {
        const data = await taskRes.json();
        setTasks(data.tasks ?? []);
      }
      if (userRes.ok) {
        const data = await userRes.json();
        setUsers(data.users ?? []);
      }
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Admin dashboard fetch error:', err);
    } finally {
      setLoadingTasks(false);
      setLoadingUsers(false);
    }
  }, []);

  // Initial load + polling
  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData]);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Admin Dashboard</h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            {lastRefresh ? `Last refreshed ${lastRefresh.toLocaleTimeString()}` : 'Loading...'}
          </p>
        </div>
        <button
          onClick={fetchData}
          className="px-3 py-1.5 text-xs font-medium text-zinc-600 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors flex items-center gap-1.5"
          title="Refresh now"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {/* Task Queue Panel */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3 uppercase tracking-wide">
          Task Queue
        </h2>
        <div className="border border-zinc-200 rounded-xl overflow-hidden bg-white">
          {loadingTasks ? (
            <div className="flex items-center justify-center h-24 text-zinc-400 text-sm">
              Loading task queue...
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-zinc-400 text-sm">
              No task queue entries found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Agent Type</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-zinc-50 hover:bg-zinc-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                        {t.id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-4 py-3 text-zinc-600">{t.agent_type ?? '--'}</td>
                      <td className="px-4 py-3 text-zinc-400 tabular-nums text-xs">
                        {formatTimestamp(t.created_at)}
                      </td>
                      <td className="px-4 py-3 text-zinc-400 tabular-nums text-xs">
                        {formatTimestamp(t.updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* User List Panel */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3 uppercase tracking-wide">Users</h2>
        <div className="border border-zinc-200 rounded-xl overflow-hidden bg-white">
          {loadingUsers ? (
            <div className="flex items-center justify-center h-24 text-zinc-400 text-sm">
              Loading users...
            </div>
          ) : users.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-zinc-400 text-sm">
              No users found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    <th className="px-4 py-3">Username</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-zinc-50 hover:bg-zinc-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-zinc-900">
                        {(u.properties.username as string) ?? u.id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium border capitalize bg-zinc-50 text-zinc-600 border-zinc-200">
                          {(u.properties.role as string) ?? 'user'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {u.properties.active === false ? (
                          <span className="text-xs text-red-500 font-medium">Inactive</span>
                        ) : (
                          <span className="text-xs text-emerald-600 font-medium">Active</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-400 tabular-nums text-xs">
                        {formatTimestamp(u.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
