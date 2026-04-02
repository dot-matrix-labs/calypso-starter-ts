/**
 * @file settings.tsx
 *
 * Account settings page.
 *
 * Includes a conditional "Install app" row that is shown whenever the app is
 * not running in standalone mode.  The row triggers the same platform-aware
 * install flow as the mobile gate page.
 *
 * Canonical docs
 * ---------------
 * - display-mode media query: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/display-mode
 * - beforeinstallprompt: https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Smartphone } from 'lucide-react';
import { usePlatform } from '../hooks/use-platform';
import { useAuth } from '../context/AuthContext';
import { RegisterPasskeyButton } from '../components/PasskeyButton';

/** Minimal typing for the non-standard BeforeInstallPromptEvent */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PasskeyCredential {
  id: string;
  credential_id: string;
  created_at: string;
  last_used_at: string | null;
}

export function truncateCredentialId(credentialId: string): string {
  return credentialId.length <= 16 ? credentialId : credentialId.slice(0, 16);
}

export function formatPasskeyDate(date: string | null): string {
  if (!date) return 'Never';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return parsed.toLocaleString();
}

export async function fetchPasskeyCredentials(
  fetchImpl: typeof fetch = fetch,
): Promise<PasskeyCredential[]> {
  const res = await fetchImpl('/api/auth/passkey/credentials', {
    method: 'GET',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to load passkeys');
  return (await res.json()) as PasskeyCredential[];
}

export async function removePasskeyCredential(
  credentialId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`/api/auth/passkey/credentials/${credentialId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to remove passkey');
}

interface PasskeysSectionProps {
  userId: string;
  renderRegisterButton?: (onSuccess: () => void) => React.ReactNode;
}

export function PasskeysSection({ userId, renderRegisterButton }: PasskeysSectionProps) {
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(true);
  const [passkeysError, setPasskeysError] = useState('');

  const loadPasskeys = useCallback(async () => {
    setPasskeysLoading(true);
    setPasskeysError('');
    try {
      const credentials = await fetchPasskeyCredentials();
      setPasskeys(credentials);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load passkeys';
      setPasskeysError(message);
    } finally {
      setPasskeysLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPasskeys();
  }, [loadPasskeys]);

  const handleRemovePasskey = useCallback(async (credentialId: string) => {
    try {
      await removePasskeyCredential(credentialId);
      setPasskeys((existing) => existing.filter((passkey) => passkey.id !== credentialId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove passkey';
      setPasskeysError(message);
    }
  }, []);

  const registerButton = renderRegisterButton ? (
    renderRegisterButton(() => {
      void loadPasskeys();
    })
  ) : (
    <RegisterPasskeyButton userId={userId} onSuccess={loadPasskeys} />
  );

  return (
    <section className="mb-6 border border-zinc-200 rounded-xl p-4 bg-white space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900">Passkeys</h3>
        <p className="text-xs text-zinc-500 mt-1">
          Manage authenticators registered to this account.
        </p>
      </div>

      {passkeysError && <p className="text-xs text-red-600">{passkeysError}</p>}

      {passkeysLoading ? (
        <p className="text-sm text-zinc-500">Loading passkeys...</p>
      ) : passkeys.length === 0 ? (
        <p className="text-sm text-zinc-500">No passkeys registered yet.</p>
      ) : (
        <div className="border border-zinc-200 rounded-lg overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-3 py-2 font-medium">Credential ID</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {passkeys.map((passkey) => (
                <tr key={passkey.id}>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-700">
                    {truncateCredentialId(passkey.credential_id)}
                  </td>
                  <td className="px-3 py-2 text-zinc-600">
                    {formatPasskeyDate(passkey.created_at)}
                  </td>
                  <td className="px-3 py-2 text-zinc-600">
                    {formatPasskeyDate(passkey.last_used_at)}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        void handleRemovePasskey(passkey.id);
                      }}
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {registerButton}
    </section>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const { os, isStandalone } = usePlatform();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [showAndroidFallback, setShowAndroidFallback] = useState(false);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstallRow = useCallback(async () => {
    setShowIosSteps(false);
    setShowAndroidFallback(false);

    if (os === 'ios') {
      setShowIosSteps(true);
      return;
    }
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (outcome === 'dismissed') {
        // User cancelled — nothing to do
      }
    } else {
      setShowAndroidFallback(true);
    }
  }, [os, deferredPrompt]);

  return (
    <div className="p-8 max-w-lg">
      <h2 className="text-base font-semibold text-zinc-900 mb-6">Account settings</h2>

      {user && <PasskeysSection userId={user.id} />}

      {!isStandalone && (
        <div className="border border-zinc-200 rounded-xl divide-y divide-zinc-100">
          <button
            onClick={handleInstallRow}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors text-left"
          >
            <Smartphone size={18} className="text-zinc-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900">Install app</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Add Calypso to your home screen for a faster experience
              </p>
            </div>
          </button>
        </div>
      )}

      {showIosSteps && (
        <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <p className="text-xs font-semibold text-indigo-700 mb-3">
            Follow these steps in your browser:
          </p>
          <ol className="flex flex-col gap-2 text-sm text-zinc-700">
            <li className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                1
              </span>
              <span>
                Tap the <span className="font-medium text-zinc-900">Share</span> button in your
                browser toolbar.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                2
              </span>
              <span>Scroll down in the share sheet.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                3
              </span>
              <span>
                Tap{' '}
                <span className="font-medium text-zinc-900">&ldquo;Add to Home Screen&rdquo;</span>{' '}
                and confirm.
              </span>
            </li>
          </ol>
        </div>
      )}

      {showAndroidFallback && (
        <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <p className="text-xs font-semibold text-indigo-700 mb-3">
            Follow these steps in your browser:
          </p>
          <ol className="flex flex-col gap-2 text-sm text-zinc-700">
            <li className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                1
              </span>
              <span>
                Tap the <span className="font-medium text-zinc-900">⋮ Menu</span> in your browser.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                2
              </span>
              <span>
                Select{' '}
                <span className="font-medium text-zinc-900">&ldquo;Add to Home screen&rdquo;</span>{' '}
                or <span className="font-medium text-zinc-900">&ldquo;Install app&rdquo;</span>.
              </span>
            </li>
          </ol>
        </div>
      )}

      {isStandalone && (
        <p className="text-sm text-zinc-400 mt-4">
          You are already running Calypso as an installed app.
        </p>
      )}
    </div>
  );
}
