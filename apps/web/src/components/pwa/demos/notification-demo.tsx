/**
 * @file notification-demo.tsx
 *
 * Notifications PWA demo card.
 *
 * Demonstrates the Web Notifications API in a local-only context (no server-side
 * push infrastructure required). The demo honestly surfaces platform restrictions,
 * which are significant on iOS.
 *
 * Platform notes
 * ---------------
 * - Android Chrome: full support in both browser tab and standalone modes.
 * - iOS Safari (browser tab): Notification API is present but
 *   requestPermission() always resolves to 'denied'. We show an install prompt
 *   instead of a pointless permission request.
 * - iOS Safari (standalone, iOS 16.4+): full notification support.
 * - iOS Safari (standalone, < iOS 16.4): Notification may not exist at all.
 *   Shown as featureAvailable === false.
 * - Desktop browsers: full support.
 *
 * Canonical docs
 * ---------------
 * - Notifications API: https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API
 * - Notification: https://developer.mozilla.org/en-US/docs/Web/API/Notification
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { DemoCard } from '../demo-card';
import { usePlatform } from '../../../hooks/use-platform';

/**
 * Notifications demo card.
 *
 * featureAvailable is false only when `Notification` is absent from the window
 * (e.g. iOS < 16.4 standalone). On iOS browser tabs the feature is technically
 * "available" but silently denied — we show a special install-first message
 * instead of the normal permission flow.
 */
export function NotificationDemoCard() {
  const { os, isStandalone, supports } = usePlatform();

  const featureAvailable = supports.notifications;

  // iOS browser tab: API exists but is silently blocked — inform user to install
  const isIosBrowserTab = os === 'ios' && !isStandalone;

  const [permissionState, setPermissionState] = useState<NotificationPermission>('default');
  const [lastNotificationSent, setLastNotificationSent] = useState(false);

  // Read current permission state from Notification.permission on mount
  useEffect(() => {
    if (!featureAvailable) return;
    setPermissionState(Notification.permission);
  }, [featureAvailable]);

  const requestPermission = useCallback(async () => {
    if (!featureAvailable) return;
    const result = await Notification.requestPermission();
    setPermissionState(result);
  }, [featureAvailable]);

  const sendTestNotification = useCallback(() => {
    if (!featureAvailable || Notification.permission !== 'granted') return;
    new Notification('PWA Demo', {
      body: 'Your test notification from the Calypso PWA demo.',
      icon: '/icons/icon-192.png',
    });
    setLastNotificationSent(true);
    setTimeout(() => setLastNotificationSent(false), 3000);
  }, [featureAvailable]);

  // Platform note shown in unavailable state
  const unavailableNote =
    !featureAvailable && os === 'ios' && isStandalone
      ? 'Notifications require iOS 16.4 or later.'
      : !featureAvailable
        ? 'Notification API not available on this platform.'
        : undefined;

  // Map NotificationPermission to PermissionState for DemoCard
  // (they share the same values: 'prompt' maps to 'default'→'prompt')
  const cardPermissionState: PermissionState | null = isIosBrowserTab
    ? null // we handle this case ourselves below
    : permissionState === 'default'
      ? 'prompt'
      : (permissionState as PermissionState);

  return (
    <DemoCard
      title="Notifications"
      description="Send local test notifications to the device"
      icon={<Bell size={18} />}
      featureAvailable={featureAvailable}
      platformNotes={unavailableNote}
      permissionState={cardPermissionState}
      onRequestPermission={requestPermission}
    >
      {/* iOS browser tab: must install as PWA first */}
      {isIosBrowserTab ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <span className="font-medium">Install as PWA first.</span> Push notifications on iOS
          require this app to be added to the home screen and opened in standalone mode.
        </div>
      ) : permissionState === 'granted' ? (
        <div className="flex flex-col gap-3">
          <button
            onClick={sendTestNotification}
            className="self-start px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Send test notification
          </button>
          {lastNotificationSent && (
            <p className="text-xs text-green-600">Notification sent successfully.</p>
          )}
          <p className="text-xs text-zinc-400">
            A local notification will appear in your system notification center.
          </p>
        </div>
      ) : null}
    </DemoCard>
  );
}
