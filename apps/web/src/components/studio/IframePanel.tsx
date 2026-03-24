/**
 * @file IframePanel
 *
 * Right panel of the Studio browser interface. Renders the Calypso app inside
 * an iframe pointing at STUDIO_PORT/app/ (proxy target is the cluster's web
 * service).
 *
 * During hot-swaps (cluster status is "restarting"), a semi-transparent overlay
 * is shown over the iframe:
 *
 *   ⟳  Reloading — cluster is restarting…
 *
 * When the cluster returns to "healthy" the overlay is cleared and the iframe
 * is reloaded automatically so the developer sees the updated application.
 *
 * Canonical docs: docs/studio-mode.md — "Browser Interface", "Hot-Swap Flow"
 */

import React, { useEffect, useRef, useState } from 'react';
import type { ClusterStatus } from './ClusterStatusIndicator';

interface IframePanelProps {
  /** URL loaded in the iframe. Defaults to /app/ (studio proxy target). */
  src?: string;
  /** Current cluster status forwarded from the parent SSE consumer. */
  clusterStatus: ClusterStatus;
}

/**
 * IframePanel renders the embedded Calypso app and manages the reloading
 * overlay lifecycle based on cluster status transitions.
 */
export function IframePanel({ src = '/app/', clusterStatus }: IframePanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const prevStatusRef = useRef<ClusterStatus>(clusterStatus);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = clusterStatus;

    if (clusterStatus === 'restarting') {
      // Show overlay when cluster begins restarting.
      setOverlayVisible(true);
    } else if (clusterStatus === 'healthy' && prev === 'restarting') {
      // Cluster returned to healthy after a restart — hide overlay and reload.
      setOverlayVisible(false);
      if (iframeRef.current) {
        iframeRef.current.src = src;
      }
    }
  }, [clusterStatus, src]);

  return (
    <div className="relative flex-1 h-full bg-zinc-950" data-testid="iframe-panel">
      <iframe
        ref={iframeRef}
        src={src}
        title="Calypso app"
        className="w-full h-full border-0"
        data-testid="app-iframe"
      />

      {/* Reloading overlay — visible during hot-swaps */}
      {overlayVisible && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm z-10"
          data-testid="reloading-overlay"
          aria-live="polite"
          aria-label="Reloading — cluster is restarting"
        >
          <div className="flex flex-col items-center gap-3 text-zinc-100">
            <svg
              className="w-8 h-8 animate-spin text-indigo-400"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            <p className="text-sm font-medium">Reloading — cluster is restarting…</p>
          </div>
        </div>
      )}
    </div>
  );
}
