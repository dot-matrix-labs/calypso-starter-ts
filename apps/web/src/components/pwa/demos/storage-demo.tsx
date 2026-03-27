/**
 * @file storage-demo.tsx
 *
 * Storage API PWA demo card.
 *
 * Demonstrates the Storage API available to Progressive Web Apps:
 * - Storage quota and usage via navigator.storage.estimate()
 * - IndexedDB read/write operations
 * - Persistent storage permission state via navigator.storage.persist()
 *
 * Platform notes
 * ---------------
 * - StorageManager.estimate() is available on iOS 17+ and all Android.
 * - navigator.storage.persist() may auto-grant on Android Chrome for installed
 *   PWAs. On desktop browsers it usually prompts or requires user gestures.
 * - IndexedDB is universally supported in all current browsers.
 * - Browsers without Storage API support see a graceful fallback message.
 *
 * Canonical docs
 * ---------------
 * - Storage API: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API
 * - StorageManager: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager
 * - IndexedDB: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
 */

import React, { useState, useEffect, useCallback } from 'react';
import { HardDrive } from 'lucide-react';
import { DemoCard } from '../demo-card';
import { usePlatform } from '../../../hooks/use-platform';

const IDB_NAME = 'pwa-storage-demo';
const IDB_STORE = 'demo-entries';
const IDB_VERSION = 1;
const DEMO_KEY = 'demo-record';

interface StorageQuota {
  usedMb: number;
  totalMb: number;
  percentUsed: number;
}

/** Open (or create) the IndexedDB database, returning the IDBDatabase */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

/** Write a string value to IndexedDB under the given key */
async function idbWrite(value: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, DEMO_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = (e) => {
      db.close();
      reject((e.target as IDBTransaction).error);
    };
  });
}

/** Read a string value from IndexedDB under the given key, or null if absent */
async function idbRead(): Promise<string | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(DEMO_KEY);
    req.onsuccess = (e) => {
      db.close();
      const val = (e.target as IDBRequest<string | undefined>).result;
      resolve(val ?? null);
    };
    req.onerror = (e) => {
      db.close();
      reject((e.target as IDBRequest).error);
    };
  });
}

/** Read storage quota from navigator.storage.estimate() */
async function readStorageQuota(): Promise<StorageQuota | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (usage == null || quota == null || quota === 0) return null;
    const usedMb = Math.round((usage / (1024 * 1024)) * 10) / 10;
    const totalMb = Math.round(quota / (1024 * 1024));
    const percentUsed = Math.round((usage / quota) * 100);
    return { usedMb, totalMb, percentUsed };
  } catch {
    return null;
  }
}

/**
 * Storage API demo card.
 *
 * Shows storage quota, IndexedDB write/read, and persistent storage state.
 * Renders a graceful fallback when the Storage API is not available.
 */
