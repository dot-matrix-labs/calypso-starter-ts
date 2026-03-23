/**
 * @file mic-demo.tsx
 *
 * Microphone recording PWA demo card.
 *
 * Demonstrates audio recording via the MediaRecorder API, a reliable PWA
 * capability that works across platforms — including iOS standalone (supported
 * since Safari 14.1 for MP4/AAC, and WebM/Opus added in Safari 26).
 *
 * Recording flow
 * ---------------
 * 1. Request microphone permission via getUserMedia({ audio: true })
 * 2. Start a MediaRecorder on the audio stream
 * 3. Show a recording indicator (pulsing dot + elapsed time)
 * 4. Stop recording — ondataavailable collects chunks into a Blob
 * 5. Display the recorded Blob as a playback <audio> element
 * 6. "Record again" resets state for a new recording
 *
 * Codec negotiation
 * ------------------
 * Prefer audio/webm;codecs=opus → audio/mp4 → audio/webm (no codec).
 * The negotiated MIME type is shown to the user.
 *
 * Safety limit: 60 seconds max recording length (auto-stop via setTimeout).
 *
 * Platform notes
 * ---------------
 * - iOS < Safari 26: Only audio/mp4 (AAC) is supported.
 * - iOS ≥ Safari 26 / Android / desktop: audio/webm;codecs=opus preferred.
 * - MediaRecorder is present on all current iOS/Android/desktop browsers.
 *
 * Canonical docs
 * ---------------
 * - MediaRecorder: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
 * - MediaDevices.getUserMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
 * - Permissions API: https://developer.mozilla.org/en-US/docs/Web/API/Permissions_API
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Mic } from 'lucide-react';
import { DemoCard } from '../demo-card';
import { usePlatform } from '../../../hooks/use-platform';

const MAX_RECORDING_SECONDS = 60;

/** Negotiate the best supported MIME type for recording. */
function negotiateMimeType(): string {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

/** Return a short human-readable label for the MIME type. */
function mimeLabel(mimeType: string): string {
  if (mimeType.includes('webm') && mimeType.includes('opus')) return 'WebM/Opus';
  if (mimeType.includes('mp4')) return 'MP4/AAC';
  if (mimeType.includes('webm')) return 'WebM';
  return mimeType || 'unknown';
}

type RecordingState = 'idle' | 'recording' | 'stopped';

/**
 * Microphone recording demo card.  Available on all platforms where
 * MediaRecorder is present (which is all current browsers).
 */
export function MicDemoCard() {
  const { os, supports } = usePlatform();

  const featureAvailable = supports.mediaRecorder && supports.getUserMedia;

  const [permissionState, setPermissionState] = useState<PermissionState>('prompt');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [mimeType] = useState<string>(() => negotiateMimeType());

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Query permission state on mount where Permissions API is available
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions) return;
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((status) => {
        setPermissionState(status.state);
        status.onchange = () => setPermissionState(status.state);
      })
      .catch(() => {
        // Permissions API not available or microphone not queryable — stay 'prompt'
      });
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setPermissionState('granted');

      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setRecordingState('stopped');
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (timerRef.current) clearInterval(timerRef.current);
        if (autoStopRef.current) clearTimeout(autoStopRef.current);
      };

      recorder.start();
      setRecordingState('recording');
      setElapsed(0);

      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);

      autoStopRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, MAX_RECORDING_SECONDS * 1000);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setPermissionState('denied');
      } else {
        setPermissionState('denied');
      }
    }
  }, [mimeType]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleReset = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setRecordingState('idle');
    setElapsed(0);
    chunksRef.current = [];
    mediaRecorderRef.current = null;
  }, [audioUrl]);

  // Format elapsed seconds as mm:ss
  const elapsedLabel = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  // Platform note
  const platformNote =
    os === 'ios'
      ? mimeType.includes('webm')
        ? 'Recording in WebM/Opus format (Safari 26+).'
        : 'Recording in MP4/AAC format (WebM not supported on this iOS version).'
      : mimeType
        ? `Recording as: ${mimeLabel(mimeType)}`
        : undefined;

  return (
    <DemoCard
      title="Microphone"
      description="Record audio using the device microphone"
      icon={<Mic size={18} />}
      featureAvailable={featureAvailable}
      platformNotes={
        !featureAvailable
          ? 'MediaRecorder or getUserMedia not available on this platform.'
          : undefined
      }
      permissionState={permissionState}
      onRequestPermission={startRecording}
    >
      {/* Recording controls */}
      {recordingState === 'idle' && (
        <button
          onClick={startRecording}
          className="self-start px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          Start recording
        </button>
      )}

      {recordingState === 'recording' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            {/* Pulsing recording indicator */}
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            <span className="text-sm text-zinc-700 font-medium tabular-nums">{elapsedLabel}</span>
            <span className="text-xs text-zinc-400">/ {MAX_RECORDING_SECONDS}s max</span>
          </div>
          <button
            onClick={stopRecording}
            className="self-start px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
          >
            Stop recording
          </button>
        </div>
      )}

      {recordingState === 'stopped' && audioUrl && (
        <div className="flex flex-col gap-3">
          <audio controls src={audioUrl} className="w-full" />
          <button
            onClick={handleReset}
            className="self-start px-4 py-2 rounded-lg bg-zinc-100 text-zinc-700 text-sm font-medium hover:bg-zinc-200 transition-colors"
          >
            Record again
          </button>
        </div>
      )}

      {/* Format note */}
      {platformNote && <p className="text-xs text-zinc-400">{platformNote}</p>}
      <p className="text-xs text-zinc-400">
        Maximum recording length: {MAX_RECORDING_SECONDS} seconds.
      </p>
    </DemoCard>
  );
}
