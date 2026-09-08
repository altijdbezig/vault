import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  clearStoredKey,
  generateKeyPair,
  getFingerprint,
  isUnlocked,
  loadEncryptedPrivateKey,
  lockSession,
  saveEncryptedPrivateKey,
  setUnlockedKey,
  unlockPrivateKey,
} from '../lib/crypto';
import { supabase } from '../lib/supabase/client';
import { isUniqueViolation, UsernameTakenError } from '../lib/supabase/errors';
import { createProfile, getProfile, getProfileByUsername } from '../lib/supabase/profiles';
import type { Profile } from '../types';

/**
 * Three states, not two.
 *
 * Supabase keeps its session in localStorage, but the unlocked private key
 * only ever lives in memory. After a page refresh the user is therefore still
 * signed in but locked, and only has to re-enter their password.
 */
export type AuthStatus = 'loading' | 'signed-out' | 'locked' | 'unlocked';

/**
 * The PGP passphrase is the account password: the user types one secret.
 * Supabase only ever sees the bcrypt hash; the plaintext stays in the client
 * to unlock the key.
 *
 * TODO: changing the password must re-encrypt the private key with the new
 * password (unlock with the old one, re-encrypt with the new one, store it
 * again with saveEncryptedPrivateKey). Without that step the stored key stays
 * encrypted under the old password and becomes unusable. Not built yet, so do
 * not ship a password-change screen before it exists.
 */
export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  profile: Profile | null;
  /** True when this device has no stored key, so unlocking means importing one. */
  needsKeyImport: boolean;
  signUp(email: string, password: string, username: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  /** Drops the key from memory and returns to the unlock screen. */
  lock(): void;
  signOut(): Promise<void>;
  importKey(armored: string, password: string): Promise<void>;
  /** Returns the stored, still passphrase-encrypted key, for backup export. */
  exportEncryptedKey(): Promise<string>;
}

/** The imported key does not belong to this account's public key. */
export class KeyMismatchError extends Error {
  constructor() {
    super(
      'Deze sleutel hoort niet bij dit account. Controleer of je het juiste ' +
        'back-upbestand hebt gekozen.',
    );
    this.name = 'KeyMismatchError';
  }
}

/** No stored key on this device, so there is nothing to unlock. */
export class NoStoredKeyError extends Error {
  constructor() {
    super('Op dit apparaat staat geen sleutel. Importeer je back-upbestand.');
    this.name = 'NoStoredKeyError';
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [needsKeyImport, setNeedsKeyImport] = useState(false);

  // Note what is NOT in this state: the unlocked PrivateKey. It lives only in
  // the module scope of lib/crypto/storage.ts, out of reach of React devtools.

  /** Loads everything we can know about a session without the password. */
  const adoptSession = useCallback(async (sessionUser: User): Promise<void> => {
    const [existingProfile, storedKey] = await Promise.all([
      getProfile(sessionUser.id),
      loadEncryptedPrivateKey(sessionUser.id),
    ]);

    setUser(sessionUser);
    setProfile(existingProfile);
    setNeedsKeyImport(storedKey === null);
    setStatus(isUnlocked() ? 'unlocked' : 'locked');
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) {
        return;
      }
      if (!data.session) {
        setStatus('signed-out');
        return;
      }
      await adoptSession(data.session.user);
    })();

