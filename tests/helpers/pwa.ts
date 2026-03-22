import { devices, type BrowserContextOptions, type Page } from '@playwright/test';

type PlaywrightDevice = (typeof devices)[keyof typeof devices];

export type PwaDevicePreset = PlaywrightDevice & {
  standalone?: boolean;
};

type PwaWindow = Window & {
  __pwaBeforeInstallPrompt?: {
    promptCalls?: number;
  };
  __pwaGetUserMedia?: {
    calls?: number;
    lastConstraints?: MediaStreamConstraints;
  };
  __pwaMediaRecorder?: {
    calls?: number;
  };
  __pwaNotification?: {
    calls?: number;
  };
  __pwaServiceWorker?: {
    registeredPaths?: string[];
  };
  __pwaStorageManager?: {
    calls?: number;
    lastEstimate?: {
      usage: number;
      quota: number;
    };
  };
};

const ANDROID_DEVICE = devices['Pixel 7'];
const IOS_DEVICE = devices['iPhone 14'];
const DESKTOP_DEVICE = devices['Desktop Chrome'];

if (!ANDROID_DEVICE || !IOS_DEVICE || !DESKTOP_DEVICE) {
  throw new Error('Required Playwright device descriptors are unavailable.');
}

export const androidChrome: PwaDevicePreset = {
  ...ANDROID_DEVICE,
};

export const iosSafari: PwaDevicePreset = {
  ...IOS_DEVICE,
};

export const iosSafariStandalone: PwaDevicePreset = {
  ...iosSafari,
  standalone: true,
};

export const desktopChrome: PwaDevicePreset = {
  ...DESKTOP_DEVICE,
};

export function toBrowserContextOptions(preset: PwaDevicePreset): BrowserContextOptions {
  const { standalone, ...device } = preset;
  void standalone;
  return device;
}

export async function applyStandaloneDisplayMode(page: Page, preset: PwaDevicePreset) {
  if (!preset.standalone) return;

  await page.evaluate(() => {
    const originalMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = ((query: string) => {
      if (query.includes('(display-mode: standalone)')) {
        const listeners = new Set<() => void>();
        return {
          matches: true,
          media: query,
          onchange: null,
          addEventListener: (_type: string, listener: () => void) => {
            listeners.add(listener);
          },
          removeEventListener: (_type: string, listener: () => void) => {
            listeners.delete(listener);
          },
          dispatchEvent: () => {
            listeners.forEach((listener) => listener());
            return true;
          },
          addListener: (listener: () => void) => {
            listeners.add(listener);
          },
          removeListener: (listener: () => void) => {
            listeners.delete(listener);
          },
        } as unknown as MediaQueryList;
      }

      return originalMatchMedia(query);
    }) as typeof window.matchMedia;
  });
}

export async function stubBeforeInstallPrompt(page: Page) {
  await page.evaluate(() => {
    const global = window as PwaWindow;
    global.__pwaBeforeInstallPrompt = {
      promptCalls: 0,
    };

    const event = new Event('beforeinstallprompt', { cancelable: true }) as unknown as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted'; platform: 'web' }>;
    };

    Object.defineProperty(event, 'prompt', {
      configurable: true,
      value: async () => {
        global.__pwaBeforeInstallPrompt!.promptCalls =
          (global.__pwaBeforeInstallPrompt!.promptCalls ?? 0) + 1;
      },
    });
    Object.defineProperty(event, 'userChoice', {
      configurable: true,
      value: Promise.resolve({ outcome: 'accepted', platform: 'web' as const }),
    });

    window.dispatchEvent(event);
  });

  return {
    wasPromptCalled: async () =>
      page.evaluate(() => Boolean((window as PwaWindow).__pwaBeforeInstallPrompt?.promptCalls)),
  };
}

export async function stubGetUserMedia(
  page: Page,
  options: { video?: boolean; audio?: boolean; deny?: boolean } = {},
) {
  await page.evaluate(({ video = true, audio = false, deny = false }) => {
    const global = window as PwaWindow;
    global.__pwaGetUserMedia = {
      calls: 0,
    };

    const makeTrack = (kind: 'audio' | 'video'): MediaStreamTrack =>
      ({
        enabled: true,
        id: `fake-${kind}-track`,
        kind,
        label: `Fake ${kind}`,
        muted: false,
        readyState: 'live',
        contentHint: '',
        stop: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
        applyConstraints: async () => undefined,
        clone: () => makeTrack(kind),
        getCapabilities: () => ({}) as MediaTrackCapabilities,
        getConstraints: () => ({}) as MediaTrackConstraints,
        getSettings: () => ({}) as MediaTrackSettings,
        onended: null,
        onmute: null,
        onunmute: null,
      }) as unknown as MediaStreamTrack;

    const makeStream = () => {
      const tracks = [
        ...(video ? [makeTrack('video')] : []),
        ...(audio ? [makeTrack('audio')] : []),
      ];

      return {
        active: true,
        id: 'fake-stream',
        getTracks: () => tracks,
        getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
        getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
        getTrackById: () => null,
        addTrack: () => undefined,
        removeTrack: () => undefined,
        clone: () => makeStream(),
      } as unknown as MediaStream;
    };

    const mediaDevices = navigator.mediaDevices ?? ({} as MediaDevices);
    Object.defineProperty(mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        global.__pwaGetUserMedia!.calls = (global.__pwaGetUserMedia!.calls ?? 0) + 1;
        global.__pwaGetUserMedia!.lastConstraints = constraints;
        if (deny) {
          throw new DOMException('Permission denied', 'NotAllowedError');
        }
        return makeStream();
      },
    });

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: mediaDevices,
    });
  }, options);

  return {
    wasRequested: async () =>
      page.evaluate(() => Boolean((window as PwaWindow).__pwaGetUserMedia?.calls)),
    lastConstraints: async () =>
      page.evaluate(() => (window as PwaWindow).__pwaGetUserMedia?.lastConstraints ?? null),
  };
}