export function StorageDemoCard() {
  const { supports } = usePlatform();

  const storageApiAvailable = supports.storageManager || supports.indexedDB;

  const [quota, setQuota] = useState<StorageQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);

  const [idbValue, setIdbValue] = useState<string | null>(null);
  const [idbInput, setIdbInput] = useState('');
  const [idbWriting, setIdbWriting] = useState(false);
  const [idbError, setIdbError] = useState<string | null>(null);
  const [idbWriteSuccess, setIdbWriteSuccess] = useState(false);

  const [persistState, setPersistState] = useState<boolean | null>(null);
  const [persistRequesting, setPersistRequesting] = useState(false);

  // Load quota, stored IDB value, and persistent state on mount
  useEffect(() => {
    if (!storageApiAvailable) return;

    if (supports.storageManager) {
      setQuotaLoading(true);
      readStorageQuota()
        .then(setQuota)
        .finally(() => setQuotaLoading(false));
    }

    if (supports.indexedDB) {
      idbRead()
        .then(setIdbValue)
        .catch(() => setIdbValue(null));
    }

    if (supports.persistentStorage) {
      navigator.storage
        .persisted()
        .then(setPersistState)
        .catch(() => setPersistState(null));
    }
  }, [
    storageApiAvailable,
    supports.storageManager,
    supports.indexedDB,
    supports.persistentStorage,
  ]);

  const handleIdbWrite = useCallback(async () => {
    const trimmed = idbInput.trim();
    if (!trimmed || !supports.indexedDB) return;
    setIdbWriting(true);
    setIdbError(null);
    try {
      await idbWrite(trimmed);
      const readBack = await idbRead();
      setIdbValue(readBack);
      setIdbInput('');
      setIdbWriteSuccess(true);
      setTimeout(() => setIdbWriteSuccess(false), 2500);
      // Refresh quota after write
      if (supports.storageManager) {
        const updated = await readStorageQuota();
        setQuota(updated);
      }
    } catch (err) {
      setIdbError(err instanceof Error ? err.message : 'IndexedDB write failed');
    } finally {
      setIdbWriting(false);
    }
  }, [idbInput, supports.indexedDB, supports.storageManager]);

  const handleRequestPersist = useCallback(async () => {
    if (!supports.persistentStorage) return;
    setPersistRequesting(true);
    try {
      const granted = await navigator.storage.persist();
      setPersistState(granted);
    } catch {
      // Some browsers reject the call silently — leave state unchanged
    } finally {
      setPersistRequesting(false);
    }
  }, [supports.persistentStorage]);

  return (
    <DemoCard
      title="Storage API"
      description="Storage quota, IndexedDB, and persistent storage"
      icon={<HardDrive size={18} />}
      featureAvailable={storageApiAvailable}
      platformNotes={
        !storageApiAvailable ? 'Storage API not available on this browser.' : undefined
      }
      permissionState={null}
    >
      {/* Storage quota */}
      {supports.storageManager && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Storage Quota</p>
          {quotaLoading ? (
            <p className="text-sm text-zinc-400">Loading quota…</p>
          ) : quota ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-zinc-700">
                Used: <span className="font-medium">{quota.usedMb} MB</span> of{' '}
                <span className="font-medium">{quota.totalMb} MB</span>
                <span className="text-zinc-400 ml-1">({quota.percentUsed}%)</span>
              </p>
              <div className="w-full h-2 rounded-full bg-zinc-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${Math.min(quota.percentUsed, 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">Quota information unavailable.</p>
          )}
        </div>
      )}

      {/* IndexedDB write/read */}
      {supports.indexedDB && (
        <div className="flex flex-col gap-2 pt-2 border-t border-zinc-100">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">IndexedDB</p>
          {idbValue !== null && (
            <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100 text-sm text-zinc-700">
              Stored: <span className="font-medium">{idbValue}</span>
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={idbInput}
              onChange={(e) => setIdbInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleIdbWrite()}
              placeholder="Enter a value to store…"
              disabled={idbWriting}
              className="flex-1 px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            />
            <button
              onClick={handleIdbWrite}
              disabled={!idbInput.trim() || idbWriting}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {idbWriting ? 'Saving…' : 'Write'}
            </button>
          </div>
          {idbWriteSuccess && (
            <p className="text-xs text-green-600">Written and read back successfully.</p>
          )}
          {idbError && <p className="text-xs text-red-500">{idbError}</p>}
        </div>
      )}

      {/* Persistent storage */}
      <div className="flex flex-col gap-2 pt-2 border-t border-zinc-100">
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
          Persistent Storage
        </p>
        {!supports.persistentStorage ? (
          <p className="text-sm text-zinc-400">
            Persistent storage API not available on this browser.
          </p>
        ) : persistState === true ? (
          <p className="text-sm text-green-700 font-medium">Granted — data will not be evicted.</p>
        ) : persistState === false ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-zinc-500">
              Storage is not marked as persistent. Data may be evicted by the browser under storage
              pressure.
            </p>
            <button
              onClick={handleRequestPersist}
              disabled={persistRequesting}
              className="self-start px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {persistRequesting ? 'Requesting…' : 'Request persistent storage'}
            </button>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">Checking persistent storage state…</p>
        )}
      </div>
    </DemoCard>
  );
}
