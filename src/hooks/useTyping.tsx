import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trackTyping, TYPING_TIMEOUT_MS } from '../lib/supabase/typing';
import type { TypingChannel } from '../lib/supabase/typing';
import { useAuth } from './useAuth';
import { useSettings } from './useSettings';

export interface UseTypingResult {
  /** Display names of the people typing right now, yourself excluded. */
  typing: string[];
  /** Call on every keystroke. Throttled downstream. */
  announce(): void;
  /** Call when the message is sent or the box is cleared. */
  stop(): void;
}

interface Entry {
  username: string;
  at: number;
}

/**
 * Who is typing in this channel.
 *
 * The list is pruned on a timer rather than trusting a "stopped" broadcast to
 * arrive: a tab that gets closed mid-sentence never sends one, and without the
 * timer that person stays "typing" for the rest of the session.
 *
 * @param ownUsername Used in the broadcast so others do not have to resolve
 *   the id against a member list they may not have.
 */
export function useTyping(
  channelId: string | null,
  ownUsername: string | null,
): UseTypingResult {
  const { user } = useAuth();
  const { settings } = useSettings();
  const userId = user?.id ?? null;

  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const channelRef = useRef<TypingChannel | null>(null);

  const enabled = settings.typingIndicator;

  useEffect(() => {
    setEntries({});

    if (!channelId || !userId || !ownUsername) {
      return;
    }

    /*
     * The setting switches off both halves.
     *
     * Not subscribing when it is off is the point: "I do not broadcast that I
     * am typing, but I do watch you" is a one-way mirror, and a privacy
     * setting that only works in one direction is worse than not having it.
     * So with the setting off we do not join the room at all.
     */
    if (!enabled) {
      channelRef.current = null;
      return;
    }

    const channel = trackTyping(channelId, userId, ownUsername, (payload) => {
      setEntries((current) => {
        if (!payload.typing) {
          if (!(payload.userId in current)) {
            return current;
          }
          const next = { ...current };
          delete next[payload.userId];
          return next;
        }
        return {
          ...current,
          [payload.userId]: { username: payload.username, at: Date.now() },
        };
      });
    });

    channelRef.current = channel;

    // Prune on an interval. Half the timeout, so an entry lives at most one
    // and a half times TYPING_TIMEOUT_MS and the indicator never lingers
    // noticeably past when someone stopped.
    const pruner = setInterval(() => {
      const cutoff = Date.now() - TYPING_TIMEOUT_MS;
      setEntries((current) => {
        const kept = Object.entries(current).filter(([, entry]) => entry.at > cutoff);
        return kept.length === Object.keys(current).length
          ? current
          : Object.fromEntries(kept);
      });
    }, TYPING_TIMEOUT_MS / 2);

    return () => {
      clearInterval(pruner);
      channelRef.current = null;
      channel.close();
    };
  }, [channelId, userId, ownUsername, enabled]);

  const announce = useCallback((): void => {
    channelRef.current?.announce();
  }, []);

  const stop = useCallback((): void => {
    channelRef.current?.stop();
  }, []);

  const typing = useMemo(
    () => Object.values(entries).map((entry) => entry.username),
    [entries],
  );

  return { typing, announce, stop };
}

/**
 * The sentence under the message box.
 *
 * Exported separately so it can be tested without a realtime connection, and
 * because the plural rules are the sort of thing that gets written wrong once
 * and then copied.
 */
export function describeTyping(names: string[]): string | null {
  switch (names.length) {
    case 0:
      return null;
    case 1:
      return `${names[0]} is aan het typen…`;
    case 2:
      return `${names[0]} en ${names[1]} zijn aan het typen…`;
    case 3:
      return `${names[0]}, ${names[1]} en ${names[2]} zijn aan het typen…`;
    default:
      // Past three, naming them all is longer than the message box.
      return 'Meerdere mensen zijn aan het typen…';
  }
}
