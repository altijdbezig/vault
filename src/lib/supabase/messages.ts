import type { MessageRow } from '../../types';
import { supabase } from './client';

const MESSAGE_COLUMNS =
  'id, channel_id, sender_id, ciphertext, created_at, edited_at, deleted_at, reply_to_id';

/** One page of history. Exported so callers can tell a full page from a last one. */
export const MESSAGE_PAGE_SIZE = 50;

export interface FetchMessagesOptions {
  /** ISO timestamp: only return messages older than this, for paging back. */
  before?: string;
  /** ISO timestamp: only return messages newer than this, for catching up. */
  after?: string;
  limit?: number;
}

/**
 * How many pages a reconnect will walk before giving up.
 *
 * A long disconnect must not turn into an unbounded loop; anything older than
 * this is still reachable by scrolling back.
 */
const MAX_CATCHUP_PAGES = 10;

/**
 * Fetches a page of messages, oldest first.
 *
 * Queried newest-first so a page is the most recent N (or the N just before
 * the cursor), then reversed for display.
 */
export async function fetchMessages(
  channelId: string,
  opts: FetchMessagesOptions = {},
): Promise<MessageRow[]> {
  // Paging back wants the newest N below the cursor, so it is queried
  // descending and reversed. Catching up wants the oldest N above it, which is
  // already the order we want.
  const ascending = opts.after !== undefined;

  // Deleted rows are NOT filtered out here any more.
  //
  // They come back with an empty ciphertext and render as "bericht
  // verwijderd" in place. Filtering them would leave a gap in the middle of a
  // conversation, replies pointing at nothing, and a paging cursor that skips
  // rows — and a gap reads as a bug, not as a deletion. Unread counting still
  // ignores them; see fetchUnreadState.
  let query = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('channel_id', channelId)
    .order('created_at', { ascending })
    .limit(opts.limit ?? MESSAGE_PAGE_SIZE);

  if (opts.before) {
    query = query.lt('created_at', opts.before);
  }
  if (opts.after) {
    query = query.gt('created_at', opts.after);
  }

  const { data, error } = await query.returns<MessageRow[]>();

  if (error) {
    throw error;
  }

  return ascending ? data : [...data].reverse();
}

/**
 * Everything that arrived after a timestamp, oldest first.
 *
 * Used after a reconnect. It pages forward rather than just refetching the
 * most recent 50: a long disconnect can leave more than a page behind, and
 * grabbing only the newest page would leave a hole in the middle of the
 * conversation that scrolling back would never fill.
 */
export async function fetchMessagesSince(
  channelId: string,
  since: string,
): Promise<MessageRow[]> {
  const collected: MessageRow[] = [];
  let cursor = since;

  for (let page = 0; page < MAX_CATCHUP_PAGES; page += 1) {
    const rows = await fetchMessages(channelId, { after: cursor });
    collected.push(...rows);

    const last = rows[rows.length - 1];
    if (!last || rows.length < MESSAGE_PAGE_SIZE) {
      break;
    }
    cursor = last.created_at;
  }

  return collected;
}

/**
 * Inserts a message.
 *
 * Takes ciphertext only. Encryption happens a layer up, in useMessages; this
 * function must never see plaintext.
 */
export async function sendMessage(
  channelId: string,
  ciphertext: string,
  replyToId?: string | null,
): Promise<MessageRow> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ channel_id: channelId, ciphertext, reply_to_id: replyToId ?? null })
    .select(MESSAGE_COLUMNS)
    .single<MessageRow>();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Replaces the ciphertext of your own message and stamps edited_at.
 *
 * The new ciphertext is encrypted for the members as they are now, which is
 * not necessarily who it was encrypted for originally. Somebody who has left
 * the channel keeps the copy they already had of the old text; that is
 * unavoidable and true of any edit in any end-to-end encrypted system.
 *
 * edited_at is set by the client because there is no trigger for it, and RLS
 * cannot force a column to be written. A sender could therefore edit without
 * setting it. The signature inside the new ciphertext still proves who wrote
 * the current text, so what a missing edited_at costs is the "(bewerkt)"
 * label, not authenticity.
 */
