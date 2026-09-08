/** Shared application types. Database rows are mapped to these in lib/supabase/. */

export interface Profile {
  id: string;
  username: string;
  /** Armored PGP public key. */
  publicKey: string;
  /** Lowercase hex fingerprint. */
  fingerprint: string;
}

/** A channel member with the public key needed to encrypt to them. */
export interface ChannelMemberKey {
  userId: string;
  username: string;
  publicKey: string;
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
