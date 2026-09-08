import type { MessageRow } from '../../types';
import { supabase } from './client';

const MESSAGE_COLUMNS = 'id, channel_id, sender_id, ciphertext, created_at, deleted_at';

/** One page of history. Exported so callers can tell a full page from a last one. */
export const MESSAGE_PAGE_SIZE = 50;

export interface FetchMessagesOptions {
  /** ISO timestamp: only return messages older than this, for paging back. */
  before?: string;
  limit?: number;
}

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
  let query = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? MESSAGE_PAGE_SIZE);

  if (opts.before) {
    query = query.lt('created_at', opts.before);
  }

  const { data, error } = await query.returns<MessageRow[]>();

  if (error) {
    throw error;
  }

  return [...data].reverse();
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

/**
 * Subscribes to new messages in a channel.
 *
 * Returns the cleanup function. Note that your own inserts come back through
 * here too, so callers must deduplicate on message id.
 */
export function subscribeToChannel(
  channelId: string,
  onInsert: (row: MessageRow) => void,
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
    .subscribe();

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
