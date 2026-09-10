import type { ReactionRow } from '../../types';
import { supabase } from './client';
import { currentUserId } from './session';

/**
 * Emoji reactions.
 *
 * The one part of a message that is stored in the clear, and it is worth being
 * precise about why that is defensible. A reaction row says "this user put
 * this emoji under this message at this time". The server already knows who is
 * in the channel and when messages were sent, so the only new thing it learns
 * is the emoji itself. Encrypting them would mean one copy per member per
 * reaction, which costs more than it protects.
 *
 * What that does mean: a reaction is not private. If it ever needs to be, the
 * answer is to drop reactions, not to invent encrypted ones.
 */

const REACTION_COLUMNS = 'message_id, user_id, emoji, created_at';

/**
 * How many reaction rows one page of messages may pull in.
 *
 * A page is 50 messages; this allows an average of eight reactions each before
 * anything gets cut off. Reaching the cap means a busy channel shows slightly
 * stale counts, which is better than an unbounded response.
 */
const MAX_REACTIONS = 400;

/**
 * Reactions for a set of messages.
 *
 * No membership check needed: RLS only exposes reactions on messages in
 * channels you belong to (see is_message_visible in the migration).
 */
export async function fetchReactions(messageIds: string[]): Promise<ReactionRow[]> {
  if (messageIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('message_reactions')
    .select(REACTION_COLUMNS)
    .in('message_id', messageIds)
    .order('created_at', { ascending: true })
    .limit(MAX_REACTIONS)
    .returns<ReactionRow[]>();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Adds your reaction.
 *
 * No .select() afterwards on purpose. The row is not needed — the caller
 * already knows what it just added and updates its own state optimistically —
 * and asking for it back would make this insert depend on the select policy as
 * well. That is the shape that produced the 403 in migration
 * 20260908140321, and there is no reason to walk into it twice.
 *
 * user_id is left out too: the column defaults to auth.uid(), so the server
 * decides who the reaction belongs to. A client that could name the user could
 * react on somebody else's behalf, policy permitting.
 */
export async function addReaction(messageId: string, emoji: string): Promise<void> {
  const { error } = await supabase
    .from('message_reactions')
    .insert({ message_id: messageId, emoji });

  if (error) {
    throw error;
  }
}

/** Removes your reaction. The delete policy only allows your own rows. */
export async function removeReaction(messageId: string, emoji: string): Promise<void> {
  const me = await currentUserId();

  const { error } = await supabase
    .from('message_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', me)
    .eq('emoji', emoji);

  if (error) {
    throw error;
  }
}

export interface ReactionChange {
  type: 'added' | 'removed';
  row: ReactionRow;
}

/**
 * Subscribes to reaction changes.
 *
 * There is no channel filter, because message_reactions has no channel_id to
 * filter on — a reaction hangs off a message. RLS is what limits this to
 * messages you can see, and the caller drops anything for a message it does
 * not have loaded.
 *
 * The DELETE payload is usable here only because of the table's composite
 * primary key. Postgres sends just the key columns in `old` under the default
 * replica identity, and for this table the key is (message_id, user_id, emoji)
 * — which happens to be everything we need. Without that, removals would
 * require REPLICA IDENTITY FULL.
 */
export function subscribeToReactions(onChange: (change: ReactionChange) => void): () => void {
  const channel = supabase
    .channel('message_reactions:all')
    .on<ReactionRow>(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'message_reactions' },
      (payload) => {
        onChange({ type: 'added', row: payload.new });
      },
    )
    .on<ReactionRow>(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'message_reactions' },
      (payload) => {
        const row = payload.old;
        // Guard anyway: if replica identity is ever changed, `old` could
        // arrive partial, and a removal we cannot identify is better dropped
        // than applied to the wrong reaction.
        if (row.message_id && row.user_id && row.emoji) {
          onChange({ type: 'removed', row: row as ReactionRow });
        }
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
