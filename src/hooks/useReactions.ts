import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addReaction,
  fetchReactions,
  removeReaction,
  subscribeToReactions,
} from '../lib/supabase/reactions';
import type { ChannelMemberKey, ReactionGroup, ReactionRow } from '../types';
import { useAuth } from './useAuth';

export interface UseReactionsResult {
  /** message id -> the emoji under it, in the order they first appeared. */
  groups: Record<string, ReactionGroup[]>;
  /** Adds your reaction, or removes it when you already had that one. */
  toggle(messageId: string, emoji: string): Promise<void>;
  error: string | null;
}

/**
 * A reaction key: one row identified by all three of its primary key columns.
 *
 * The separator has to be something an id cannot contain, or "a|b" plus "c"
 * and "a" plus "b|c" would be the same reaction.
 */
function keyOf(row: Pick<ReactionRow, 'message_id' | 'user_id' | 'emoji'>): string {
  return `${row.message_id}|${row.user_id}|${row.emoji}`;
}

/**
 * Reactions for the messages on screen.
 *
 * A hook of its own rather than part of useMessages, because there is no
 * crypto here at all: reactions are stored in the clear (see
 * lib/supabase/reactions.ts for why that is defensible), so none of the key
 * handling, batching or decrypt caching in useMessages applies. Keeping them
 * apart means neither has to grow a branch for the other.
 *
 * @param messageIds The ids currently loaded. Reactions are fetched for these
 *   and anything arriving for another message is dropped.
 */
export function useReactions(
  channelId: string | null,
  messageIds: readonly string[],
  members: readonly ChannelMemberKey[],
): UseReactionsResult {
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;

  const [rows, setRows] = useState<ReactionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Read by the subscription callback, which is created once per channel and
  // must not capture the id list from the moment it was set up.
  const knownIdsRef = useRef<Set<string>>(new Set());
  knownIdsRef.current = new Set(messageIds);

  // Ids we have already asked for, so scrolling back a page fetches only the
  // page and not the whole conversation again.
  const fetchedRef = useRef(new Set<string>());

  /*
   * A stable array for as long as the contents are the same.
   *
   * The fetch effect below cancels its in-flight request when it re-runs, and
   * without this it re-runs on every render — a caller that builds the id list
   * inline hands over a new array identity each time, the effect tears itself
   * down mid-flight, and the reactions it just fetched are thrown away. The
   * symptom is reactions that silently never appear, which is exactly the kind
   * of bug that survives a manual test because it depends on whether anything
   * else re-rendered first.
   *
   * Keying on the joined ids rather than on the array means the effect only
   * re-runs when the set of messages actually changed. A pipe is a safe
   * separator: ids are uuids, or a uuid behind a "local-" prefix, so none of
   * them can contain one and two different sets cannot collide on one key.
   */
  const idsKey = messageIds.join('|');
  const stableIds = useMemo(() => [...messageIds], [idsKey]);

  useEffect(() => {
    // Guarded, because setting a fresh empty array unconditionally is itself
    // a state change and would trigger another render on mount.
    setRows((current) => (current.length === 0 ? current : []));
    setError(null);
    fetchedRef.current = new Set();
  }, [channelId]);

  // Fetch reactions for messages we have not asked about yet.
  useEffect(() => {
    const wanted = stableIds.filter(
      // Optimistic local rows have no reactions and no row on the server.
      (id) => !fetchedRef.current.has(id) && !id.startsWith('local-'),
    );
    if (wanted.length === 0) {
      return;
    }

    for (const id of wanted) {
      fetchedRef.current.add(id);
    }

    let cancelled = false;

    void (async () => {
      try {
        const fetched = await fetchReactions(wanted);
        if (!cancelled && fetched.length > 0) {
          setRows((current) => {
            const seen = new Set(current.map(keyOf));
            return [...current, ...fetched.filter((row) => !seen.has(keyOf(row)))];
          });
        }
      } catch (caught) {
        // A missing reaction row is a missing emoji, not a broken
        // conversation. Say nothing to the user and log it.
        console.error('Kon reacties niet laden:', caught);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stableIds]);

  useEffect(() => {
    if (!channelId) {
      return;
    }

    const unsubscribe = subscribeToReactions((change) => {
      // No channel filter exists on this table, so everything RLS lets
      // through arrives here; drop what belongs to a message we do not hold.
      if (!knownIdsRef.current.has(change.row.message_id)) {
        return;
      }

      setRows((current) => {
        const key = keyOf(change.row);
        if (change.type === 'removed') {
          return current.filter((row) => keyOf(row) !== key);
        }
        return current.some((row) => keyOf(row) === key) ? current : [...current, change.row];
      });
    });

    return unsubscribe;
  }, [channelId]);

  const toggle = useCallback(
    async (messageId: string, emoji: string): Promise<void> => {
      if (!currentUserId) {
        return;
      }

      const key = keyOf({ message_id: messageId, user_id: currentUserId, emoji });
      const had = rows.some((row) => keyOf(row) === key);
      setError(null);

      // Optimistic, because a reaction is the one interaction where a round
      // trip is noticeable: you click a smiley and expect it to be there.
      setRows((current) =>
        had
          ? current.filter((row) => keyOf(row) !== key)
          : [
              ...current,
              {
                message_id: messageId,
                user_id: currentUserId,
                emoji,
                created_at: new Date().toISOString(),
              },
            ],
      );

      try {
        if (had) {
          await removeReaction(messageId, emoji);
        } else {
          await addReaction(messageId, emoji);
        }
      } catch (caught) {
        // Put it back exactly as it was: an emoji that silently failed to
        // land is worse than one that visibly bounces back.
        setRows((current) =>
          had
            ? [
                ...current,
                {
                  message_id: messageId,
                  user_id: currentUserId,
                  emoji,
                  created_at: new Date().toISOString(),
                },
              ]
            : current.filter((row) => keyOf(row) !== key),
        );
        console.error('Reactie kon niet opgeslagen worden:', caught);
        setError('Reactie kon niet opgeslagen worden.');
      }
    },
    [currentUserId, rows],
  );

  const groups = useMemo<Record<string, ReactionGroup[]>>(() => {
    const nameFor = (userId: string): string =>
      members.find((member) => member.userId === userId)?.displayName ??
      members.find((member) => member.userId === userId)?.username ??
      'onbekend';

    const byMessage: Record<string, ReactionGroup[]> = {};

    for (const row of rows) {
      const list = (byMessage[row.message_id] ??= []);
      const existing = list.find((group) => group.emoji === row.emoji);

      if (existing) {
        if (!existing.userIds.includes(row.user_id)) {
          existing.userIds.push(row.user_id);
          existing.usernames.push(nameFor(row.user_id));
          existing.mine = existing.mine || row.user_id === currentUserId;
        }
        continue;
      }

      list.push({
        emoji: row.emoji,
        userIds: [row.user_id],
        usernames: [nameFor(row.user_id)],
        mine: row.user_id === currentUserId,
      });
    }

    return byMessage;
  }, [rows, members, currentUserId]);

  return { groups, toggle, error };
}
