import React from 'react';
import { render } from 'vitest-browser-react';
import { expect, test, vi, beforeEach } from 'vitest';
import { TaskListView } from '../../src/components/TaskListView';
import type { Task } from 'core';

const MOCK_TASK: Task = {
  id: 'task-1',
  name: 'Fix the bug',
  description: '',
  owner: 'alice',
  priority: 'high',
  status: 'todo',
  estimatedDeliver: null,
  estimateStart: null,
  dependsOn: [],
  tags: [],
  createdAt: new Date().toISOString(),
};

function mockFetch(tasks: Task[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        const body = JSON.parse(options.body as string);
        const created: Task = { ...MOCK_TASK, id: 'task-new', ...body, status: 'todo' };
        return { ok: true, json: async () => created };
      }
      if (options?.method === 'PATCH') {
        const body = JSON.parse(options.body as string);
        return { ok: true, json: async () => ({ ...MOCK_TASK, ...body }) };
      }
      // GET /api/tasks
      return { ok: true, json: async () => tasks };
    }),
  );
}

beforeEach(() => {
  mockFetch();
});

test('renders empty state when there are no tasks', async () => {
  const screen = render(<TaskListView />);
  await expect.element(screen.getByText(/No tasks yet/)).toBeVisible();
});

test('opens New Task modal when empty state button is clicked', async () => {
  const screen = render(<TaskListView />);
  await screen.getByRole('button', { name: /New Task/i }).click();
  await expect.element(screen.getByRole('heading', { name: 'New Task' })).toBeVisible();
  await expect.element(screen.getByPlaceholder('Task name')).toBeVisible();
});

test('renders column headers when tasks exist', async () => {
  mockFetch([MOCK_TASK]);
  const screen = render(<TaskListView />);
  // Wait for the task name to appear (confirms fetch resolved and table rendered)
  await expect.element(screen.getByRole('cell', { name: 'Fix the bug' })).toBeVisible();
  // th elements render the column headers
  await expect.element(screen.getByText('Name')).toBeVisible();
  await expect.element(screen.getByText('Owner')).toBeVisible();
  await expect.element(screen.getByText('Priority')).toBeVisible();
  await expect.element(screen.getByText('Status')).toBeVisible();
  await expect.element(screen.getByText('Due')).toBeVisible();
});

test('renders task row with correct data', async () => {
  mockFetch([MOCK_TASK]);
  const screen = render(<TaskListView />);
  await expect.element(screen.getByRole('cell', { name: 'Fix the bug' })).toBeVisible();
  await expect.element(screen.getByRole('cell', { name: 'alice' })).toBeVisible();
  // Status badge button has exact accessible name "todo" (not "Status: todo")
  await expect.element(screen.getByRole('button', { name: 'todo', exact: true })).toBeVisible();
});
