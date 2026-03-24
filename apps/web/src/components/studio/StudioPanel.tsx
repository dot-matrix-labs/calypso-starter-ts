/**
 * @file StudioPanel
 *
 * Root component for the Studio browser interface. Renders the two-panel
 * layout: Claude chat sidebar on the left, Calypso app iframe on the right.
 *
 * This component owns the SSE connection to GET /studio/cluster/events and
 * distributes the current cluster status to both child panels so they can
 * react consistently to state transitions.
 *
 * Layout (from docs/studio-mode.md — "Browser Interface"):
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │  ┌─────────────────┐  ┌─────────────────────┐   │
 *   │  │  Claude Chat    │  │  Calypso App        │   │
 *   │  │  (sidebar)      │  │  (iframe)           │   │
 *   │  └─────────────────┘  └─────────────────────┘   │
 *   └──────────────────────────────────────────────────┘
 *
 * Canonical docs: docs/studio-mode.md
 */

import React, { useEffect, useState } from 'react';
import { ChatPanel } from './ChatPanel';
import { IframePanel } from './IframePanel';
import type { ClusterStatus } from './ClusterStatusIndicator';

interface StudioPanelProps {
  /** URL loaded in the app iframe; defaults to /app/ */
  appSrc?: string;
  /** SSE endpoint for cluster status events; defaults to /studio/cluster/events */
  clusterEventsUrl?: string;
  /** POST endpoint for chat; defaults to /studio/chat */
  chatEndpoint?: string;
  /** Initial cluster status (used in tests to skip SSE) */
  initialClusterStatus?: ClusterStatus;
}

/**
 * StudioPanel — two-panel Studio browser interface.
 *
 * The cluster status SSE stream is consumed here so both the ChatPanel
 * (status indicator) and IframePanel (reloading overlay) react to the same
 * authoritative state without each opening independent SSE connections.
 */
export function StudioPanel({
  appSrc = '/app/',
  clusterEventsUrl = '/studio/cluster/events',
  chatEndpoint = '/studio/chat',
  initialClusterStatus,
}: StudioPanelProps) {
  const [clusterStatus, setClusterStatus] = useState<ClusterStatus>(
    initialClusterStatus ?? 'unknown',
  );

  useEffect(() => {
    // Skip SSE when an initial status is injected (test / Storybook mode).
    if (initialClusterStatus !== undefined) return;

    const source = new EventSource(clusterEventsUrl);

    source.addEventListener('cluster-status', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data as string) as { status?: ClusterStatus };
        if (data.status && ['healthy', 'restarting', 'degraded', 'unknown'].includes(data.status)) {
          setClusterStatus(data.status);
        }
      } catch {
        // Ignore malformed events
      }
    });

    source.onerror = () => {
      setClusterStatus('unknown');
    };

    return () => {
      source.close();
    };
  }, [clusterEventsUrl, initialClusterStatus]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-zinc-900" data-testid="studio-panel">
      {/* Left panel — Claude chat sidebar (fixed width) */}
      <div className="w-80 shrink-0 flex flex-col border-r border-zinc-700">
        <ChatPanel
          clusterStatus={clusterStatus}
          chatEndpoint={chatEndpoint}
          // Pass the events URL so ClusterStatusIndicator can independently
          // subscribe — it is rendered inside ChatPanel and receives the parent's
          // derived status via statusOverride to avoid duplicate SSE connections.
          clusterEventsUrl={clusterEventsUrl}
        />
      </div>

      {/* Right panel — Calypso app iframe (fills remaining space) */}
      <div className="flex-1 flex flex-col">
        <IframePanel src={appSrc} clusterStatus={clusterStatus} />
      </div>
    </div>
  );
}
