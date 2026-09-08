/** Shared application types. Database rows are mapped to these in lib/supabase/. */

export interface Profile {
  id: string;
  username: string;
  /** Armored PGP public key. */
  publicKey: string;
  /** Lowercase hex fingerprint. */
  fingerprint: string;
}

/**
 * A channel member with the public key needed to encrypt to them.
 *
 * publicKey is nullable on purpose: a half-created profile has no key, and a
 * member like that cannot be encrypted to. Callers must filter, not assume.
 */
export interface ChannelMemberKey {
  userId: string;
  username: string;
  publicKey: string | null;
  fingerprint: string | null;
}

export type ChannelType = 'dm' | 'group' | 'text';

export interface ChannelMemberSummary {
  userId: string;
  username: string;
}

export interface ChannelSummary {
  id: string;
  type: ChannelType;
  /** Null for DMs: their name is derived from the other member. */
  name: string | null;
  members: ChannelMemberSummary[];
  /** What to show in the channel list. */
  displayName: string;
}

/** A row of public.messages, exactly as stored. Only ever holds ciphertext. */
export interface MessageRow {
  id: string;
  channel_id: string;
  sender_id: string;
  ciphertext: string;
  created_at: string;
  deleted_at: string | null;
}

export type ServerRole = 'owner' | 'admin' | 'member';

export interface ServerSummary {
  id: string;
  name: string;
  ownerId: string;
  /** The signed-in user's own role in this server. */
  role: ServerRole;
}

export interface ServerMember {
  userId: string;
  username: string;
  role: ServerRole;
  fingerprint: string | null;
}
