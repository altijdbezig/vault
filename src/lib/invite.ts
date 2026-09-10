/**
 * Server invites.
 *
 * An invite is a link, not a UUID to retype. The raw id still works
 * everywhere a link does, because the id is what a link contains and people
 * have been passing those around already.
 *
 * Since real invites exist, a /join link can carry two different things:
 *
 * - an invite code, which is what every new link contains. It can expire and
 *   it can run out of uses.
 * - a bare server id, which is what the older links contain, and which joins
 *   the server directly with no expiry and no limit.
 *
 * Both are still accepted, and the difference matters at the point of use: a
 * code goes through redeem_server_invite, an id through joinServer.
 */

/** A UUID, in the shape Postgres hands them out. */
const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An invite code, matching the CHECK constraint on server_invites. */
const INVITE_CODE = /^[a-z0-9]{6,32}$/;

export function inviteLinkFor(codeOrServerId: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/join/${codeOrServerId}`;
}

/**
 * Pulls the server id out of whatever was pasted: a full invite link, a path,
 * or the bare id.
 *
 * Returns null when there is no id in there, so the caller can say so instead
 * of sending a nonsense value to the database.
 */
export function serverIdFromInvite(input: string): string | null {
  const trimmed = input.trim();
  if (SERVER_ID.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  const fromPath = /\/join\/([0-9a-f-]+)/i.exec(trimmed);
  if (fromPath?.[1] && SERVER_ID.test(fromPath[1])) {
    return fromPath[1].toLowerCase();
  }

  return null;
}

export type InviteToken =
  | { kind: 'serverId'; value: string }
  | { kind: 'code'; value: string };

/**
 * Works out what somebody pasted.
 *
 * The server id is tried first, because a UUID with the dashes stripped would
 * be 32 hex characters and would also match the invite code pattern. Checking
 * the more specific shape first means an old-style link cannot be mistaken for
 * a code that does not exist.
 */
export function inviteTokenFromInput(input: string): InviteToken | null {
  const trimmed = input.trim();

  const serverId = serverIdFromInvite(trimmed);
  if (serverId) {
    return { kind: 'serverId', value: serverId };
  }

  const candidate = /\/join\/([A-Za-z0-9]+)/.exec(trimmed)?.[1] ?? trimmed;
  const lower = candidate.toLowerCase();

  return INVITE_CODE.test(lower) ? { kind: 'code', value: lower } : null;
}
