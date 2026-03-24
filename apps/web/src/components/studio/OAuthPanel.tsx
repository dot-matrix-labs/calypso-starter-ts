import React, { useState, useEffect } from 'react';
import { Link, Unlink, Copy, Check, AlertCircle } from 'lucide-react';

interface OAuthPanelProps {
  /** Base URL for API calls; defaults to empty string (same origin) */
  baseUrl?: string;
}

interface OAuthStatus {
  connected: boolean;
}

export function OAuthPanel({ baseUrl = '' }: OAuthPanelProps) {
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [confirmationCode, setConfirmationCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    try {
      const res = await fetch(`${baseUrl}/api/auth/oauth/status`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = (await res.json()) as OAuthStatus;
        setStatus(data);
      }
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }

  async function initiateOAuth() {
    setError(null);
    setOauthUrl(null);
    try {
      const res = await fetch(`${baseUrl}/api/auth/oauth/init`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'Failed to initiate OAuth');
        return;
      }
      const data = (await res.json()) as { url: string };
      setOauthUrl(data.url);
    } catch {
      setError('Failed to connect. Please try again.');
    }
  }

  async function completeOAuth() {
    if (!confirmationCode.trim()) {
      setError('Please enter the confirmation code');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${baseUrl}/api/auth/oauth/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: confirmationCode.trim() }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'Failed to complete authentication');
        return;
      }

      setSuccess(true);
      setOauthUrl(null);
      setConfirmationCode('');
      await checkStatus();
    } catch {
      setError('Failed to complete authentication. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function copyToClipboard() {
    if (oauthUrl) {
      navigator.clipboard.writeText(oauthUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (loading) {
    return null;
  }

  if (success) {
    return (
      <div className="px-4 py-3 border-b border-zinc-700 bg-green-900/20">
        <div className="flex items-center gap-2 text-green-400 text-sm">
          <Check size={16} />
          <span>Claude Code connected successfully!</span>
        </div>
      </div>
    );
  }

  if (status?.connected) {
    return (
      <div className="px-4 py-3 border-b border-zinc-700 bg-zinc-800/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <Link size={16} />
            <span>Claude Code Connected</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-b border-zinc-700 bg-zinc-800/50">
      {error && (
        <div className="mb-3 flex items-center gap-2 text-red-400 text-xs bg-red-900/20 px-3 py-2 rounded-lg">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {!oauthUrl ? (
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">Connect Claude Code</span>
          <button
            type="button"
            onClick={initiateOAuth}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
          >
            <Unlink size={14} />
            Connect
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-zinc-400">
            <p className="font-medium text-zinc-300 mb-1">Authorization URL:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[10px] bg-zinc-900 px-2 py-1.5 rounded break-all">
                {oauthUrl}
              </code>
              <button
                type="button"
                onClick={copyToClipboard}
                className="p-1.5 bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
                aria-label="Copy URL"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </div>

          <div className="text-xs text-zinc-400">
            <p className="font-medium text-zinc-300 mb-1">
              After authenticating, paste the confirmation code below:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={confirmationCode}
                onChange={(e) => setConfirmationCode(e.target.value)}
                placeholder="Confirmation code"
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={completeOAuth}
                disabled={submitting}
                className="px-3 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {submitting ? 'Connecting...' : 'Submit'}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOauthUrl(null)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
