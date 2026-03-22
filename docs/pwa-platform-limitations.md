# PWA Platform Limitations

## What It Covers

This document records the current PWA capability boundary for the repo's mobile
focus: Android Chrome, iOS Safari, and iOS Home Screen web apps.

Support levels mean:

- `full`: the feature works in the expected browser context.
- `partial`: the feature exists, but platform caveats or reliability limits
  apply.
- `unsupported`: the feature is absent or not usable on that platform.

## Platform Matrix

| Feature                                                | Android Chrome | iOS Safari  | iOS Home Screen Web App |
| ------------------------------------------------------ | -------------- | ----------- | ----------------------- |
| `beforeinstallprompt` install UI                       | full           | unsupported | unsupported             |
| Service worker registration and app-shell caching      | full           | partial     | partial                 |
| Background Sync                                        | full           | unsupported | unsupported             |
| Web Push / notifications                               | full           | unsupported | full, `iOS 16.4+`       |
| Badging API                                            | full           | unsupported | full, `iOS 16.4+`       |
| `getUserMedia` camera / microphone access              | full           | partial     | partial                 |
| `MediaRecorder`                                        | full           | partial     | partial                 |
| `navigator.storage.estimate()` / storage introspection | full           | partial     | partial                 |
| Manifest app shortcuts                                 | full           | unsupported | unsupported             |
| Manifest-driven splash screens                         | full           | unsupported | unsupported             |

## Truly Impossible on iOS

- `beforeinstallprompt`: iOS does not expose the Chromium install prompt flow.
- Background Sync: there is no usable iOS Safari equivalent for deferred
  background sync.
- Push from a browser tab: iOS web push is only available to Home Screen web
  apps, not Safari tabs.
- Manifest splash screens: iOS does not generate launch images from the
  manifest.
- Badge without notification permission: iOS ties web badges to notification
  permission.
- App shortcuts: Safari on iOS ignores the manifest `shortcuts` member.

## Partial Support Notes

- `getUserMedia` works, but standalone mode has known reliability issues and
  should be tested on-device.
- Script-writable storage on iOS is subject to a seven-day eviction policy when
  the user does not interact with the site.
- Web Push and Badging are available on iOS only for Home Screen web apps, and
  only from `iOS 16.4+`.
- `navigator.storage.estimate()` may exist, but it does not remove iOS storage
  eviction limits.
- `MediaRecorder` support should be treated as codec-sensitive and validated
  against the exact capture path used by the app.

## Workarounds

- Use a guided install overlay instead of `beforeinstallprompt` on iOS.
- Use `input capture` for camera flows that need a more reliable fallback than
  `getUserMedia`.
- Negotiate codecs before recording with `MediaRecorder`, and fail gracefully
  when the target codec is unavailable.
- Treat storage as cache, not as durable primary data, and sync critical state
  to the server.
- Use Home Screen installation as the prerequisite for web push and badges on
  iOS.

## Version Requirements

- `iOS 16.4+`: Web Push and Badging for Home Screen web apps.
- `iOS 13.4+`: seven-day eviction policy for script-writable storage.
- `Android Chrome`: install prompt, background sync, and manifest shortcuts are
  available in the Chromium PWA model.

## Last Verified

2026-03-22

## Sources

- [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [WebKit: Badging for Home Screen Web Apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/)
- [web.dev: Storage for the web](https://web.dev/articles/storage-for-the-web)
- [MDN: Window beforeinstallprompt event](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event)
- [web.dev: Web app manifest](https://web.dev/learn/pwa/web-app-manifest)
