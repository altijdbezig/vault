import { requireChannelName } from '../channelName';
import type {
  ChannelSummary,
  ServerInvite,
  ServerMember,
  ServerRole,
  ServerSummary,
} from '../../types';
import { supabase } from './client';
import { isUniqueViolation } from './errors';
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
  icon_url: string | null;
  server_members: { user_id: string; role: ServerRole }[];
}

interface ServerChannelRow {
  id: string;
  type: 'dm' | 'group' | 'text';
  name: string | null;
  description: string | null;
  position: number | null;
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
    display_name: string | null;
    avatar_url: string | null;
  };
}

/** Lists the servers you belong to. RLS does the membership filtering. */
export async function listMyServers(): Promise<ServerSummary[]> {
  const me = await currentUserId();

  const { data, error } = await supabase
    .from('servers')
    .select('id, name, owner_id, icon_url, created_at, server_members(user_id, role)')
    .order('created_at', { ascending: true })
    .returns<ServerRow[]>();

  if (error) {
    throw error;
  }

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    iconUrl: row.icon_url,
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
    .select(
      'id, type, name, description, position, created_at, channel_members(user_id, profiles!inner(username))',
    )
    .eq('server_id', serverId)
    // position first, created_at as the tiebreaker. Every existing channel has
    // position 0 (the column default), so until somebody drags something the
    // order is exactly what it was before this column existed.
    .order('position', { ascending: true })
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
    description: row.description,
    position: row.position ?? 0,
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
    .select('user_id, role, profiles!inner(username, key_fingerprint, display_name, avatar_url)')
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
    displayName: row.profiles.display_name ?? null,
    avatarUrl: row.profiles.avatar_url ?? null,
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

  // Following an invite link twice, or following one for a server you are
  // already in, is not an error worth showing anyone. Fall through and make
  // sure the channel memberships are complete either way.
  if (error && !isUniqueViolation(error)) {
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
    if (joinError && !isUniqueViolation(joinError)) {
      throw joinError;
    }
  }
}

/* ---------------------------------------------------------------------------
 * Server settings
 * ------------------------------------------------------------------------- */

export interface UpdateServerInput {
  name?: string;
  /** Null clears the icon, so the initials fallback comes back. */
  iconUrl?: string | null;
}

/**
 * Renames a server or changes its icon. Owners and admins only.
 *
 * The role check is in the policy, not here. This function does not verify it
 * again: a second check in the client would only tell the user sooner, and it
 * would drift from the real rule the moment either one changes.
 *
 * owner_id is deliberately not a field on this input. Ownership moves through
 * transferOwnership, and a trigger refuses it from anyone but the owner.
 */
export async function updateServer(
  serverId: string,
  input: UpdateServerInput,
): Promise<void> {
  const patch: Record<string, string | null> = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed === '') {
      throw new NotAllowedError('Geef de server een naam.');
    }
    patch['name'] = trimmed;
  }
  if ('iconUrl' in input) {
    patch['icon_url'] = input.iconUrl ?? null;
  }

  const { error } = await supabase.from('servers').update(patch).eq('id', serverId);

  if (error) {
    throw error;
  }
}

/**
 * Deletes a server, its channels and every message in them.
 *
 * Owner only, enforced by the policy. The client makes the user retype the
 * name first, which is a speed bump and not a permission check.
 */
export async function deleteServer(serverId: string): Promise<void> {
  const { error } = await supabase.from('servers').delete().eq('id', serverId);

  if (error) {
    throw error;
  }
}

/* ---------------------------------------------------------------------------
 * Channel management
 * ------------------------------------------------------------------------- */

export interface UpdateChannelInput {
  name?: string;
  /** Null clears the description. */
  description?: string | null;
}

/**
 * Renames a channel or sets its description.
 *
 * The name goes through the same normaliser as createChannel, so a channel
 * renamed to "#leden" ends up as "leden" exactly like one created that way.
 * That function is shared with the dialog, which is why the preview while
 * typing can never disagree with what gets stored.
 */
export async function updateChannel(
  channelId: string,
  input: UpdateChannelInput,
): Promise<void> {
  const patch: Record<string, string | null> = {};
  if (input.name !== undefined) {
    patch['name'] = requireChannelName(input.name);
  }
  if ('description' in input) {
    const trimmed = input.description?.trim();
    patch['description'] = trimmed ? trimmed : null;
  }

  const { error } = await supabase.from('channels').update(patch).eq('id', channelId);

  if (error) {
    throw error;
  }
}

