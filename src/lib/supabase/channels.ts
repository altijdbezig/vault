import type { ChannelSummary, ChannelType } from '../../types';
import { supabase } from './client';

interface ChannelRow {
  id: string;
  type: ChannelType;
  name: string | null;
  channel_members: {
    user_id: string;
    profiles: { username: string };
  }[];
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  const id = data.session?.user.id;
  if (!id) {
    throw new Error('Geen actieve sessie.');
  }
  return id;
}

/**
 * Lists the channels the signed-in user belongs to.
 *
 * No user_id filter needed: RLS only exposes channels you are a member of.
 */
export async function listMyChannels(): Promise<ChannelSummary[]> {
  const me = await currentUserId();

  const { data, error } = await supabase
    .from('channels')
    .select('id, type, name, created_at, channel_members(user_id, profiles!inner(username))')
    .order('created_at', { ascending: true })
    .returns<ChannelRow[]>();

  if (error) {
    throw error;
  }

  return data.map((row) => {
    const members = row.channel_members.map((member) => ({
      userId: member.user_id,
      username: member.profiles.username,
    }));
    const others = members.filter((member) => member.userId !== me);

    return {
      id: row.id,
      type: row.type,
      name: row.name,
      members,
      // A DM has no name of its own; it is named after the person you are
      // talking to. Same abstraction, different label.
      displayName:
        row.name ?? others.map((member) => member.username).join(', ') ?? '',
    };
  });
}

/**
 * Finds the existing DM with another user, or null.
 *
 * This leans on RLS: you can only read channel_members rows for channels you
 * are a member of yourself. So asking for "the other user's dm memberships"
 * already returns nothing but the channels you two share.
 */
export async function findExistingDm(otherUserId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('channel_members')
    .select('channel_id, channels!inner(type)')
    .eq('user_id', otherUserId)
    .eq('channels.type', 'dm')
    .limit(1)
    .returns<{ channel_id: string }[]>();

  if (error) {
    throw error;
  }

  return data[0]?.channel_id ?? null;
}

/** Opens the DM with another user, creating it if it does not exist yet. */
export async function createDm(otherUserId: string): Promise<string> {
  const existing = await findExistingDm(otherUserId);
  if (existing) {
    return existing;
  }

  const me = await currentUserId();

  const { data: channel, error: channelError } = await supabase
    .from('channels')
    .insert({ type: 'dm', server_id: null, created_by: me })
    .select('id')
    .single<{ id: string }>();

  if (channelError) {
    throw channelError;
  }

  try {
    // Order matters. The insert policy allows a row when user_id = auth.uid()
    // OR you are already a member of the channel. Adding yourself first is
    // what makes the second insert legal.
    const { error: selfError } = await supabase
      .from('channel_members')
      .insert({ channel_id: channel.id, user_id: me });
    if (selfError) {
      throw selfError;
    }

    const { error: otherError } = await supabase
      .from('channel_members')
      .insert({ channel_id: channel.id, user_id: otherUserId });
    if (otherError) {
      throw otherError;
    }
  } catch (error) {
    // Never leave a half-built DM behind: a channel with one member is
    // invisible to the other person and can never be repaired from the UI.
    await supabase.from('channels').delete().eq('id', channel.id);
    throw error;
  }

  return channel.id;
}