    // Only react to sign-outs from elsewhere (expired refresh token, another
    // tab). Sign-ins are driven by our own methods, which know the password.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        lockSession();
        setUser(null);
        setProfile(null);
        setNeedsKeyImport(false);
        setStatus('signed-out');
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [adoptSession]);

  const signUp = useCallback(
    async (email: string, password: string, username: string): Promise<void> => {
      // Cheap pre-check so the rollback path below is rarely hit. It is a race,
      // not a guarantee: the unique constraint is the real check.
      if (await getProfileByUsername(username)) {
        throw new UsernameTakenError();
      }

      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        throw error;
      }
      const newUser = data.user;
      if (!newUser) {
        throw new Error('Registratie is mislukt: geen gebruiker teruggekregen.');
      }

      const pair = await generateKeyPair({ username, passphrase: password });
      await saveEncryptedPrivateKey(newUser.id, pair.privateKeyArmored);

      let createdProfile: Profile;
      try {
        createdProfile = await createProfile({
          id: newUser.id,
          username,
          publicKey: pair.publicKeyArmored,
          fingerprint: pair.fingerprint,
        });
      } catch (profileError) {
        // Without this cleanup the device keeps a key for an account that has
        // no profile row, and the user is stuck for good.
        await clearStoredKey(newUser.id);
        if (isUniqueViolation(profileError)) {
          throw new UsernameTakenError();
        }
        throw profileError;
      }

      setUnlockedKey(await unlockPrivateKey(pair.privateKeyArmored, password));
      setUser(newUser);
      setProfile(createdProfile);
      setNeedsKeyImport(false);
      setStatus('unlocked');
    },
    [],
  );

  /** Loads the stored key, unlocks it and moves to 'unlocked'. */
  const unlockFor = useCallback(async (sessionUser: User, password: string): Promise<void> => {
    const armored = await loadEncryptedPrivateKey(sessionUser.id);
    if (armored === null) {
      setNeedsKeyImport(true);
      setStatus('locked');
      throw new NoStoredKeyError();
    }

    const key = await unlockPrivateKey(armored, password);
    setUnlockedKey(key);

    setProfile(await getProfile(sessionUser.id));
    setNeedsKeyImport(false);
    setStatus('unlocked');
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw error;
      }

      setUser(data.user);

      const armored = await loadEncryptedPrivateKey(data.user.id);
      if (armored === null) {
        // New device: signed in, but no key here to decrypt anything with.
        setProfile(await getProfile(data.user.id));
        setNeedsKeyImport(true);
        setStatus('locked');
        return;
      }

      await unlockFor(data.user, password);
    },
    [unlockFor],
  );

  const unlock = useCallback(
    async (password: string): Promise<void> => {
      if (!user) {
        throw new Error('Geen actieve sessie om te ontgrendelen.');
      }
      await unlockFor(user, password);
    },
    [unlockFor, user],
  );

  const importKey = useCallback(
    async (armored: string, password: string): Promise<void> => {
      if (!user) {
        throw new Error('Geen actieve sessie om een sleutel in te importeren.');
      }

      // Unlock first: never store a key we could not open.
      const trimmed = armored.trim();
      const key = await unlockPrivateKey(trimmed, password);

      const expected = profile?.fingerprint ?? (await getProfile(user.id))?.fingerprint;
      if (expected && getFingerprint(key) !== expected) {
        throw new KeyMismatchError();
      }

      await saveEncryptedPrivateKey(user.id, trimmed);
      setUnlockedKey(key);

      setProfile(await getProfile(user.id));
      setNeedsKeyImport(false);
      setStatus('unlocked');
    },
    [profile, user],
  );

  const lock = useCallback((): void => {
    lockSession();
    setStatus('locked');
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    // Drop the key from memory before anything else can fail.
    lockSession();
    const { error } = await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setNeedsKeyImport(false);
    setStatus('signed-out');
    if (error) {
      throw error;
    }
  }, []);

  const exportEncryptedKey = useCallback(async (): Promise<string> => {
    if (!user) {
      throw new Error('Geen actieve sessie om een sleutel uit te exporteren.');
    }
    const armored = await loadEncryptedPrivateKey(user.id);
    if (armored === null) {
      throw new NoStoredKeyError();
    }
    return armored;
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      profile,
      needsKeyImport,
      signUp,
      signIn,
      unlock,
      lock,
      signOut,
      importKey,
      exportEncryptedKey,
    }),
    [
      status,
      user,
      profile,
      needsKeyImport,
      signUp,
      signIn,
      unlock,
      lock,
      signOut,
      importKey,
      exportEncryptedKey,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth moet binnen een <AuthProvider> gebruikt worden.');
  }
  return context;
}
