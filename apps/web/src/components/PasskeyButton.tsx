/**
 * PasskeyButton — React component for passkey registration and authentication.
 *
 * Uses @simplewebauthn/browser to drive the WebAuthn ceremonies in the browser.
 *
 * Register flow:
 *   1. Call /api/auth/passkey/register/begin with the authenticated userId
 *   2. Pass options to startRegistration() (browser calls the authenticator)
 *   3. POST result to /api/auth/passkey/register/complete
 *
 * Login flow:
 *   1. Call /api/auth/passkey/login/begin
 *   2. Pass options to startAuthentication() (browser calls the authenticator)
 *   3. POST result to /api/auth/passkey/login/complete — receives a session cookie
 */

import React, { useState } from 'react';
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import type { User } from '../context/AuthContext';

// ---- Passkey Registration -----------------------------------------------

interface RegisterPasskeyButtonProps {
  /** The authenticated user who is adding a passkey to their account. */
  userId: string;
  onSuccess?: () => void;
  onError?: (err: string) => void;
}

export const RegisterPasskeyButton: React.FC<RegisterPasskeyButtonProps> = ({
  userId,
  onSuccess,
  onError,
}) => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  if (!browserSupportsWebAuthn()) {
    return <p className="text-sm text-zinc-400">This browser does not support passkeys.</p>;
  }

  const handleRegister = async () => {
    setLoading(true);
    setMessage('');
    try {
      // Step 1: fetch registration options from server
      const beginRes = await fetch('/api/auth/passkey/register/begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId }),
      });

      if (!beginRes.ok) {
        const err = await beginRes.json();
        throw new Error(err.error ?? 'Failed to begin passkey registration');
      }

      const options = await beginRes.json();

      // Step 2: invoke the browser authenticator
      const registrationResponse = await startRegistration({ optionsJSON: options });

      // Step 3: send response to server for verification and storage
      const completeRes = await fetch('/api/auth/passkey/register/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId, response: registrationResponse }),
      });

      if (!completeRes.ok) {
        const err = await completeRes.json();
        throw new Error(err.error ?? 'Failed to complete passkey registration');
      }

      setMessage('Passkey registered successfully.');
      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Passkey registration failed';
      setMessage(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleRegister}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-zinc-300 rounded-lg text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50"
      >
        <PasskeyIcon />
        {loading ? 'Registering passkey…' : 'Add a passkey to this account'}
      </button>
      {message && <p className="text-xs text-center text-zinc-500">{message}</p>}
    </div>
  );
};

// ---- Passkey Login -------------------------------------------------------

interface PasskeyLoginButtonProps {
  /** Called with the user payload returned by login/complete. */
  onSuccess: (user: User) => void;
  onError?: (err: string) => void;
}

export const PasskeyLoginButton: React.FC<PasskeyLoginButtonProps> = ({ onSuccess, onError }) => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  if (!browserSupportsWebAuthn()) {
    return null;
  }

  const handleLogin = async () => {
    setLoading(true);
    setMessage('');
    try {
      // Step 1: fetch authentication options from server
      const beginRes = await fetch('/api/auth/passkey/login/begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });

      if (!beginRes.ok) {
        const err = await beginRes.json();
        throw new Error(err.error ?? 'Failed to begin passkey login');
      }

      const options = await beginRes.json();

      // Step 2: invoke the browser authenticator
      const authenticationResponse = await startAuthentication({ optionsJSON: options });

      // Step 3: send response to server for verification
      const completeRes = await fetch('/api/auth/passkey/login/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ response: authenticationResponse }),
      });

      if (!completeRes.ok) {
        const err = await completeRes.json();
        throw new Error(err.error ?? 'Passkey authentication failed');
      }

      const data = await completeRes.json();
      onSuccess(data.user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Passkey login failed';
      setMessage(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleLogin}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-zinc-300 rounded-lg text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50"
      >
        <PasskeyIcon />
        {loading ? 'Authenticating with passkey…' : 'Sign in with a passkey'}
      </button>
      {message && <p className="text-xs text-center text-red-500">{message}</p>}
    </div>
  );
};

// ---- Shared icon ---------------------------------------------------------

function PasskeyIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Simple key icon as passkey indicator */}
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2L13 10" />
      <path d="M14.5 8.5l-2 2" />
      <path d="M17 6l1 1" />
    </svg>
  );
}
