/**
 * @file camera-demo.tsx
 *
 * Camera capture PWA demo card.
 *
 * Implements progressive enhancement for camera access:
 *
 * 1. Primary — `<input type="file" capture="environment">`
 *    Works universally (iOS, Android, desktop).  The OS handles permissions
 *    transparently.  Always available since `inputCapture` is always true.
 *
 * 2. Enhancement — `getUserMedia` + canvas
 *    Provides a live preview when getUserMedia is available AND the platform
 *    is not iOS standalone (where WebKit has long-standing reliability bugs).
 *
 * Platform notes
 * ---------------
 * - iOS standalone: getUserMedia is present but unreliable — WebKit bugs cause
 *   the stream to freeze or fail silently.  We fall back to file input only.
 * - iOS Safari (browser tab): both methods available.
 * - Android Chrome: both methods available.
 *
 * Canonical docs
 * ---------------
 * - MediaDevices.getUserMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
 * - HTMLInputElement capture attribute: https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/capture
 * - HTMLCanvasElement.toBlob: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Camera } from 'lucide-react';
import { DemoCard } from '../demo-card';
import { usePlatform } from '../../../hooks/use-platform';

type CaptureMethod = 'file-input' | 'getusermedia';
type PermissionStatus = 'idle' | 'prompt' | 'granted' | 'denied';

/**
 * Camera capture demo card.  Always available (featureAvailable === true)
 * because `<input capture>` is universally supported as the primary method.
 */
export function CameraDemoCard() {
  const { os, isStandalone, supports } = usePlatform();

  // getUserMedia enhancement only available when:
  //   - the API exists, AND
  //   - we're not on iOS standalone (WebKit reliability bugs)
  const canUseGetUserMedia = supports.getUserMedia && !(os === 'ios' && isStandalone);

  const [method, setMethod] = useState<CaptureMethod>('file-input');
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('idle');
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup streams on unmount
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  // Attach stream to video element when available
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // File input handler (primary method)
  const handleFileCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCapturedUrl(url);
  }, []);

  // Start getUserMedia live preview
  const startLivePreview = useCallback(async () => {
    setPermissionStatus('prompt');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setStream(s);
      setPermissionStatus('granted');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setPermissionStatus('denied');
      } else {
        setPermissionStatus('denied');
      }
    }
  }, []);

  // Capture frame from getUserMedia stream via canvas
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setCapturedUrl(url);
      stream?.getTracks().forEach((t) => t.stop());
      setStream(null);
      setPermissionStatus('idle');
    }, 'image/jpeg');
  }, [stream]);

  const handleReset = useCallback(() => {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl(null);
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setPermissionStatus('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [capturedUrl, stream]);

  // Platform note
  const platformNote =
    os === 'ios' && isStandalone
      ? 'getUserMedia is unreliable in installed PWAs due to long-standing WebKit bugs. Using file input capture.'
      : undefined;

  return (
    <DemoCard
      title="Camera"
      description="Capture photos using the device camera"
      icon={<Camera size={18} />}
      featureAvailable={true}
      platformNotes={platformNote}
      permissionState={method === 'getusermedia' && permissionStatus === 'denied' ? 'denied' : null}
      onRequestPermission={startLivePreview}
    >
      {/* Method toggle (only if both methods are available) */}
      {canUseGetUserMedia && !capturedUrl && (
        <div className="flex gap-2">
          {(['file-input', 'getusermedia'] as CaptureMethod[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMethod(m);
                if (stream) {
                  stream.getTracks().forEach((t) => t.stop());
                  setStream(null);
                  setPermissionStatus('idle');
                }
              }}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                method === m
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {m === 'file-input' ? 'File input' : 'Live preview'}
            </button>
          ))}
        </div>
      )}

      {/* Captured photo preview */}
      {capturedUrl ? (
        <div className="flex flex-col gap-3">
          <img
            src={capturedUrl}
            alt="Captured photo"
            className="w-full rounded-lg border border-zinc-200 object-cover max-h-48"
          />
          <button
            onClick={handleReset}
            className="self-start px-4 py-2 rounded-lg bg-zinc-100 text-zinc-700 text-sm font-medium hover:bg-zinc-200 transition-colors"
          >
            Take another
          </button>
        </div>
      ) : method === 'file-input' ? (
        /* File input capture */
        <div className="flex flex-col gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileCapture}
            className="hidden"
            id="camera-file-input"
          />
          <label
            htmlFor="camera-file-input"
            className="self-start px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 cursor-pointer transition-colors"
          >
            Open camera
          </label>
          <p className="text-xs text-zinc-400">Uses native camera app — no permission prompt.</p>
        </div>
      ) : (
        /* getUserMedia live preview */
        <div className="flex flex-col gap-3">
          {permissionStatus === 'idle' && (
            <button
              onClick={startLivePreview}
              className="self-start px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              Start live preview
            </button>
          )}
          {permissionStatus === 'prompt' && (
            <p className="text-xs text-zinc-400">Requesting camera permission…</p>
          )}
          {permissionStatus === 'granted' && stream && (
            <div className="flex flex-col gap-2">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full rounded-lg border border-zinc-200 bg-black"
              />
              <button
                onClick={captureFrame}
                className="self-start px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                Capture
              </button>
            </div>
          )}
          {/* Hidden canvas for frame capture */}
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}
    </DemoCard>
  );
}
