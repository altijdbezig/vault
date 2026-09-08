import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, User } from '@supabase/supabase-js';
import {
  generateKeyPair,
  isUnlocked,
  loadEncryptedPrivateKey,
  lockSession,
  saveEncryptedPrivateKey,
  WrongPassphraseError,
} from '../../lib/crypto';
import { UsernameTakenError } from '../../lib/supabase/errors';
import type { Profile } from '../../types';
import { AuthProvider, useAuth } from '../useAuth';
import type { AuthContextValue } from '../useAuth';

const mocks = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
  },
  profiles: {
    createProfile: vi.fn(),
    getProfile: vi.fn(),
    getProfileByUsername: vi.fn(),
    getPublicKeysForChannel: vi.fn(),
  },
}));

vi.mock('../../lib/supabase/client', () => ({ supabase: { auth: mocks.auth } }));
vi.mock('../../lib/supabase/profiles', () => mocks.profiles);

const PASSWORD = 'een-goed-wachtwoord';

function makeUser(id: string): User {
  return {
    id,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    email: `${id}@example.test`,
  };
}

function makeSession(user: User): Session {
  return {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user,
  };
}

function makeProfile(user: User, fingerprint: string): Profile {
  return {
    id: user.id,
    username: 'benjamin',
    publicKey: 'armored-public-key',
    fingerprint,
  };
}

/** Captures the context so tests can call its methods. */
const auth: { current: AuthContextValue | null } = { current: null };

function Probe() {
  auth.current = useAuth();
  return <span data-testid="status">{auth.current.status}</span>;
}

function renderAuth() {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

function status(): string {
  return screen.getByTestId('status').textContent ?? '';
}

// No globals: true, so Testing Library's auto cleanup is not registered.
afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  lockSession();
  auth.current = null;

  mocks.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  mocks.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.auth.signOut.mockResolvedValue({ error: null });
  mocks.profiles.getProfile.mockResolvedValue(null);
  mocks.profiles.getProfileByUsername.mockResolvedValue(null);
});

describe('auth status', () => {
  it('is signed-out without a Supabase session', async () => {
    renderAuth();

    await waitFor(() => expect(status()).toBe('signed-out'));
    expect(isUnlocked()).toBe(false);
  });

  it('is locked with a session but no key in memory, and unlocks with the password', async () => {
    const user = makeUser('user-locked');
    const pair = await generateKeyPair({ username: 'benjamin', passphrase: PASSWORD });
    await saveEncryptedPrivateKey(user.id, pair.privateKeyArmored);

    mocks.auth.getSession.mockResolvedValue({
      data: { session: makeSession(user) },
      error: null,
    });
    mocks.profiles.getProfile.mockResolvedValue(makeProfile(user, pair.fingerprint));

    renderAuth();

    // This is the post-refresh state: still signed in, key gone from memory.
    await waitFor(() => expect(status()).toBe('locked'));
    expect(auth.current?.needsKeyImport).toBe(false);

    await act(async () => {
      await auth.current?.unlock(PASSWORD);
    });

    expect(status()).toBe('unlocked');
    expect(isUnlocked()).toBe(true);
  });

  it('is locked and asks for an import when this device has no key', async () => {
    const user = makeUser('user-new-device');
    mocks.auth.getSession.mockResolvedValue({
      data: { session: makeSession(user) },
      error: null,
    });

    renderAuth();

    await waitFor(() => expect(status()).toBe('locked'));
    expect(auth.current?.needsKeyImport).toBe(true);
  });

  it('is unlocked after signing out and back in is not needed: signOut returns to signed-out', async () => {
    const user = makeUser('user-signout');
    const pair = await generateKeyPair({ username: 'benjamin', passphrase: PASSWORD });
    await saveEncryptedPrivateKey(user.id, pair.privateKeyArmored);

    mocks.auth.getSession.mockResolvedValue({
      data: { session: makeSession(user) },
      error: null,
    });
    mocks.profiles.getProfile.mockResolvedValue(makeProfile(user, pair.fingerprint));

    renderAuth();
    await waitFor(() => expect(status()).toBe('locked'));

    await act(async () => {
      await auth.current?.unlock(PASSWORD);
    });
    expect(status()).toBe('unlocked');

    await act(async () => {
      await auth.current?.signOut();
    });

    expect(status()).toBe('signed-out');
    // The key must be gone from memory, not just from the UI.
    expect(isUnlocked()).toBe(false);
  });
});

describe('unlock', () => {
  it('throws WrongPassphraseError on the wrong password and stays locked', async () => {
    const user = makeUser('user-wrong-pw');
    const pair = await generateKeyPair({ username: 'benjamin', passphrase: PASSWORD });
    await saveEncryptedPrivateKey(user.id, pair.privateKeyArmored);

    mocks.auth.getSession.mockResolvedValue({
      data: { session: makeSession(user) },
      error: null,
    });
    mocks.profiles.getProfile.mockResolvedValue(makeProfile(user, pair.fingerprint));

    renderAuth();
    await waitFor(() => expect(status()).toBe('locked'));

    await act(async () => {
      await expect(auth.current?.unlock('fout-wachtwoord')).rejects.toThrow(WrongPassphraseError);
    });

    expect(status()).toBe('locked');
    expect(isUnlocked()).toBe(false);
  });
});

