import type { MessageRow } from '../../types';
import { supabase } from './client';

const MESSAGE_COLUMNS = 'id, channel_id, sender_id, ciphertext, created_at, deleted_at';

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

  let query = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('channel_id', channelId)
    .is('deleted_at', null)
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
export async function sendMessage(channelId: string, ciphertext: string): Promise<MessageRow> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ channel_id: channelId, ciphertext })
    .select(MESSAGE_COLUMNS)
    .single<MessageRow>();

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
 */
export function subscribeToChannel(
  channelId: string,
  onInsert: (row: MessageRow) => void,
  onStatus?: (status: RealtimeStatus) => void,
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
