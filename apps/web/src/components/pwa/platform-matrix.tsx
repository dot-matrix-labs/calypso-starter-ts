/**
 * @file platform-matrix.tsx
 *
 * Platform capability matrix for the PWA demo page.
 *
 * Renders a responsive table showing which PWA features are supported across
 * the four reference platforms: Android Chrome, iOS Safari (browser tab),
 * iOS Safari (standalone PWA), and Desktop Chrome.
 *
 * The matrix data is static (defined as a typed constant) — it reflects
 * documented behaviour rather than runtime detection. The current user's
 * platform column is visually highlighted using `usePlatform()`.
 *
 * On mobile the table is collapsible (collapsed by default; expanded on
 * desktop via a media-query-derived default). Users can toggle visibility
 * via a "View platform support" button.
 *
 * Support levels
 * ---------------
 * - full    → green badge, no caveat
 * - partial → amber badge + short caveat string
 * - none    → red badge + short caveat string
 *
 * Canonical docs
 * ---------------
 * - PWA overview: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps
 */

import React, { useState } from 'react';
import { usePlatform } from '../../hooks/use-platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SupportLevel = 'full' | 'partial' | 'none';

interface CellData {
  level: SupportLevel;
  /** Short caveat shown for partial/none cells */
  caveat?: string;
}

interface FeatureRow {
  feature: string;
  /** Column order: android, ios-browser, ios-standalone, desktop */
  android: CellData;
  iosBrowser: CellData;
  iosStandalone: CellData;
  desktop: CellData;
}

// ---------------------------------------------------------------------------
// Static capability data
// ---------------------------------------------------------------------------

const CAPABILITY_ROWS: FeatureRow[] = [
  {
    feature: 'Install prompt',
    android: { level: 'full' },
    iosBrowser: { level: 'partial', caveat: 'Manual: Share → Add to Home Screen' },
    iosStandalone: { level: 'none', caveat: 'Already installed' },
    desktop: { level: 'full' },
  },
  {
    feature: 'Service worker',
    android: { level: 'full' },
    iosBrowser: { level: 'full' },
    iosStandalone: { level: 'full' },
    desktop: { level: 'full' },
  },
  {
    feature: 'Local storage',
    android: { level: 'full' },
    iosBrowser: { level: 'partial', caveat: 'Cleared after 7 days of inactivity' },
    iosStandalone: { level: 'full' },
    desktop: { level: 'full' },
  },
  {
    feature: 'Camera',
    android: { level: 'full' },
    iosBrowser: { level: 'full' },
    iosStandalone: { level: 'partial', caveat: 'getUserMedia unreliable; file input used' },
    desktop: { level: 'full' },
  },
  {
    feature: 'Microphone',
    android: { level: 'full' },
    iosBrowser: { level: 'full' },
    iosStandalone: { level: 'full' },
    desktop: { level: 'full' },
  },
  {
    feature: 'Notifications',
    android: { level: 'full' },
    iosBrowser: { level: 'none', caveat: 'Requires standalone mode' },
    iosStandalone: { level: 'partial', caveat: 'Requires iOS 16.4+' },
    desktop: { level: 'full' },
  },
  {
    feature: 'Storage quota',
    android: { level: 'full' },
    iosBrowser: { level: 'partial', caveat: 'Available on iOS 17+' },
    iosStandalone: { level: 'partial', caveat: 'Available on iOS 17+' },
    desktop: { level: 'full' },
  },
  {
    feature: 'Offline support',
    android: { level: 'full' },
    iosBrowser: { level: 'full' },
    iosStandalone: { level: 'full' },
    desktop: { level: 'full' },
  },
];

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: 'android', label: 'Android Chrome' },
  { key: 'iosBrowser', label: 'iOS Safari (browser)' },
  { key: 'iosStandalone', label: 'iOS Safari (PWA)' },
  { key: 'desktop', label: 'Desktop Chrome' },
] as const;

type ColumnKey = (typeof COLUMNS)[number]['key'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchColumn(os: string, isStandalone: boolean): ColumnKey | null {
  if (os === 'android') return 'android';
  if (os === 'ios' && !isStandalone) return 'iosBrowser';
  if (os === 'ios' && isStandalone) return 'iosStandalone';
  if (os === 'windows' || os === 'macos' || os === 'linux') return 'desktop';
  return null;
}

const LEVEL_CLASSES: Record<SupportLevel, string> = {
  full: 'bg-green-100 text-green-800',
  partial: 'bg-amber-100 text-amber-800',
  none: 'bg-red-100 text-red-800',
};

const LEVEL_LABELS: Record<SupportLevel, string> = {
  full: 'Full',
  partial: 'Partial',
  none: 'None',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SupportBadge({ cell }: { cell: CellData }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium w-fit ${LEVEL_CLASSES[cell.level]}`}
      >
        {LEVEL_LABELS[cell.level]}
      </span>
      {cell.caveat && <span className="text-xs text-zinc-500 leading-snug">{cell.caveat}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Platform capability matrix table.  Renders a collapsible grid showing
 * PWA feature support across Android, iOS browser, iOS standalone, and desktop.
 */
export function PlatformMatrix() {
  const { os, isStandalone } = usePlatform();
  const currentColumn = matchColumn(os, isStandalone);

  const [expanded, setExpanded] = useState(
    // Default to expanded on larger screens; use JS-only media query heuristic
    typeof window !== 'undefined' ? window.innerWidth >= 640 : true,
  );

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      {/* Header / toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-zinc-50 transition-colors"
        aria-expanded={expanded}
      >
        <div>
          <h2 className="text-base font-semibold text-zinc-900">Platform Support Matrix</h2>
          <p className="text-sm text-zinc-500">
            PWA feature availability across reference platforms
          </p>
        </div>
        <span className="text-zinc-400 text-lg select-none">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="overflow-x-auto border-t border-zinc-100">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-zinc-100">
                <th className="text-left px-4 py-3 font-medium text-zinc-600 w-36">Feature</th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`text-left px-4 py-3 font-medium ${
                      col.key === currentColumn ? 'text-indigo-700 bg-indigo-50' : 'text-zinc-600'
                    }`}
                  >
                    {col.label}
                    {col.key === currentColumn && (
                      <span className="ml-1 text-xs font-normal text-indigo-500">(you)</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_ROWS.map((row, i) => (
                <tr
                  key={row.feature}
                  className={`border-b border-zinc-50 ${i % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'}`}
                >
                  <td className="px-4 py-3 font-medium text-zinc-700">{row.feature}</td>
                  {COLUMNS.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3 ${col.key === currentColumn ? 'bg-indigo-50/40' : ''}`}
                    >
                      <SupportBadge cell={row[col.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
