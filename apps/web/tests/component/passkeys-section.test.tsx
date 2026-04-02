import React from 'react';
import { render } from 'vitest-browser-react';
import { commands } from '@vitest/browser/context';
import { afterEach, expect, test } from 'vitest';
import { PasskeysSection } from '../../src/pages/settings';

type FixturePasskeyCredential = {
  id: string;
  credential_id: string;
  created_at: string;
  last_used_at: string | null;
};

async function setPasskeysFixture(passkeys: FixturePasskeyCredential[]) {
  await commands.setFixtureState({
    state: {
      passkeys,
    },
  });
}

afterEach(async () => {
  await commands.resetFixtureState({ fixtureId: 'default' });
});

test('renders empty state when no passkeys exist', async () => {
  await setPasskeysFixture([]);
  const screen = render(<PasskeysSection userId="user-1" />);
  await expect.element(screen.getByText('No passkeys registered yet.')).toBeVisible();
});

test('renders passkey rows with truncated credential IDs', async () => {
  await setPasskeysFixture([
    {
      id: 'cred-1',
      credential_id: 'abcdefghijklmnopqrstuvwx',
      created_at: '2026-03-01T12:00:00.000Z',
      last_used_at: '2026-03-02T12:00:00.000Z',
    },
  ]);

  const screen = render(<PasskeysSection userId="user-1" />);
  await expect.element(screen.getByText('abcdefghijklmnop')).toBeVisible();
  await expect.element(screen.getByRole('button', { name: 'Remove' })).toBeVisible();
});

test('remove button deletes a passkey row', async () => {
  await setPasskeysFixture([
    {
      id: 'cred-1',
      credential_id: 'abcdefghijklmnopqrstuvwx',
      created_at: '2026-03-01T12:00:00.000Z',
      last_used_at: '2026-03-02T12:00:00.000Z',
    },
  ]);

  const screen = render(<PasskeysSection userId="user-1" />);
  await expect.element(screen.getByText('abcdefghijklmnop')).toBeVisible();
  await screen.getByRole('button', { name: 'Remove' }).click();
  await expect.element(screen.getByText('No passkeys registered yet.')).toBeVisible();
});

test('register success refreshes the passkey list', async () => {
  const existing = [
    {
      id: 'cred-1',
      credential_id: 'abcdefghijklmnopqrstuvwx',
      created_at: '2026-03-01T12:00:00.000Z',
      last_used_at: '2026-03-02T12:00:00.000Z',
    },
  ];
  await setPasskeysFixture(existing);

  const screen = render(
    <PasskeysSection
      userId="user-1"
      renderRegisterButton={(onSuccess) => (
        <button
          type="button"
          onClick={async () => {
            await setPasskeysFixture([
              ...existing,
              {
                id: 'cred-2',
                credential_id: 'zyxwvutsrqponmlkjihgfedc',
                created_at: '2026-03-03T12:00:00.000Z',
                last_used_at: null,
              },
            ]);
            onSuccess();
          }}
        >
          Simulate register success
        </button>
      )}
    />,
  );

  await expect.element(screen.getByText('abcdefghijklmnop')).toBeVisible();
  await screen.getByRole('button', { name: 'Simulate register success' }).click();
  await expect.element(screen.getByText('zyxwvutsrqponmlk')).toBeVisible();
});
