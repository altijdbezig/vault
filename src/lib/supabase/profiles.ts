import type { ChannelMemberKey, Profile } from '../../types';
import { supabase } from './client';
import { currentUserId } from './session';

/** Row shape of public.profiles, as stored in Postgres. */
interface ProfileRow {
  id: string;
  username: string;
  public_key: string;
  key_fingerprint: string;
  display_name: string | null;
  /**
   * The full public URL, not a storage path.
   *
   * The avatars bucket is public, so the URL is stable, and storing it whole
   * means a member list does not have to run every row through
   * getPublicUrl(). Each upload writes a new random filename and removes the
   * old one, which also solves cache busting: a changed avatar is a changed
   * URL, so no browser can show the previous one.
   */
  avatar_url: string | null;
  created_at: string | null;
}

const PROFILE_COLUMNS =
  'id, username, public_key, key_fingerprint, display_name, avatar_url, created_at';

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    publicKey: row.public_key,
    fingerprint: row.key_fingerprint,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
  };
}

export interface CreateProfileInput {
  id: string;
  username: string;
  publicKey: string;
  fingerprint: string;
}

/**
 * Creates the profile row for a freshly signed-up user.
 *
 * This deliberately happens from the client and not from a trigger on
 * auth.users: the public key only exists in the browser, so the server could
 * never fill this row correctly.
 *
 * Throws the raw PostgrestError on failure; callers check isUniqueViolation()
 * to recognise a taken username.
 */
export async function createProfile(input: CreateProfileInput): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .insert({
      id: input.id,
      username: input.username,
      public_key: input.publicKey,
      key_fingerprint: input.fingerprint,
    })
    .select(PROFILE_COLUMNS)
    .single<ProfileRow>();

  if (error) {
    throw error;
  }

  return toProfile(data);
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle<ProfileRow>();

  if (error) {
    throw error;
  }

  return data ? toProfile(data) : null;
}

export interface UpdateProfileInput {
  /** Null clears it, so the username is used again. */
  displayName?: string | null;
  avatarUrl?: string | null;
}

/**
 * Updates your own profile.
 *
 * Only the fields that were passed, so setting a display name does not wipe an
 * avatar. Note what is NOT updatable here and cannot be: public_key and
 * key_fingerprint are locked by the update policy (see the
 * profile_key_unchanged function in the migration). Swapping your own public
 * key is the attack that key verification exists to catch, and it is not
 * something the client is allowed to do at all.
 */
export async function updateProfile(input: UpdateProfileInput): Promise<Profile> {
  const me = await currentUserId();

  const patch: Record<string, string | null> = {};
  if ('displayName' in input) {
    // Empty string would fail the profiles_display_name_not_blank constraint,
    // and it means the same thing as "no display name" anyway.
    const trimmed = input.displayName?.trim();
    patch['display_name'] = trimmed ? trimmed : null;
  }
  if ('avatarUrl' in input) {
    patch['avatar_url'] = input.avatarUrl ?? null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', me)
    .select(PROFILE_COLUMNS)
    .single<ProfileRow>();

  if (error) {
    throw error;
  }

  return toProfile(data);
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('username', username)
    .maybeSingle<ProfileRow>();

  if (error) {
    throw error;
  }

  return data ? toProfile(data) : null;
}

interface ChannelMemberRow {
  user_id: string;
  profiles: {
    username: string;
    public_key: string | null;
    key_fingerprint: string | null;
    display_name: string | null;
    avatar_url: string | null;
  };
}

/**
 * Returns the public keys of every member of a channel, to encrypt a message to.
 *
 * No membership check needed here: RLS only lets you read channel_members rows
 * for channels you are a member of yourself.
 */
export async function getPublicKeysForChannel(channelId: string): Promise<ChannelMemberKey[]> {
  const { data, error } = await supabase
    .from('channel_members')
    .select(
      'user_id, profiles!inner(username, public_key, key_fingerprint, display_name, avatar_url)',
    )
    .eq('channel_id', channelId)
    .returns<ChannelMemberRow[]>();

  if (error) {
    throw error;
  }

  return data.map((row) => ({
    userId: row.user_id,
    username: row.profiles.username,
    // An empty string is as unusable as null; normalise both away here so
    // callers only have to check for null.
    publicKey: row.profiles.public_key?.trim() ? row.profiles.public_key : null,
    fingerprint: row.profiles.key_fingerprint ?? null,
    displayName: row.profiles.display_name ?? null,
    avatarUrl: row.profiles.avatar_url ?? null,
  }));
}
