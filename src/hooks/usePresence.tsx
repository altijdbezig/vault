import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { trackPresence } from '../lib/supabase/presence';
import { useAuth } from './useAuth';

export interface PresenceContextValue {
  isOnline(userId: string): boolean;
  /** True when at least one of these people is online, ignoring yourself. */
  anyOnline(userIds: string[]): boolean;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

/**
 * Online status for the whole app.
 *
 * Tracked in exactly one place. Presence per channel would mean joining and
 * leaving a room on every channel switch, and the same person would flicker in
 * and out for everyone else while you clicked around.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [online, setOnline] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!userId) {
      setOnline(new Set());
      return;
    }

    const untrack = trackPresence(userId, (onlineUserIds) => {
      setOnline(new Set(onlineUserIds));
    });

    return untrack;
  }, [userId]);

  const value = useMemo<PresenceContextValue>(
    () => ({
      isOnline: (id: string) => online.has(id),
      anyOnline: (ids: string[]) => ids.some((id) => id !== userId && online.has(id)),
    }),
    [online, userId],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence(): PresenceContextValue {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error('usePresence moet binnen een <PresenceProvider> gebruikt worden.');
  }
  return context;
}
