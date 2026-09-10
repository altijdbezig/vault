/** Shared application types. Database rows are mapped to these in lib/supabase/. */

export interface Profile {
  id: string;
  username: string;
  /** Armored PGP public key. */
  publicKey: string;
  /** Lowercase hex fingerprint. */
  fingerprint: string;
  /** What the person wants to be called. Null means: use the username. */
  displayName: string | null;
  /**
   * Public URL in the avatars bucket, or null.
   *
   * Not encrypted, and that is a deliberate exception: an avatar has to load
   * for everyone who sees your name, so there is no key it could be encrypted
   * to. The UI says so where you upload one.
   */
  avatarUrl: string | null;
  /** For "lid sinds" on the profile card. */
  createdAt: string | null;
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
  displayName: string | null;
  avatarUrl: string | null;
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
  /** Shown in the conversation header. Null when nobody set one. */
  description: string | null;
  /** Sort key inside a server, set by dragging. Always 0 for DMs and groups. */
  position: number;
}

/** A row of public.messages, exactly as stored. Only ever holds ciphertext. */
export interface MessageRow {
  id: string;
  channel_id: string;
  sender_id: string;
  ciphertext: string;
  created_at: string;
  /** Set when the sender edited it. The ciphertext is then the new version. */
  edited_at: string | null;
  /**
   * Set when the sender deleted it.
   *
   * A deleted row keeps its place in the conversation but has an empty
   * ciphertext: replies and reactions still point at it, and a hole in the
   * history reads as a bug. See deleteMessage.
   */
  deleted_at: string | null;
  /** The message this one answers, or null. */
  reply_to_id: string | null;
}

/** A row of public.message_reactions. Metadata, never content. */
export interface ReactionRow {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

/** One emoji under one message, with who used it. */
export interface ReactionGroup {
  emoji: string;
  /** User ids, in the order the reactions arrived. */
  userIds: string[];
  /** Usernames for the tooltip, resolved against the member list. */
  usernames: string[];
  /** True when you are one of them, so the button reads as pressed. */
  mine: boolean;
}

export type ServerRole = 'owner' | 'admin' | 'member';

export interface ServerSummary {
  id: string;
  name: string;
  ownerId: string;
  /** The signed-in user's own role in this server. */
  role: ServerRole;
  /** Public URL in the avatars bucket, or null. */
  iconUrl: string | null;
}

export interface ServerMember {
  userId: string;
  username: string;
  role: ServerRole;
  fingerprint: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/** A row of public.server_invites, as an admin sees it. */
export interface ServerInvite {
  code: string;
  serverId: string;
  createdBy: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  createdAt: string;
}
