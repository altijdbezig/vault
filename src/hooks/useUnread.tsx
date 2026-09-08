import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { subscribeToAllMessages } from '../lib/supabase/messages';
import { countsAsUnread, fetchUnreadState, markChannelRead } from '../lib/supabase/unread';
import type { MessageRow } from '../types';
import { useAuth } from './useAuth';

export interface UnreadContextValue {
  /** Unread messages per channel, never counting your own. */
  counts: Record<string, number>;
  /** True when anything inside this server is unread. */
  serverHasUnread(serverId: string): boolean;
  /** Tells the provider which channel is on screen. */
  setActiveChannel(channelId: string | null): void;
}

const UnreadContext = createContext<UnreadContextValue | null>(null);

/**
 * Writing the read marker is a database write, so it is debounced.
 *
 * Long enough that opening three channels in a row is three writes and not
 * thirty; short enough that switching away and back does not resurrect a badge
 * you just cleared.
 */
const MARK_READ_DELAY_MS = 800;

function isWindowFocused(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  // hasFocus covers a background window; visibilityState covers a background
  // tab and a phone with the screen off.
  return document.visibilityState === 'visible' && document.hasFocus();
}

/**
 * Unread counts for every channel, in one place.
 *
 * Deliberately app-wide. Counting per channel would mean a subscription per
 * channel, and that does not scale past a handful of conversations; this keeps
 * exactly one subscription open no matter how many channels you are in.
 */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [channelServers, setChannelServers] = useState<Record<string, string | null>>({});
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [focused, setFocused] = useState(isWindowFocused);
  /** Bumped whenever the read marker needs to move; see the effect below. */
  const [readNonce, setReadNonce] = useState(0);

  // Read by the subscription callback, which is created once and must not
  // capture a stale active channel.
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeChannelId;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const refresh = useCallback(async (): Promise<void> => {
    if (!userId) {
      return;
    }
    try {
      const state = await fetchUnreadState();
      setCounts(state.counts);
      setChannelServers(state.channelServers);
    } catch (caught) {
      // A missing badge is not worth an error screen.
      console.error('Kon ongelezen berichten niet tellen:', caught);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function update(): void {
      setFocused(isWindowFocused());
    }

    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);

    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  // The one subscription. Everything that is not the channel you are looking
  // at bumps a counter; the channel you are looking at is marked read below.
  useEffect(() => {
    if (!userId) {
      return;
    }

    const unsubscribe = subscribeToAllMessages((row: MessageRow) => {
      if (!countsAsUnread(row, userId, undefined)) {
        return;
      }
      if (row.channel_id === activeRef.current && focusedRef.current) {
        // Already on screen: instead of a badge, move the read marker past it.
        setReadNonce((nonce) => nonce + 1);
        return;
      }
      setCounts((current) => ({
        ...current,
        [row.channel_id]: (current[row.channel_id] ?? 0) + 1,
      }));
    });

    return unsubscribe;
  }, [userId]);

  // Mark the open, focused channel read. Debounced: this is a write.
  useEffect(() => {
    if (!activeChannelId || !focused || !userId) {
      return;
    }

    const timer = setTimeout(() => {
      const at = new Date().toISOString();
      setCounts((current) =>
        current[activeChannelId] ? { ...current, [activeChannelId]: 0 } : current,
      );
      void markChannelRead(activeChannelId, at).catch((caught: unknown) => {
        console.error('Kon leesstatus niet bijwerken:', caught);
      });
    }, MARK_READ_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
    // readNonce, not counts: zeroing the count here would otherwise re-trigger
    // this effect and write the marker a second time for nothing. The nonce is
    // bumped only by something that actually needs a new marker.
  }, [activeChannelId, focused, userId, readNonce]);

  const serverHasUnread = useCallback(
    (serverId: string): boolean =>
      Object.entries(counts).some(
        ([channelId, count]) => count > 0 && channelServers[channelId] === serverId,
      ),
    [counts, channelServers],
  );

  const setActiveChannel = useCallback((channelId: string | null): void => {
    setActiveChannelId(channelId);
  }, []);

  const value = useMemo<UnreadContextValue>(
    () => ({ counts, serverHasUnread, setActiveChannel }),
    [counts, serverHasUnread, setActiveChannel],
  );

  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export function useUnread(): UnreadContextValue {
  const context = useContext(UnreadContext);
  if (!context) {
    throw new Error('useUnread moet binnen een <UnreadProvider> gebruikt worden.');
  }
  return context;
}
