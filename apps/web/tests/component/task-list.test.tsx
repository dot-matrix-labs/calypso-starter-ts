import React from 'react';
import { render } from 'vitest-browser-react';
import { commands } from '@vitest/browser/context';
import { afterEach, expect, test } from 'vitest';
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
  targetPersonId: null,
  createdAt: new Date().toISOString(),
};

async function setTasksFixture(tasks: Task[] = []) {
  await commands.setFixtureState({
    state: {
      tasks,
      persons: [],
      relationships: [],
      studioStatus: { active: false },
      studioChatResponse: { reply: '' },
    },
  });
}

afterEach(async () => {
  await commands.resetFixtureState({ fixtureId: 'default' });
});

test('renders empty state when there are no tasks', async () => {
  await setTasksFixture();
  const screen = render(<TaskListView />);
  await expect.element(screen.getByText(/No tasks yet/)).toBeVisible();
});

test('opens New Task modal when empty state button is clicked', async () => {
  await setTasksFixture();
  const screen = render(<TaskListView />);
  await screen.getByRole('button', { name: /New Task/i }).click();
  await expect.element(screen.getByRole('heading', { name: 'New Task' })).toBeVisible();
  await expect.element(screen.getByPlaceholder('Task name')).toBeVisible();
});

test('renders column headers when tasks exist', async () => {
  await setTasksFixture([MOCK_TASK]);
  const screen = render(<TaskListView />);
  // Wait for the task name to appear (confirms fetch resolved and table rendered)
  await expect.element(screen.getByRole('cell', { name: 'Fix the bug' })).toBeVisible();
  await expect.element(screen.getByText('Name')).toBeVisible();
  await expect.element(screen.getByText('Owner')).toBeVisible();
  await expect.element(screen.getByText('Priority')).toBeVisible();
  await expect.element(screen.getByText('Status')).toBeVisible();
  await expect.element(screen.getByText('Due')).toBeVisible();
  await expect.element(screen.getByText('Target Person')).toBeVisible();
});

test('renders task row with correct data', async () => {
  await setTasksFixture([MOCK_TASK]);
  const screen = render(<TaskListView />);
  await expect.element(screen.getByRole('cell', { name: 'Fix the bug' })).toBeVisible();
  await expect.element(screen.getByRole('cell', { name: 'alice' })).toBeVisible();
  // Status badge button has exact accessible name "todo" (not "Status: todo")
  await expect.element(screen.getByRole('button', { name: 'todo', exact: true })).toBeVisible();
});

test('task with targetPersonId shows person name and score in cell', async () => {
  const taskWithPerson: Task = { ...MOCK_TASK, targetPersonId: 'person-1' };
  await commands.setFixtureState({
    state: {
      tasks: [taskWithPerson],
      persons: [
        {
          id: 'person-1',
          name: 'Ana Silva',
          properties: { name: 'Ana Silva' } as Record<string, unknown>,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      relationships: [
        {
          id: 'rel-1',
          personAId: 'person-1',
          personBId: 'person-other',
          score: 4,
          reason: 'Colega de trabalho',
          createdAt: new Date().toISOString(),
        },
      ],
      studioStatus: { active: false },
      studioChatResponse: { reply: '' },
    },
  });
  const screen = render(<TaskListView />);
  await expect.element(screen.getByRole('cell', { name: 'Fix the bug' })).toBeVisible();
  await expect.element(screen.getByText('Ana Silva')).toBeVisible();
  await expect.element(screen.getByText('4/5')).toBeVisible();
});
