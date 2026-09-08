/**
 * Server invites.
 *
 * An invite is a link, not a UUID to retype. The raw id still works
 * everywhere a link does, because the id is what a link contains and people
 * have been passing those around already.
 */

/** A UUID, in the shape Postgres hands them out. */
const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function inviteLinkFor(serverId: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/join/${serverId}`;
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
