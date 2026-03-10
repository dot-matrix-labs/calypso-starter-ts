import React, { useEffect, useState } from 'react';
import type { Task, TaskStatus, TaskPriority } from 'core';
import { Plus, Circle, CircleDot, CircleCheck } from 'lucide-react';

const STATUS_CYCLE: TaskStatus[] = ['todo', 'in_progress', 'done'];
const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'text-zinc-400',
  medium: 'text-amber-500',
  high: 'text-red-500',
};

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === 'done') return <CircleCheck size={16} className="text-emerald-500" />;
  if (status === 'in_progress') return <CircleDot size={16} className="text-indigo-500" />;
  return <Circle size={16} className="text-zinc-300" />;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface NewTaskForm {
  name: string;
  owner: string;
  priority: TaskPriority;
  estimatedDeliver: string;
}

const EMPTY_FORM: NewTaskForm = { name: '', owner: '', priority: 'medium', estimatedDeliver: '' };

export function TaskListView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<NewTaskForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/tasks', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: Task[]) => setTasks(data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const open = () => setShowModal(true);
    window.addEventListener('calypso:new-task', open);
    return () => window.removeEventListener('calypso:new-task', open);
  }, []);

  async function cycleStatus(task: Task) {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(task.status) + 1) % STATUS_CYCLE.length];
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) {
      const updated: Task = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    }
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    const res = await fetch('/api/tasks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        estimatedDeliver: form.estimatedDeliver || null,
      }),
    });
    if (res.ok) {
      const created: Task = await res.json();
      setTasks((prev) => [created, ...prev]);
      setShowModal(false);
      setForm(EMPTY_FORM);
    }
    setSaving(false);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-zinc-400 text-sm">
            Loading tasks…
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <p className="text-zinc-400 text-sm mb-4">No tasks yet. Create one to get started.</p>
            <button
              onClick={() => setShowModal(true)}
              className="px-4 py-2 bg-zinc-900 text-white text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors flex items-center gap-2"
            >
              <Plus size={14} /> New Task
            </button>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400">
                <th className="w-8 px-4 py-3" />
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Due</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr
                  key={task.id}
                  className="border-b border-zinc-50 hover:bg-zinc-50 transition-colors group"
                >
                  <td className="px-4 py-3">
                    <button
                      onClick={() => cycleStatus(task)}
                      className="flex items-center justify-center hover:scale-110 transition-transform"
                      title={`Status: ${task.status}`}
                    >
                      <StatusIcon status={task.status} />
                    </button>
                  </td>
                  <td className="px-4 py-3 font-medium text-zinc-900">
                    <span className={task.status === 'done' ? 'line-through text-zinc-400' : ''}>
                      {task.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{task.owner || '—'}</td>
                  <td
                    className={`px-4 py-3 font-medium capitalize ${PRIORITY_COLORS[task.priority]}`}
                  >
                    {task.priority}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => cycleStatus(task)}
                      className="px-2 py-0.5 rounded-full text-xs font-medium capitalize border transition-colors
                        data-[status=todo]:border-zinc-200 data-[status=todo]:text-zinc-500
                        data-[status=in_progress]:border-indigo-200 data-[status=in_progress]:text-indigo-600 data-[status=in_progress]:bg-indigo-50
                        data-[status=done]:border-emerald-200 data-[status=done]:text-emerald-600 data-[status=done]:bg-emerald-50"
                      data-status={task.status}
                    >
                      {task.status.replace('_', ' ')}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-zinc-400 tabular-nums">
                    {formatDate(task.estimatedDeliver)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* New Task Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 border border-zinc-200">
            <h2 className="text-lg font-bold mb-4 text-zinc-900">New Task</h2>
            <form onSubmit={createTask} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                  Name *
                </label>
                <input
                  autoFocus
                  required
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Task name"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                    Owner
                  </label>
                  <input
                    type="text"
                    value={form.owner}
                    onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Username"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                    Priority
                  </label>
                  <select
                    value={form.priority}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))
                    }
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                  Due Date
                </label>
                <input
                  type="date"
                  value={form.estimatedDeliver}
                  onChange={(e) => setForm((f) => ({ ...f, estimatedDeliver: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setForm(EMPTY_FORM);
                  }}
                  className="px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-zinc-900 text-white text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Creating…' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
