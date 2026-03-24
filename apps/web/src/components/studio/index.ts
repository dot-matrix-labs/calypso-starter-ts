/**
 * Studio browser interface components.
 *
 * Entry points for the two-panel Studio Mode UI:
 *  - StudioPanel: root layout component (chat sidebar + iframe)
 *  - ChatPanel: Claude chat with SSE streaming
 *  - IframePanel: Calypso app iframe with reloading overlay
 *  - ClusterStatusIndicator: persistent cluster health badge
 *
 * Canonical docs: docs/studio-mode.md
 */

export { StudioPanel } from './StudioPanel';
export { ChatPanel } from './ChatPanel';
export { IframePanel } from './IframePanel';
export { ClusterStatusIndicator } from './ClusterStatusIndicator';
export type { ClusterStatus } from './ClusterStatusIndicator';
export type { ChatMessage } from './ChatPanel';