export async function stubMediaRecorder(page: Page) {
  await page.evaluate(() => {
    const global = window as PwaWindow;
    global.__pwaMediaRecorder = {
      calls: 0,
    };

    class MockMediaRecorder {
      static isTypeSupported(_type: string) {
        void _type;
        return true;
      }

      stream: MediaStream;
      state: RecordingState = 'inactive';
      mimeType: string;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstart: (() => void) | null = null;
      onstop: (() => void) | null = null;
      onpause: (() => void) | null = null;
      onresume: (() => void) | null = null;

      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        this.stream = stream;
        this.mimeType = options?.mimeType ?? '';
      }

      start() {
        global.__pwaMediaRecorder!.calls = (global.__pwaMediaRecorder!.calls ?? 0) + 1;
        this.state = 'recording';
        this.onstart?.();
      }

      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['pwa-media-recording']) });
        this.onstop?.();
      }

      pause() {
        this.state = 'paused';
        this.onpause?.();
      }

      resume() {
        this.state = 'recording';
        this.onresume?.();
      }

      requestData() {
        this.ondataavailable?.({ data: new Blob(['pwa-media-recording']) });
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: MockMediaRecorder,
    });
  });

  return {
    wasStarted: async () =>
      page.evaluate(() => Boolean((window as PwaWindow).__pwaMediaRecorder?.calls)),
  };
}

export async function stubNotification(page: Page, permission: NotificationPermission) {
  await page.evaluate((permission) => {
    const global = window as PwaWindow;
    global.__pwaNotification = {
      calls: 0,
    };

    class MockNotification {
      static get permission() {
        return permission;
      }

      static async requestPermission() {
        return permission;
      }

      title: string;
      options?: NotificationOptions;

      constructor(title: string, options?: NotificationOptions) {
        global.__pwaNotification!.calls = (global.__pwaNotification!.calls ?? 0) + 1;
        this.title = title;
        this.options = options;
      }
    }

    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: MockNotification,
    });
  }, permission);

  return {
    wasNotified: async () =>
      page.evaluate(() => Boolean((window as PwaWindow).__pwaNotification?.calls)),
  };
}

export async function stubServiceWorker(page: Page) {
  await page.evaluate(() => {
    const global = window as PwaWindow;
    global.__pwaServiceWorker = {
      registeredPaths: [],
    };

    const registration = {
      scope: '/',
      active: null,
      installing: null,
      waiting: null,
      onupdatefound: null,
      update: async () => undefined,
      unregister: async () => true,
    } as unknown as ServiceWorkerRegistration;

    const serviceWorker = {
      register: async (path: string) => {
        global.__pwaServiceWorker!.registeredPaths ??= [];
        global.__pwaServiceWorker!.registeredPaths.push(path);
        return registration;
      },
      ready: Promise.resolve(registration),
      controller: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
      getRegistrations: async () => [registration],
    } as unknown as ServiceWorkerContainer;

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker,
    });
  });

  return {
    registeredPaths: async () =>
      page.evaluate(() => (window as PwaWindow).__pwaServiceWorker?.registeredPaths ?? []),
  };
}

export async function stubStorageManager(
  page: Page,
  estimate: { usage?: number; quota?: number } = {},
) {
  const { usage = 0, quota = 1_000_000 } = estimate;

  await page.evaluate(
    ({ usage, quota }) => {
      const global = window as PwaWindow;
      global.__pwaStorageManager = {
        calls: 0,
        lastEstimate: { usage, quota },
      };

      const storage = navigator.storage ?? {};
      Object.defineProperty(storage, 'estimate', {
        configurable: true,
        value: async () => {
          global.__pwaStorageManager!.calls = (global.__pwaStorageManager!.calls ?? 0) + 1;
          global.__pwaStorageManager!.lastEstimate = { usage, quota };
          return { usage, quota };
        },
      });

      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: storage,
      });
    },
    { usage, quota },
  );

  return {
    wasEstimated: async () =>
      page.evaluate(() => Boolean((window as PwaWindow).__pwaStorageManager?.calls)),
    lastEstimate: async () =>
      page.evaluate(() => (window as PwaWindow).__pwaStorageManager?.lastEstimate ?? null),
  };
}