describe('signUp', () => {
  it('generates a key, stores it and ends up unlocked', async () => {
    const user = makeUser('user-signup-ok');
    mocks.auth.signUp.mockResolvedValue({
      data: { user, session: makeSession(user) },
      error: null,
    });
    mocks.profiles.createProfile.mockImplementation(
      async (input: { id: string; username: string; publicKey: string; fingerprint: string }) => ({
        id: input.id,
        username: input.username,
        publicKey: input.publicKey,
        fingerprint: input.fingerprint,
      }),
    );

    renderAuth();
    await waitFor(() => expect(status()).toBe('signed-out'));

    await act(async () => {
      await auth.current?.signUp('benjamin@example.test', PASSWORD, 'benjamin');
    });

    expect(status()).toBe('unlocked');
    expect(isUnlocked()).toBe(true);
    expect(await loadEncryptedPrivateKey(user.id)).toContain('BEGIN PGP PRIVATE KEY BLOCK');

    // The public key goes to the server, the private key never does.
    const created = mocks.profiles.createProfile.mock.calls[0]?.[0] as { publicKey: string };
    expect(created.publicKey).toContain('BEGIN PGP PUBLIC KEY BLOCK');
    expect(created.publicKey).not.toContain('PRIVATE');
  });

  it('rolls the stored key back when the username turns out to be taken', async () => {
    const user = makeUser('user-signup-race');
    mocks.auth.signUp.mockResolvedValue({
      data: { user, session: makeSession(user) },
      error: null,
    });
    // The client-side check passes, but another account wins the race and the
    // unique constraint fires.
    mocks.profiles.createProfile.mockRejectedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint "profiles_username_key"',
    });

    renderAuth();
    await waitFor(() => expect(status()).toBe('signed-out'));

    await act(async () => {
      await expect(
        auth.current?.signUp('benjamin@example.test', PASSWORD, 'benjamin'),
      ).rejects.toThrow(UsernameTakenError);
    });

    // No orphaned key: otherwise this device holds a key for an account
    // without a profile row, and the user is stuck.
    expect(await loadEncryptedPrivateKey(user.id)).toBeNull();
    expect(isUnlocked()).toBe(false);
    expect(status()).toBe('signed-out');
  });

  it('refuses a username that is already taken before touching auth', async () => {
    const user = makeUser('user-taken');
    mocks.profiles.getProfileByUsername.mockResolvedValue(makeProfile(user, 'abcd'));

    renderAuth();
    await waitFor(() => expect(status()).toBe('signed-out'));

    await act(async () => {
      await expect(
        auth.current?.signUp('benjamin@example.test', PASSWORD, 'benjamin'),
      ).rejects.toThrow(UsernameTakenError);
    });

    expect(mocks.auth.signUp).not.toHaveBeenCalled();
  });
});

describe('importKey', () => {
  it('stores and unlocks a key imported on a new device', async () => {
    const user = makeUser('user-import');
    const pair = await generateKeyPair({ username: 'benjamin', passphrase: PASSWORD });

    mocks.auth.getSession.mockResolvedValue({
      data: { session: makeSession(user) },
      error: null,
    });
    mocks.profiles.getProfile.mockResolvedValue(makeProfile(user, pair.fingerprint));

    renderAuth();
    await waitFor(() => expect(status()).toBe('locked'));
    expect(auth.current?.needsKeyImport).toBe(true);

    await act(async () => {
      await auth.current?.importKey(pair.privateKeyArmored, PASSWORD);
    });

    expect(status()).toBe('unlocked');
    // Stored trimmed: pasted key blocks tend to carry stray whitespace.
    expect(await loadEncryptedPrivateKey(user.id)).toBe(pair.privateKeyArmored.trim());
  });

  it('never stores a key it could not unlock', async () => {
    const user = makeUser('user-import-bad-pw');
    const pair = await generateKeyPair({ username: 'benjamin', passphrase: PASSWORD });

    mocks.auth.getSession.mockResolvedValue({
      data: { session: makeSession(user) },
      error: null,
    });
    mocks.profiles.getProfile.mockResolvedValue(makeProfile(user, pair.fingerprint));

    renderAuth();
    await waitFor(() => expect(status()).toBe('locked'));

    await act(async () => {
      await expect(
        auth.current?.importKey(pair.privateKeyArmored, 'fout-wachtwoord'),
      ).rejects.toThrow(WrongPassphraseError);
    });

    expect(await loadEncryptedPrivateKey(user.id)).toBeNull();
    expect(status()).toBe('locked');
  });
});