/** Deletes a channel and everything in it. Owners and admins only. */
export async function deleteChannel(channelId: string): Promise<void> {
  const { error } = await supabase.from('channels').delete().eq('id', channelId);

  if (error) {
    throw error;
  }
}

/**
 * Writes a new channel order.
 *
 * One update per channel, because PostgREST has no "set these rows to these
 * different values" in a single call. A bulk upsert would need every column of
 * every row, which means a client that thinks it knows the whole channel and
 * would happily write back a stale name alongside the new position.
 *
 * Positions are spaced by ten so a later single-channel move can be given a
 * value in between without rewriting the list. Sequential rather than
 * parallel: the updates touch neighbouring rows, and a failure halfway is
 * easier to reason about when the order they ran in is known.
 */
export async function reorderChannels(orderedChannelIds: string[]): Promise<void> {
  for (const [index, channelId] of orderedChannelIds.entries()) {
    const { error } = await supabase
      .from('channels')
      .update({ position: index * 10 })
      .eq('id', channelId);

    if (error) {
      throw error;
    }
  }
}

/* ---------------------------------------------------------------------------
 * Roles and membership
 * ------------------------------------------------------------------------- */

/** Promotes or demotes a member. Owner only, enforced by the policy. */
export async function setMemberRole(
  serverId: string,
  userId: string,
  role: ServerRole,
): Promise<void> {
  const { error } = await supabase
    .from('server_members')
    .update({ role })
    .eq('server_id', serverId)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }
}

/**
 * Hands the server to somebody else.
 *
 * Three writes and no transaction, so the order is chosen for the least bad
 * failure. The new owner is promoted first: if a later write fails, the server
 * briefly has two owners, which either of them can fix. The other order would
 * leave it with none -- which the guard trigger refuses anyway, and if it did
 * not, nobody could ever manage the server again.
 *
 * servers.owner_id is updated as well, because that column is what the UI
 * reads to decide who the owner is. The trigger only lets the sitting owner
 * write it, which is exactly who is calling this.
 */
export async function transferOwnership(serverId: string, userId: string): Promise<void> {
  await setMemberRole(serverId, userId, 'owner');

  const { error: serverError } = await supabase
    .from('servers')
    .update({ owner_id: userId })
    .eq('id', serverId);
  if (serverError) {
    throw serverError;
  }

  const me = await currentUserId();
  await setMemberRole(serverId, me, 'admin');
}

/**
 * Removes somebody from a server and from all of its channels.
 *
 * Both halves are needed: server membership alone does not grant channel
 * access, so leaving the channel_members rows behind would keep delivering
 * messages to someone who has been removed.
 *
 * Channel memberships go first. If that fails, the person is still a member
 * and the whole thing can be retried; the other order would leave someone
 * with channel access to a server they are no longer in, and no screen in the
 * app would show that as fixable.
 */
export async function removeServerMember(serverId: string, userId: string): Promise<void> {
  const channels = await listServerChannels(serverId);
  const channelIds = channels.map((channel) => channel.id);

  if (channelIds.length > 0) {
    const { error: channelError } = await supabase
      .from('channel_members')
      .delete()
      .eq('user_id', userId)
      .in('channel_id', channelIds);
    if (channelError) {
      throw channelError;
    }
  }

  const { error } = await supabase
    .from('server_members')
    .delete()
    .eq('server_id', serverId)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }
}

/** The owner cannot walk away and leave a server nobody can manage. */
export class OwnerCannotLeaveError extends Error {
  constructor() {
    super(
      'Je bent de eigenaar van deze server. Draag het eigendom eerst over aan ' +
        'iemand anders, of verwijder de server.',
    );
    this.name = 'OwnerCannotLeaveError';
  }
}

/**
 * Leaves a server.
 *
 * The owner check sits here as well as in the database trigger, and that is
 * not duplication for its own sake: the trigger produces a Postgres error,
 * this produces the sentence that says what to do instead. The trigger is
 * still the thing that makes it true.
 */
export async function leaveServer(serverId: string): Promise<void> {
  const me = await currentUserId();
  const role = await getMyServerRole(serverId);

  if (role === 'owner') {
    throw new OwnerCannotLeaveError();
  }

  await removeServerMember(serverId, me);
}

