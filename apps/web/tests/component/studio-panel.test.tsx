/**
 * Component tests for the Studio browser interface.
 *
 * Covers:
 *  - ChatPanel renders user messages and streamed responses
 *  - IframePanel shows reloading overlay when cluster status is restarting
 *  - IframePanel overlay clears when cluster returns to healthy
 *  - ClusterStatusIndicator reflects the status passed via prop
 *
 * All tests use the fixture server via `setFixtureState` for API stubs.
 * SSE connections from ClusterStatusIndicator are bypassed via `statusOverride`.
 */

import React from 'react';
import { render } from 'vitest-browser-react';
import { commands } from '@vitest/browser/context';
import { afterEach, expect, test, vi } from 'vitest';
import { ChatPanel } from '../../src/components/studio/ChatPanel';
import { IframePanel } from '../../src/components/studio/IframePanel';
import { ClusterStatusIndicator } from '../../src/components/studio/ClusterStatusIndicator';
import { StudioPanel } from '../../src/components/studio/StudioPanel';

// Use a dedicated fixtureId to avoid state collisions when task-list.test.tsx
// runs concurrently and resets the 'default' fixture store entry.
const FIXTURE_ID = 'studio-panel';

afterEach(async () => {
  await commands.resetFixtureState({ fixtureId: FIXTURE_ID });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// ChatPanel tests
// ---------------------------------------------------------------------------

test('chat panel renders empty state initially', async () => {
  const screen = render(<ChatPanel clusterStatus="healthy" chatEndpoint="/studio/chat" />);
  await expect.element(screen.getByTestId('chat-panel')).toBeVisible();
  await expect.element(screen.getByTestId('chat-messages')).toBeVisible();
  await expect.element(screen.getByText(/Send a message to Claude/)).toBeVisible();
});

test('chat panel renders user messages and assistant responses', async () => {
  await commands.setFixtureState({
    fixtureId: FIXTURE_ID,
    state: {
      studioChatResponse: { reply: 'I can help with that!' },
      studioStatus: { active: false },
    },
  });

  const screen = render(
    <ChatPanel clusterStatus="healthy" chatEndpoint={`/studio/chat?fixtureId=${FIXTURE_ID}`} />,
  );

  await screen.getByTestId('chat-input').fill('Fix the bug');
  await screen.getByTestId('chat-submit').click();

  // User message renders synchronously
  await expect.element(screen.getByText('Fix the bug')).toBeVisible();
  // Assistant response renders after the async fetch — isolated from concurrent tests
  await expect.element(screen.getByText('I can help with that!')).toBeVisible();
});

// ---------------------------------------------------------------------------
// IframePanel tests
// ---------------------------------------------------------------------------

test('iframe panel renders the app iframe', async () => {
  const screen = render(<IframePanel src="/app/" clusterStatus="healthy" />);
  await expect.element(screen.getByTestId('iframe-panel')).toBeVisible();
  const iframe = screen.getByTestId('app-iframe');
  await expect.element(iframe).toBeVisible();
});

test('reloading overlay appears when cluster status is restarting', async () => {
  const screen = render(<IframePanel src="/app/" clusterStatus="restarting" />);
  await expect.element(screen.getByTestId('reloading-overlay')).toBeVisible();
  await expect.element(screen.getByText(/Reloading — cluster is restarting/)).toBeVisible();
});

test('reloading overlay is absent when cluster status is healthy', async () => {
  const screen = render(<IframePanel src="/app/" clusterStatus="healthy" />);
  // Overlay should not be present (iframe panel is visible but no overlay)
  await expect.element(screen.getByTestId('iframe-panel')).toBeVisible();
  await expect.element(screen.getByTestId('app-iframe')).toBeVisible();
  // No overlay element in the DOM
  const overlay = screen.container.querySelector('[data-testid="reloading-overlay"]');
  expect(overlay).toBeNull();
});

test('reloading overlay clears when cluster returns to healthy', async () => {
  // Start restarting — overlay visible
  const { rerender, container } = render(<IframePanel src="/app/" clusterStatus="restarting" />);
  const overlayInitial = container.querySelector('[data-testid="reloading-overlay"]');
  expect(overlayInitial).not.toBeNull();

  // Transition to healthy — overlay should disappear
  rerender(<IframePanel src="/app/" clusterStatus="healthy" />);
  const overlayAfter = container.querySelector('[data-testid="reloading-overlay"]');
  expect(overlayAfter).toBeNull();
});

// ---------------------------------------------------------------------------
// ClusterStatusIndicator tests
// ---------------------------------------------------------------------------

test('cluster status indicator reflects healthy status', async () => {
  const screen = render(<ClusterStatusIndicator statusOverride="healthy" />);
  await expect.element(screen.getByTestId('cluster-status-indicator')).toBeVisible();
  await expect.element(screen.getByText('Cluster healthy')).toBeVisible();
});

test('cluster status indicator reflects restarting status', async () => {
  const screen = render(<ClusterStatusIndicator statusOverride="restarting" />);
  await expect.element(screen.getByText('Cluster restarting')).toBeVisible();
});

test('cluster status indicator reflects degraded status', async () => {
  const screen = render(<ClusterStatusIndicator statusOverride="degraded" />);
  await expect.element(screen.getByText('Cluster degraded')).toBeVisible();
});

test('cluster status indicator reflects unknown status', async () => {
  const screen = render(<ClusterStatusIndicator statusOverride="unknown" />);
  await expect.element(screen.getByText('Cluster status unknown')).toBeVisible();
});

// ---------------------------------------------------------------------------
// StudioPanel integration test
// ---------------------------------------------------------------------------

test('studio panel renders chat sidebar and iframe', async () => {
  const screen = render(
    <StudioPanel appSrc="/app/" initialClusterStatus="healthy" chatEndpoint="/studio/chat" />,
  );
  await expect.element(screen.getByTestId('studio-panel')).toBeVisible();
  await expect.element(screen.getByTestId('chat-panel')).toBeVisible();
  await expect.element(screen.getByTestId('iframe-panel')).toBeVisible();
  await expect.element(screen.getByTestId('app-iframe')).toBeVisible();
});

test('studio panel shows cluster status indicator in chat panel', async () => {
  const screen = render(
    <StudioPanel appSrc="/app/" initialClusterStatus="healthy" chatEndpoint="/studio/chat" />,
  );
  await expect.element(screen.getByTestId('cluster-status-indicator')).toBeVisible();
  await expect.element(screen.getByText('Cluster healthy')).toBeVisible();
});

test('studio panel shows reloading overlay when cluster is restarting', async () => {
  const screen = render(
    <StudioPanel appSrc="/app/" initialClusterStatus="restarting" chatEndpoint="/studio/chat" />,
  );
  await expect.element(screen.getByTestId('reloading-overlay')).toBeVisible();
});