export async function updateMessage(messageId: string, ciphertext: string): Promise<MessageRow> {
  const { data, error } = await supabase
    .from('messages')
    .update({ ciphertext, edited_at: new Date().toISOString() })
    .eq('id', messageId)
    .select(MESSAGE_COLUMNS)
    .single<MessageRow>();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Soft-deletes your own message and blanks the ciphertext.
 *
 * Both halves matter. Keeping the row keeps the place in the conversation and
 * keeps replies and reactions pointing somewhere. Blanking the ciphertext is
 * what makes it a deletion rather than a hidden message: as long as the
 * ciphertext is on the server, every member who still has their key can go on
 * decrypting it, whatever the UI chooses to show.
 *
 * What this does not promise: that the text disappears from a screen where
 * somebody already decrypted it, or from a copy they saved. No system can
 * promise that, and the UI should not imply otherwise.
 */
export async function deleteMessage(messageId: string): Promise<MessageRow> {
  const { data, error } = await supabase
    .from('messages')
    .update({ ciphertext: '', deleted_at: new Date().toISOString() })
    .eq('id', messageId)
    .select(MESSAGE_COLUMNS)
    .single<MessageRow>();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Fetches specific messages by id, for reply previews.
 *
 * A reply can point at a message far above what is loaded, and scrolling all
 * the way back to render one preview line would be absurd. RLS still applies,
 * so an id from another channel simply comes back empty.
 */
export async function fetchMessagesByIds(ids: string[]): Promise<MessageRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .in('id', ids)
    .returns<MessageRow[]>();

  if (error) {
    throw error;
  }

  return data;
}

/** Whether the realtime socket is currently delivering for this channel. */
export type RealtimeStatus = 'connected' | 'disconnected';

/**
 * Subscribes to new messages in a channel.
 *
 * Returns the cleanup function. Note that your own inserts come back through
 * here too, so callers must deduplicate on message id.
 *
 * onStatus reports whether the subscription is live. The socket drops on
 * sleep, on a network change and inside some tunnels, and without this the
 * app looks like a quiet channel instead of a broken connection.
 *
 * One thing about the publication, verified against production on 2026-09-10
 * so nobody has to rediscover it: supabase_realtime carries messages with
 * insert, update and delete all enabled, and replica identity is left at the
 * default (the primary key). That combination means:
 *
 * - On UPDATE the whole new row arrives in `new`, so the channel_id filter
 *   below applies to edits and deletions as well. That is what makes onUpdate
 *   work at all.
 * - On a real DELETE only the primary key would arrive, in `old`, and the
 *   channel_id filter would never match it. Not a problem here, because
 *   deleting a message is an UPDATE in this app (deleted_at plus an empty
 *   ciphertext) and never a DELETE. If a hard delete is ever added, this
 *   subscription will not see it without REPLICA IDENTITY FULL.
 * - REPLICA IDENTITY FULL is deliberately not set: it would push the previous
 *   ciphertext over the socket on every edit for no reader.
 */
export function subscribeToChannel(
  channelId: string,
  onInsert: (row: MessageRow) => void,
  onStatus?: (status: RealtimeStatus) => void,
  onUpdate?: (row: MessageRow) => void,
): () => void {
  const channel = supabase
    .channel(`messages:${channelId}`)
    .on<MessageRow>(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `channel_id=eq.${channelId}`,
      },
      (payload) => {
        onInsert(payload.new);
      },
    )
    // Edits and deletions arrive as UPDATE. Without this an edit only shows up
    // after a reload, and a deleted message stays readable on the other side
    // for as long as the tab is open — which is the one case where "eventually
    // consistent" is not good enough.
    //
    // The default replica identity means `new` is complete and `old` holds
    // only the id. Only `new` is used, so REPLICA IDENTITY FULL is not needed;
    // it would re-send every old ciphertext over the socket for nothing.
    .on<MessageRow>(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `channel_id=eq.${channelId}`,
      },
      (payload) => {
        onUpdate?.(payload.new);
      },
    )
    .subscribe((status) => {
      onStatus?.(status === 'SUBSCRIBED' ? 'connected' : 'disconnected');
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Subscribes to new messages in every channel you are a member of.
 *
 * One subscription for the whole app, not one per channel: unread counts need
 * to hear about channels you are not looking at, and a subscription per
 * channel would grow with the number of conversations. There is no filter
 * here, so RLS is what limits this to your own channels.
 */
export function subscribeToAllMessages(onInsert: (row: MessageRow) => void): () => void {
  const channel = supabase
    .channel('messages:all')
    .on<MessageRow>(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        onInsert(payload.new);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
