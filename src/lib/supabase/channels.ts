import type { ChannelSummary, ChannelType } from '../../types';
import { supabase } from './client';
import { currentUserId } from './session';

interface ChannelRow {
  id: string;
  type: ChannelType;
  name: string | null;
  channel_members: {
    user_id: string;
    profiles: { username: string };
  }[];
}

/**
 * Lists the DMs and groups the signed-in user belongs to.
 *
 * No user_id filter needed: RLS only exposes channels you are a member of.
 * The server_id filter is needed though — without it every server channel you
 * can see turns up in the conversation list as well.
 */
export async function listMyChannels(): Promise<ChannelSummary[]> {
  const me = await currentUserId();

  const { data, error } = await supabase
    .from('channels')
    .select('id, type, name, created_at, channel_members(user_id, profiles!inner(username))')
    .is('server_id', null)
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
      // talking to. A group falls back to the same rule when it was created
      // without a name. Same abstraction, different label.
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

/** A group needs at least one other person in it. */
export class EmptyGroupError extends Error {
  constructor() {
    super('Kies minstens één andere deelnemer voor de groep.');
    this.name = 'EmptyGroupError';
  }
}

/**
 * Creates a group conversation.
 *
 * Same table, same columns and same member ordering as createDm: server_id
 * stays null, and you go into channel_members first. That order is not
 * cosmetic — the insert policy allows a row when user_id = auth.uid() OR you
 * are already a member of the channel, so adding yourself is what makes
 * adding everyone else legal.
 */
export async function createGroup(name: string, userIds: string[]): Promise<string> {
  const me = await currentUserId();
  const others = [...new Set(userIds)].filter((userId) => userId !== me);

  if (others.length === 0) {
    throw new EmptyGroupError();
  }

  const { data: channel, error: channelError } = await supabase
    .from('channels')
    .insert({ type: 'group', server_id: null, name: name.trim(), created_by: me })
    .select('id')
    .single<{ id: string }>();

  if (channelError) {
    throw channelError;
  }

  try {
    const { error: selfError } = await supabase
      .from('channel_members')
      .insert({ channel_id: channel.id, user_id: me });
    if (selfError) {
      throw selfError;
    }

    const { error: othersError } = await supabase
      .from('channel_members')
      .insert(others.map((userId) => ({ channel_id: channel.id, user_id: userId })));
    if (othersError) {
      throw othersError;
    }
  } catch (error) {
    await supabase.from('channels').delete().eq('id', channel.id);
    throw error;
  }

  return channel.id;
}

/**
 * Adds someone to an existing group.
 *
 * They will not be able to read anything sent before this moment: those
 * messages were encrypted to the keys of the members at the time, and there is
 * no way to change that after the fact. Callers must say so before they call
 * this, not after.
 */
export async function addMemberToGroup(channelId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('channel_members')
    .insert({ channel_id: channelId, user_id: userId });

  if (error) {
    throw error;
  }
}

/** Removes yourself from a group. The delete policy only allows your own row. */
export async function leaveGroup(channelId: string): Promise<void> {
  const me = await currentUserId();

  const { error } = await supabase
    .from('channel_members')
    .delete()
    .eq('channel_id', channelId)
    .eq('user_id', me);

  if (error) {
    throw error;
  }
}
