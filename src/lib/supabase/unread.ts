import { supabase } from './client';
import { currentUserId } from './session';

/**
 * Unread counting.
 *
 * Counting happens client-side on message metadata, never on content: the
 * server cannot tell what a message says, and it is not asked to. Only
 * channel_id, sender_id and created_at leave the database here.
 *
 * Doing it in one grouped query would need an RPC, which is a schema change.
 * Two queries and a group-by in JavaScript is well within budget for the
 * number of channels a person is in.
 */

/** A per-channel unread tally, plus the server it belongs to for the rail dot. */
export interface UnreadState {
  /** channel id -> number of unread messages from other people. */
  counts: Record<string, number>;
  /** channel id -> server id, or null for a DM or group. */
  channelServers: Record<string, string | null>;
}

/**
 * How far back to look for unread messages.
 *
 * Someone who has not opened a busy channel in weeks does not need an exact
 * number, they need to know there is a lot. The badge caps at 99+ anyway.
 */
const MAX_UNREAD_SCAN = 500;

interface MembershipRow {
  channel_id: string;
  last_read_at: string;
  channels: { server_id: string | null };
}

interface UnreadMessageRow {
  channel_id: string;
  sender_id: string;
  created_at: string;
}

export async function fetchUnreadState(): Promise<UnreadState> {
  const me = await currentUserId();

  const { data: memberships, error: membershipError } = await supabase
    .from('channel_members')
    .select('channel_id, last_read_at, channels!inner(server_id)')
    .eq('user_id', me)
    .returns<MembershipRow[]>();

  if (membershipError) {
    throw membershipError;
  }

  const counts: Record<string, number> = {};
  const channelServers: Record<string, string | null> = {};
  const lastRead = new Map<string, string>();

  for (const row of memberships) {
    counts[row.channel_id] = 0;
    channelServers[row.channel_id] = row.channels.server_id;
    lastRead.set(row.channel_id, row.last_read_at);
  }

  if (memberships.length === 0) {
    return { counts, channelServers };
  }

  // One query for every channel at once: anything newer than the oldest read
  // marker is a candidate, and the per-channel marker filters the rest.
  const oldest = [...lastRead.values()].reduce((a, b) => (a < b ? a : b));

  const { data: messages, error: messageError } = await supabase
    .from('messages')
    .select('channel_id, sender_id, created_at')
    .is('deleted_at', null)
    .gt('created_at', oldest)
    .order('created_at', { ascending: false })
    .limit(MAX_UNREAD_SCAN)
    .returns<UnreadMessageRow[]>();

  if (messageError) {
    throw messageError;
  }

  for (const message of messages) {
    if (!countsAsUnread(message, me, lastRead.get(message.channel_id))) {
      continue;
    }
    counts[message.channel_id] = (counts[message.channel_id] ?? 0) + 1;
  }

  return { counts, channelServers };
}

/** Your own messages never count as unread, and neither does anything you read. */
export function countsAsUnread(
  message: { sender_id: string; created_at: string },
  me: string,
  lastReadAt: string | undefined,
): boolean {
  if (message.sender_id === me) {
    return false;
  }
  return lastReadAt === undefined || message.created_at > lastReadAt;
}

/**
 * Moves your read marker in every channel at once.
 *
 * One update over all your channel_members rows, which is what makes
 * "mark everything read" a single request instead of one per channel. The
 * where clause is your own user_id, and the update policy allows nothing
 * else, so this cannot touch anybody else's markers even by accident.
 */
export async function markAllChannelsRead(at: string): Promise<void> {
  const me = await currentUserId();

  const { error } = await supabase
    .from('channel_members')
    .update({ last_read_at: at })
    .eq('user_id', me);

  if (error) {
    throw error;
  }
}

/**
 * Moves your read marker in a channel.
 *
 * The timestamp comes from the client, so a badly wrong clock could mark a
 * message read that you have not seen. Harmless in practice: this is only
 * called for the channel that is open and focused, which is exactly the one
 * whose messages are on your screen.
 */
export async function markChannelRead(channelId: string, at: string): Promise<void> {
  const me = await currentUserId();

  const { error } = await supabase
    .from('channel_members')
    .update({ last_read_at: at })
    .eq('channel_id', channelId)
    .eq('user_id', me);

  if (error) {
    throw error;
  }
}
