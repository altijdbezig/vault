import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  clearVerifiedFingerprint,
  listVerifiedFingerprints,
  setVerifiedFingerprint,
} from '../lib/crypto';
import type { TrustRecord } from '../lib/crypto';
import { useAuth } from './useAuth';

/**
 * What we know about somebody's key.
 *
 * - unverified: never compared. The normal state, and not an alarm.
 * - verified:   compared by hand, and the key is still the same one.
 * - changed:    compared by hand, and the key is NOT the same one any more.
 *
 * That last state is the only alarm in this application that can catch an
 * actual attack. Everything else the UI warns about (a member without a key,
 * an unreadable backlog, a dropped socket) is expected behaviour explained
 * politely. This one means: either that person reinstalled and lost their key,
 * or somebody swapped it, and you cannot tell which from in here.
 */
export type VerificationStatus = 'unverified' | 'verified' | 'changed';

export interface VerificationContextValue {
  /** Compares a current fingerprint against what was verified before. */
  statusFor(userId: string, fingerprint: string | null): VerificationStatus;
  /** The fingerprint that was confirmed earlier, for showing the difference. */
  verifiedFingerprint(userId: string): string | null;
  /** Records a verification. Call only after the user says they compared it. */
  verify(userId: string, fingerprint: string): Promise<void>;
  /** Forgets a verification. */
  unverify(userId: string): Promise<void>;
  /** True while the store is being read; renders as unverified in the meantime. */
  loading: boolean;
}

const VerificationContext = createContext<VerificationContextValue | null>(null);

/**
 * Which contacts the user has verified, from IndexedDB.
 *
 * App-wide because the answer is needed in three places at once (the member
 * list, a profile card, the conversation header) and reading IndexedDB per row
 * would be absurd. Loaded once per session and kept in memory.
 */
export function VerificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const ownerId = user?.id ?? null;

  const [records, setRecords] = useState<Record<string, TrustRecord>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ownerId) {
      setRecords({});
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const stored = await listVerifiedFingerprints(ownerId);
        if (cancelled) {
          return;
        }
        setRecords(Object.fromEntries(stored.map((record) => [record.subjectId, record])));
      } catch (caught) {
        // A blocked or broken IndexedDB means everyone reads as unverified.
        // That is the safe direction to fail: it under-claims trust rather
        // than over-claiming it.
        console.error('Kon geverifieerde sleutels niet laden:', caught);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  const statusFor = useCallback(
    (userId: string, fingerprint: string | null): VerificationStatus => {
      const record = records[userId];
      if (!record) {
        return 'unverified';
      }
      // No current fingerprint to compare against (a half-created profile).
      // Not 'changed': there is nothing to be alarmed about yet.
      if (!fingerprint) {
        return 'unverified';
      }
      return record.fingerprint === fingerprint.toLowerCase() ? 'verified' : 'changed';
    },
    [records],
  );

  const verifiedFingerprint = useCallback(
    (userId: string): string | null => records[userId]?.fingerprint ?? null,
    [records],
  );

  const verify = useCallback(
    async (userId: string, fingerprint: string): Promise<void> => {
      if (!ownerId) {
        return;
      }
      await setVerifiedFingerprint(ownerId, userId, fingerprint);
      setRecords((current) => ({
        ...current,
        [userId]: {
          id: `${ownerId}:${userId}`,
          ownerId,
          subjectId: userId,
          fingerprint: fingerprint.toLowerCase(),
          verifiedAt: Date.now(),
        },
      }));
    },
    [ownerId],
  );

  const unverify = useCallback(
    async (userId: string): Promise<void> => {
      if (!ownerId) {
        return;
      }
      await clearVerifiedFingerprint(ownerId, userId);
      setRecords((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });
    },
    [ownerId],
  );

  const value = useMemo<VerificationContextValue>(
    () => ({ statusFor, verifiedFingerprint, verify, unverify, loading }),
    [statusFor, verifiedFingerprint, verify, unverify, loading],
  );

  return (
    <VerificationContext.Provider value={value}>{children}</VerificationContext.Provider>
  );
}

/**
 * Verification state, with a safe fallback outside the provider.
 *
 * Falls back to "nothing is verified" rather than throwing, so a component
 * mounted on its own in a test does not crash — and, more importantly, so a
 * missing provider can never make something read as verified when it is not.
 */
export function useVerification(): VerificationContextValue {
  const context = useContext(VerificationContext);
  if (context) {
    return context;
  }

  return {
    statusFor: () => 'unverified',
    verifiedFingerprint: () => null,
    verify: async () => undefined,
    unverify: async () => undefined,
    loading: false,
  };
}