/* ---------------------------------------------------------------------------
 * Invites
 * ------------------------------------------------------------------------- */

interface InviteRow {
  code: string;
  server_id: string;
  created_by: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  created_at: string;
}

const INVITE_COLUMNS = 'code, server_id, created_by, expires_at, max_uses, uses, created_at';

/**
 * The alphabet for an invite code.
 *
 * Lower case letters and digits only, which is what the CHECK constraint
 * allows and what survives being read out over the phone. No mixed case: an
 * invite that stops working because somebody capitalised it is an invite that
 * generates a support question.
 */
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 10;

/**
 * Generates a code.
 *
 * crypto.getRandomValues, not Math.random. An invite code is the only thing
 * standing between a stranger and a server, so it has to be unguessable:
 * 10 characters out of 36 is about 51 bits. Math.random is not a cryptographic
 * generator and its output is predictable from a few samples.
 *
 * The modulo bias here is negligible (256 mod 36 leaves a slight preference
 * for the first four letters) but rejecting out-of-range bytes costs nothing,
 * so it is done properly.
 */
export function generateInviteCode(): string {
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  let code = '';

  while (code.length < CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    for (const byte of bytes) {
      if (byte < limit && code.length < CODE_LENGTH) {
        code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      }
    }
  }

  return code;
}

function toInvite(row: InviteRow): ServerInvite {
  return {
    code: row.code,
    serverId: row.server_id,
    createdBy: row.created_by,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    uses: row.uses,
    createdAt: row.created_at,
  };
}

export interface CreateInviteInput {
  /** Days until it expires, or null for no expiry. */
  expiresInDays: number | null;
  /** How many people may use it, or null for unlimited. */
  maxUses: number | null;
}

/** Creates an invite. Owners and admins only, enforced by the policy. */
export async function createInvite(
  serverId: string,
  input: CreateInviteInput,
): Promise<ServerInvite> {
  const expiresAt =
    input.expiresInDays === null
      ? null
      : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('server_invites')
    .insert({
      code: generateInviteCode(),
      server_id: serverId,
      expires_at: expiresAt,
      max_uses: input.maxUses,
    })
    .select(INVITE_COLUMNS)
    .single<InviteRow>();

  if (error) {
    throw error;
  }

  return toInvite(data);
}

/**
 * Lists the invites of a server.
 *
 * Only an admin gets rows back. That is worth restating: the select policy on
 * server_invites is limited to admins on purpose, because a policy that let
 * any signed-in user read the table would hand out every valid code for every
 * server in one request.
 */
export async function listInvites(serverId: string): Promise<ServerInvite[]> {
  const { data, error } = await supabase
    .from('server_invites')
    .select(INVITE_COLUMNS)
    .eq('server_id', serverId)
    .order('created_at', { ascending: false })
    .returns<InviteRow[]>();

  if (error) {
    throw error;
  }

  return data.map(toInvite);
}

export async function revokeInvite(code: string): Promise<void> {
  const { error } = await supabase.from('server_invites').delete().eq('code', code);

  if (error) {
    throw error;
  }
}

/** An invite that cannot be used, with a reason the user can act on. */
export class InviteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteError';
  }
}

/**
 * Redeems an invite code.
 *
 * Goes through the redeem_server_invite function rather than doing the four
 * writes here, and not for tidiness: the caller is not allowed to read the
 * invite row at all, so there is no way to validate the code client-side. The
 * function is SECURITY DEFINER, checks expiry and usage, joins the server and
 * all of its channels, and bumps the counter, in one statement that cannot
 * half-succeed.
 *
 * Older messages stay unreadable. They were encrypted to the members of the
 * time, and that is by design.
 */
export async function redeemInvite(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('redeem_server_invite', {
    p_code: code.trim().toLowerCase(),
  });

  if (error) {
    // The function raises with Dutch messages, which are meant for the user.
    // Anything else (a network failure, a missing function) is not, so it goes
    // through describeError like any other unexpected error.
    if (error.message.includes('uitnodiging') || error.message.includes('Niet ingelogd')) {
      throw new InviteError(error.message);
    }
    throw error;
  }

  if (typeof data !== 'string') {
    throw new InviteError('Deze uitnodiging werkt niet meer.');
  }

  return data;
}
