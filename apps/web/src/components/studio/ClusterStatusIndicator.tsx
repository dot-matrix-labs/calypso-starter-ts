/**
 * @file ClusterStatusIndicator
 *
 * Displays a persistent cluster health indicator in the Studio chat panel.
 * Connects to the SSE stream at GET /studio/cluster/events and reflects the
 * current cluster state: healthy, restarting, or degraded.
 *
 * Canonical docs: docs/studio-mode.md — "Cluster Status Stream"
 */

import React, { useEffect, useState } from 'react';

export type ClusterStatus = 'healthy' | 'restarting' | 'degraded' | 'unknown';

interface ClusterStatusEvent {
  status: ClusterStatus;
}

interface ClusterStatusIndicatorProps {
  /** Override status for testing without SSE (skips SSE connection when set) */
  statusOverride?: ClusterStatus;
  /** SSE endpoint; defaults to /studio/cluster/events */
  eventsUrl?: string;
}

const STATUS_CONFIG: Record<ClusterStatus, { label: string; dotClass: string; textClass: string }> =
  {
    healthy: {
      label: 'Cluster healthy',
      dotClass: 'bg-emerald-400',
      textClass: 'text-emerald-700',
    },
    restarting: {
      label: 'Cluster restarting',
      dotClass: 'bg-amber-400 animate-pulse',
      textClass: 'text-amber-700',
    },
    degraded: {
      label: 'Cluster degraded',
      dotClass: 'bg-red-400',
      textClass: 'text-red-700',
    },
    unknown: {
      label: 'Cluster status unknown',
      dotClass: 'bg-zinc-300',
      textClass: 'text-zinc-500',
    },
  };

/**
 * ClusterStatusIndicator — reads SSE events from /studio/cluster/events and
 * renders a dot + label showing healthy, restarting, or degraded.
 */
export function ClusterStatusIndicator({
  statusOverride,
  eventsUrl = '/studio/cluster/events',
}: ClusterStatusIndicatorProps) {
  const [status, setStatus] = useState<ClusterStatus>(statusOverride ?? 'unknown');

  useEffect(() => {
    // When a status override is provided (e.g. in tests), skip the SSE connection.
    if (statusOverride !== undefined) {
      setStatus(statusOverride);
      return;
    }

    const source = new EventSource(eventsUrl);

    source.addEventListener('cluster-status', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data as string) as ClusterStatusEvent;
        if (data.status && data.status in STATUS_CONFIG) {
          setStatus(data.status);
        }
      } catch {
        // Ignore malformed events
      }
    });

    source.onerror = () => {
      setStatus('unknown');
    };

    return () => {
      source.close();
    };
  }, [eventsUrl, statusOverride]);

  const config = STATUS_CONFIG[status];

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-50 border border-zinc-200"
      aria-label={`Cluster status: ${status}`}
      data-testid="cluster-status-indicator"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${config.dotClass}`} aria-hidden="true" />
      <span className={`text-xs font-medium ${config.textClass}`}>{config.label}</span>
    </div>
  );
}
