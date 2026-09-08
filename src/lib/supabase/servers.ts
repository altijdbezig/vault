import { requireChannelName } from '../channelName';
import type { ChannelSummary, ServerMember, ServerRole, ServerSummary } from '../../types';
import { supabase } from './client';
import { currentUserId } from './session';

/** You are not allowed to do this in this server. */
export class NotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotAllowedError';
  }
}

const DEFAULT_CHANNEL_NAME = 'algemeen';

interface ServerRow {
  id: string;
  name: string;
  owner_id: string;
  server_members: { user_id: string; role: ServerRole }[];
}

interface ServerChannelRow {
  id: string;
  type: 'dm' | 'group' | 'text';
  name: string | null;
  channel_members: {
    user_id: string;
    profiles: { username: string };
  }[];
}

interface ServerMemberRow {
  user_id: string;
  role: ServerRole;
  profiles: {
    username: string;
    key_fingerprint: string | null;
  };
}

/** Lists the servers you belong to. RLS does the membership filtering. */
export async function listMyServers(): Promise<ServerSummary[]> {
  const me = await currentUserId();

  const { data, error } = await supabase
    .from('servers')
    .select('id, name, owner_id, created_at, server_members(user_id, role)')
    .order('created_at', { ascending: true })
    .returns<ServerRow[]>();

  if (error) {
    throw error;
  }

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    role: row.server_members.find((member) => member.user_id === me)?.role ?? 'member',
  }));
}

/**
 * Creates a server with a default channel and puts you in both.
 *
 * Everything after the servers insert is cleaned up on failure: a server
 * without an owner row is invisible to everyone, including its creator.
 */
export async function createServer(name: string): Promise<string> {
  const me = await currentUserId();

  const { data: server, error: serverError } = await supabase
    .from('servers')
    .insert({ name, owner_id: me })
    .select('id')
    .single<{ id: string }>();

  if (serverError) {
    throw serverError;
  }

  let channelId: string | null = null;

  try {
    const { error: memberError } = await supabase
      .from('server_members')
      .insert({ server_id: server.id, user_id: me, role: 'owner' });
    if (memberError) {
      throw memberError;
    }

    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .insert({
        type: 'text',
        server_id: server.id,
        name: DEFAULT_CHANNEL_NAME,
        created_by: me,
      })
      .select('id')
      .single<{ id: string }>();
    if (channelError) {
      throw channelError;
    }
    channelId = channel.id;

    const { error: channelMemberError } = await supabase
      .from('channel_members')
      .insert({ channel_id: channel.id, user_id: me });
    if (channelMemberError) {
      throw channelMemberError;
    }
  } catch (error) {
    // Roll back in reverse order. Do not rely on cascades we have not verified.
    if (channelId) {
      await supabase.from('channels').delete().eq('id', channelId);
    }
    await supabase.from('servers').delete().eq('id', server.id);
    throw error;
  }

  return server.id;
}

/** Lists the channels of a server. */
export async function listServerChannels(serverId: string): Promise<ChannelSummary[]> {
  const { data, error } = await supabase
    .from('channels')
    .select('id, type, name, created_at, channel_members(user_id, profiles!inner(username))')
    .eq('server_id', serverId)
    .order('created_at', { ascending: true })
    .returns<ServerChannelRow[]>();

  if (error) {
    throw error;
  }

  return data.map((row) => ({
    id: row.id,
    type: row.type,
    name: row.name,
    members: row.channel_members.map((member) => ({
      userId: member.user_id,
      username: member.profiles.username,
    })),
    displayName: row.name ?? 'kanaal',
  }));
}

/** Returns your own role in a server, or null when you are not a member. */
export async function getMyServerRole(serverId: string): Promise<ServerRole | null> {
  const me = await currentUserId();

  const { data, error } = await supabase
    .from('server_members')
    .select('role')
    .eq('server_id', serverId)
    .eq('user_id', me)
    .maybeSingle<{ role: ServerRole }>();

  if (error) {
    throw error;
  }

  return data?.role ?? null;
}

/**
 * Creates a channel in a server. Owners and admins only.
 *
 * The name is normalised here rather than in the dialog, so every path into
 * this function gets the same treatment. The dialog shows the same result
 * while you type, using the same function.
 */
export async function createChannel(serverId: string, name: string): Promise<string> {
  const channelName = requireChannelName(name);
  const me = await currentUserId();
  const role = await getMyServerRole(serverId);

  if (role !== 'owner' && role !== 'admin') {
    throw new NotAllowedError('Alleen de eigenaar of een admin kan een kanaal aanmaken.');
  }

  const { data: channel, error } = await supabase
    .from('channels')
    .insert({ type: 'text', server_id: serverId, name: channelName, created_by: me })
    .select('id')
    .single<{ id: string }>();

  if (error) {
    throw error;
  }

  const { error: memberError } = await supabase
    .from('channel_members')
    .insert({ channel_id: channel.id, user_id: me });

  if (memberError) {
    await supabase.from('channels').delete().eq('id', channel.id);
    throw memberError;
  }

  return channel.id;
}

/** Lists the members of a server, with the fingerprint used to verify them. */
export async function listServerMembers(serverId: string): Promise<ServerMember[]> {
  const { data, error } = await supabase
    .from('server_members')
    .select('user_id, role, profiles!inner(username, key_fingerprint)')
    .eq('server_id', serverId)
    .returns<ServerMemberRow[]>();

  if (error) {
    throw error;
  }

  return data.map((row) => ({
    userId: row.user_id,
    username: row.profiles.username,
    role: row.role,
    fingerprint: row.profiles.key_fingerprint ?? null,
  }));
}

/**
 * Joins a server by id, as a plain member.
 *
 * The insert policy allows adding yourself, so this works without invites.
 * Server membership alone is not enough to read a channel though: messages and
 * member keys hang off channel_members, so we join the existing channels too.
 * Older messages stay unreadable — they were never encrypted to this key, and
 * that is by design.
 */
export async function joinServer(serverId: string): Promise<void> {
  const me = await currentUserId();

  const { error } = await supabase
    .from('server_members')
    .insert({ server_id: serverId, user_id: me, role: 'member' });

  if (error) {
    throw error;
  }

  const channels = await listServerChannels(serverId);
  const missing = channels.filter(
    (channel) => !channel.members.some((member) => member.userId === me),
  );

  for (const channel of missing) {
    const { error: joinError } = await supabase
      .from('channel_members')
      .insert({ channel_id: channel.id, user_id: me });
    if (joinError) {
      throw joinError;
    }
  }
}
