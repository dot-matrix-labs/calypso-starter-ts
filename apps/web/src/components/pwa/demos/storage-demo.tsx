/**
 * @file storage-demo.tsx
 *
 * Local storage PWA demo card.
 *
 * Demonstrates persistent client-side storage using the Web Storage API.
 * This card requires no permissions and works on all platforms, making it
 * the simplest PWA API to demo end-to-end.
 *
 * Platform notes
 * ---------------
 * - iOS Safari (browser tab): localStorage is cleared after 7 days of
 *   origin inactivity.
 * - iOS Safari (standalone PWA): no eviction — data persists normally.
 * - Android Chrome: no eviction caveats.
 * - All localStorage calls are wrapped in try/catch because private
 *   browsing on some browsers throws on write.
 * - StorageManager.estimate() is available on iOS 17+ and all Android.
 *
 * Canonical docs
 * ---------------
 * - Web Storage API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
 * - StorageManager: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager
 */

import React, { useState, useEffect, useCallback } from 'react';
import { HardDrive } from 'lucide-react';
import { DemoCard } from '../demo-card';
import { usePlatform } from '../../../hooks/use-platform';

const STORAGE_KEY = 'pwa-demo-notes';

interface StorageQuota {
  usedKb: number;
  totalMb: number;
}

function loadNotes(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((n): n is string => typeof n === 'string');
    return [];
  } catch {
    return [];
  }
}

function saveNotes(notes: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    // Private browsing or storage full — silently skip
  }
}

async function readQuota(): Promise<StorageQuota | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (usage == null || quota == null) return null;
    return {
      usedKb: Math.round(usage / 1024),
      totalMb: Math.round(quota / (1024 * 1024)),
    };
  } catch {
    return null;
  }
}

/**
 * Local storage demo card.  Renders inside a `DemoCard` shell with no
 * permission gating (localStorage needs no user permission).
 */
export function StorageDemoCard() {
  const { os, isStandalone, supports } = usePlatform();

  const [notes, setNotes] = useState<string[]>(() => loadNotes());
  const [input, setInput] = useState('');
  const [quota, setQuota] = useState<StorageQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);

  // Read storage quota on mount
  useEffect(() => {
    if (!supports.storageManager) return;
    setQuotaLoading(true);
    readQuota()
      .then(setQuota)
      .finally(() => setQuotaLoading(false));
  }, [supports.storageManager]);

  const handleSave = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const updated = [...notes, trimmed];
    setNotes(updated);
    saveNotes(updated);
    setInput('');
  }, [input, notes]);

  const handleClearAll = useCallback(() => {
    setNotes([]);
    saveNotes([]);
  }, []);

  // Platform note for the card
  const platformNote =
    os === 'ios' && !isStandalone
      ? 'Data may be cleared after 7 days of inactivity (browser tab mode)'
      : os === 'ios' && isStandalone
        ? 'Data persists normally when installed to home screen'
        : undefined;

  return (
    <DemoCard
      title="Local Storage"
      description="Persist data across sessions using the Web Storage API"
      icon={<HardDrive size={18} />}
      featureAvailable={true}
      platformNotes={platformNote}
      permissionState={null}
    >
      {/* Input area */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          placeholder="Type a note…"
          className="flex-1 px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={handleSave}
          disabled={!input.trim()}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Save
        </button>
      </div>

      {/* Notes list */}
      {notes.length > 0 ? (
        <ul className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
          {notes.map((note, i) => (
            <li
              key={i}
              className="px-3 py-1.5 rounded-lg bg-zinc-50 border border-zinc-100 text-sm text-zinc-700"
            >
              {note}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-400">No notes saved yet. Add one above.</p>
      )}

      {/* Actions row */}
      {notes.length > 0 && (
        <button
          onClick={handleClearAll}
          className="self-start text-xs text-red-500 hover:text-red-700 transition-colors"
        >
          Clear all
        </button>
      )}

      {/* Storage quota */}
      <div className="pt-1 border-t border-zinc-100 text-xs text-zinc-400">
        {!supports.storageManager ? (
          <span>Quota info unavailable on this platform</span>
        ) : quotaLoading ? (
          <span>Loading quota…</span>
        ) : quota ? (
          <span>
            Storage used: {quota.usedKb} KB / {quota.totalMb} MB
          </span>
        ) : (
          <span>Quota info unavailable</span>
        )}
      </div>
    </DemoCard>
  );
}
