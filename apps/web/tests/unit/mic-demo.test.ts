/**
 * Unit tests for the microphone recording demo card logic.
 *
 * Tests MIME type negotiation, label formatting, and elapsed-time formatting
 * without mounting the React component.
 */

import { describe, test, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Mirror pure helpers for isolated unit testing
// ---------------------------------------------------------------------------

const CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];

/**
 * Mirror of negotiateMimeType — returns first supported type given a set of
 * supported types (test doubles for MediaRecorder.isTypeSupported).
 */
function negotiateMimeType(supported: Set<string>): string {
  for (const type of CANDIDATES) {
    if (supported.has(type)) return type;
  }
  return '';
}

/** Mirror of mimeLabel */
function mimeLabel(mimeType: string): string {
  if (mimeType.includes('webm') && mimeType.includes('opus')) return 'WebM/Opus';
  if (mimeType.includes('mp4')) return 'MP4/AAC';
  if (mimeType.includes('webm')) return 'WebM';
  return mimeType || 'unknown';
}

/** Mirror elapsed formatter */
function formatElapsed(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// MIME type negotiation
// ---------------------------------------------------------------------------

describe('negotiateMimeType', () => {
  test('prefers audio/webm;codecs=opus when supported', () => {
    const supported = new Set(['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']);
    expect(negotiateMimeType(supported)).toBe('audio/webm;codecs=opus');
  });

  test('falls back to audio/mp4 when webm/opus not supported', () => {
    const supported = new Set(['audio/mp4', 'audio/webm']);
    expect(negotiateMimeType(supported)).toBe('audio/mp4');
  });

  test('falls back to audio/webm when only webm is supported', () => {
    const supported = new Set(['audio/webm']);
    expect(negotiateMimeType(supported)).toBe('audio/webm');
  });

  test('returns empty string when no candidates are supported', () => {
    const supported = new Set<string>();
    expect(negotiateMimeType(supported)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// MIME label formatting
// ---------------------------------------------------------------------------

describe('mimeLabel', () => {
  test('labels webm+opus as WebM/Opus', () => {
    expect(mimeLabel('audio/webm;codecs=opus')).toBe('WebM/Opus');
  });

  test('labels mp4 as MP4/AAC', () => {
    expect(mimeLabel('audio/mp4')).toBe('MP4/AAC');
  });

  test('labels plain webm as WebM', () => {
    expect(mimeLabel('audio/webm')).toBe('WebM');
  });

  test('returns unknown for empty string', () => {
    expect(mimeLabel('')).toBe('unknown');
  });

  test('returns raw value for unrecognised type', () => {
    expect(mimeLabel('audio/ogg')).toBe('audio/ogg');
  });
});

// ---------------------------------------------------------------------------
// Elapsed time formatting
// ---------------------------------------------------------------------------

describe('formatElapsed', () => {
  test('formats 0 seconds as 00:00', () => {
    expect(formatElapsed(0)).toBe('00:00');
  });

  test('formats 59 seconds as 00:59', () => {
    expect(formatElapsed(59)).toBe('00:59');
  });

  test('formats 60 seconds as 01:00', () => {
    expect(formatElapsed(60)).toBe('01:00');
  });

  test('formats 90 seconds as 01:30', () => {
    expect(formatElapsed(90)).toBe('01:30');
  });

  test('formats 3661 seconds as 61:01', () => {
    expect(formatElapsed(3661)).toBe('61:01');
  });
});

// ---------------------------------------------------------------------------
// Platform note derivation
// ---------------------------------------------------------------------------

describe('platform note for mic demo', () => {
  function getPlatformNote(os: string, mimeType: string): string | undefined {
    if (os === 'ios') {
      if (mimeType.includes('webm')) return 'Recording in WebM/Opus format (Safari 26+).';
      return 'Recording in MP4/AAC format (WebM not supported on this iOS version).';
    }
    return mimeType ? `Recording as: ${mimeLabel(mimeType)}` : undefined;
  }

  test('iOS with webm shows Safari 26+ note', () => {
    expect(getPlatformNote('ios', 'audio/webm;codecs=opus')).toMatch(/Safari 26\+/);
  });

  test('iOS with mp4 shows iOS version note', () => {
    expect(getPlatformNote('ios', 'audio/mp4')).toMatch(/MP4\/AAC/);
  });

  test('Android with webm/opus shows format label', () => {
    expect(getPlatformNote('android', 'audio/webm;codecs=opus')).toContain('WebM/Opus');
  });

  test('macOS with webm/opus shows format label', () => {
    expect(getPlatformNote('macos', 'audio/webm;codecs=opus')).toContain('WebM/Opus');
  });
});

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

describe('mic-demo module exports', () => {
  test('MicDemoCard is exported', async () => {
    const mod = await import('../../src/components/pwa/demos/mic-demo.js');
    expect(typeof mod.MicDemoCard).toBe('function');
  });
});
