/**
 * @file use-platform.ts
 *
 * React hook that centralises PWA platform detection. Returns a stable typed
 * object describing the user's OS, browser, standalone mode, and supported
 * browser APIs.
 *
 * Detection philosophy
 * --------------------
 * - `os` and `browser` are derived from user-agent string parsing (simple
 *   regex, no library). User-agent is unreliable by design; these fields are
 *   for UI hints only, never for security decisions.
 * - `isStandalone` uses the standards-track `display-mode: standalone` media
 *   query with an additional iOS proprietary fallback.
 * - `supports.*` flags are pure feature-detection checks (typeof / `in`) —
 *   no user-agent sniffing. A flag being `true` means the API surface exists
 *   in the current environment, not that it will work correctly on every
 *   platform (see platform caveats below).
 *
 * Platform caveats (informational — not enforced here)
 * -----------------------------------------------------
 * - `getUserMedia`: returns `true` even on iOS standalone, where the API is
 *   present but unreliable. The camera card documents this caveat.
 * - `notifications`: returns `true` on iOS Safari browser tabs even though
 *   push notifications require standalone mode. The notifications card handles
 *   this nuance.
 *
 * Canonical docs
 * ---------------
 * - PWA manifest spec: https://www.w3.org/TR/appmanifest/
 * - Service worker spec: https://w3c.github.io/ServiceWorker/
 * - MediaDevices.getUserMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
 * - Notifications API: https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API
 * - StorageManager: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager
 */

import { useState, useEffect } from 'react';

export interface PlatformInfo {
  /** Detected operating system (best-effort UA parse) */
  os: 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'unknown';
  /** Detected browser engine (best-effort UA parse) */
  browser: 'chrome' | 'safari' | 'firefox' | 'edge' | 'unknown';
  /** True when the app is running as an installed PWA in standalone mode */
  isStandalone: boolean;
  /** Browser API surface flags — presence, not reliability */
  supports: {
    /** window.BeforeInstallPromptEvent / beforeinstallprompt event */
    beforeInstallPrompt: boolean;
    /** 'serviceWorker' in navigator */
    serviceWorker: boolean;
    /** navigator.mediaDevices?.getUserMedia */
    getUserMedia: boolean;
    /** window.MediaRecorder */
    mediaRecorder: boolean;
    /** 'Notification' in window */
    notifications: boolean;
    /** navigator.storage?.estimate */
    storageManager: boolean;
    /** HTML capture attribute — universally supported, always true */
    inputCapture: boolean;
  };
}

/** Parse operating system from user-agent string */
function detectOs(ua: string): PlatformInfo['os'] {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/windows/i.test(ua)) return 'windows';
  if (/macintosh|mac os x/i.test(ua)) return 'macos';
  if (/linux/i.test(ua)) return 'linux';
  return 'unknown';
}

/** Parse browser from user-agent string */
function detectBrowser(ua: string): PlatformInfo['browser'] {
  // Order matters: Edge includes "Chrome" in its UA, so check Edge first.
  if (/edg\//i.test(ua)) return 'edge';
  if (/chrome|chromium|crios/i.test(ua)) return 'chrome';
  if (/firefox|fxios/i.test(ua)) return 'firefox';
  if (/safari/i.test(ua)) return 'safari';
  return 'unknown';
}

/** Detect standalone mode via standards-track media query + iOS proprietary flag */
function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mediaMatch =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  // iOS proprietary: set when the app was launched from the home screen
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mediaMatch || iosStandalone;
}

/** Build the full PlatformInfo snapshot for the current browser environment */
function buildPlatformInfo(): PlatformInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

  return {
    os: detectOs(ua),
    browser: detectBrowser(ua),
    isStandalone: detectStandalone(),
    supports: {
      beforeInstallPrompt: typeof window !== 'undefined' && 'BeforeInstallPromptEvent' in window,
      serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      getUserMedia:
        typeof navigator !== 'undefined' &&
        typeof navigator.mediaDevices !== 'undefined' &&
        typeof navigator.mediaDevices.getUserMedia === 'function',
      mediaRecorder: typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined',
      notifications: typeof window !== 'undefined' && 'Notification' in window,
      storageManager:
        typeof navigator !== 'undefined' &&
        typeof navigator.storage !== 'undefined' &&
        typeof navigator.storage.estimate === 'function',
      // HTML <input capture> is a plain attribute — no JS API to detect; it's
      // universally supported in all current browsers/OSes.
      inputCapture: true,
    },
  };
}

/**
 * React hook that returns a stable snapshot of the current platform's
 * capabilities and identity.
 *
 * The snapshot is computed once on mount. It does not update after mount
 * because none of the underlying APIs change dynamically during a page
 * session. (If standalone mode changes — e.g. the user adds the PWA to their
 * home screen while the page is open — a reload will occur automatically.)
 *
 * @example
 * ```tsx
 * const { os, isStandalone, supports } = usePlatform();
 * if (supports.serviceWorker) { ... }
 * ```
 */
export function usePlatform(): PlatformInfo {
  const [info, setInfo] = useState<PlatformInfo>(() => buildPlatformInfo());

  useEffect(() => {
    // Re-evaluate on mount in case SSR/pre-render computed an empty snapshot
    setInfo(buildPlatformInfo());
  }, []);

  return info;
}
