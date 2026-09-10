import { Avatar } from './Avatar';
import { Fingerprint } from './Fingerprint';
import { OnlineDot } from './OnlineDot';
import { usePresence } from '../hooks/usePresence';
import type { ChannelMemberKey } from '../types';

interface MemberListProps {
  members: readonly ChannelMemberKey[];
  currentUserId: string | null;
  /** Opens the profile card. Optional so the list works without one. */
  onOpenProfile?: (userId: string) => void;
}

/**
 * Members of the current channel with their key fingerprint.
 *
 * With more than two people in a channel this is the only way to check who you
 * are actually encrypting to, so the fingerprints are shown in full.
 */
export function MemberList({ members, currentUserId, onOpenProfile }: MemberListProps) {
  const { isOnline } = usePresence();

  // Online first, then alphabetical. In a channel of twenty, who is around is
  // the thing you are looking for; a fixed alphabetical list makes you scan
  // the whole column for a green dot.
  const sorted = [...members].sort((a, b) => {
    const onlineDelta = Number(isOnline(b.userId)) - Number(isOnline(a.userId));
    if (onlineDelta !== 0) {
      return onlineDelta;
    }
    return (a.displayName ?? a.username).localeCompare(b.displayName ?? b.username, 'nl');
  });

  return (
    <aside className="w-60 shrink-0 overflow-y-auto border-l border-subtle bg-raised p-3">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted">
        Leden — {members.length}
      </h3>

      {members.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Leden laden…</p>
      ) : null}

      <ul className="mt-2 flex flex-col gap-1">
        {sorted.map((member) => {
          const name = member.displayName ?? member.username;
          const online = isOnline(member.userId);

          const body = (
            <>
              <span className="relative">
                <Avatar
                  userId={member.userId}
                  name={name}
                  url={member.avatarUrl}
                  size="sm"
                />
                {online ? (
                  // Bottom-right of the avatar, with a ring in the panel
                  // colour so it reads as a badge rather than a dot floating
                  // over the picture.
                  <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-raised">
                    <OnlineDot label={`${name} is online`} />
                  </span>
                ) : null}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-sm text-primary">{name}</span>
                  {member.userId === currentUserId ? (
                    <span className="shrink-0 text-2xs text-muted">(jij)</span>
                  ) : null}
                </span>

                {member.displayName ? (
                  <span className="block truncate text-2xs text-muted">
                    @{member.username}
                  </span>
                ) : null}

                {member.fingerprint ? (
                  <span className="mt-0.5 block">
                    <Fingerprint value={member.fingerprint} />
                  </span>
                ) : (
                  <span className="mt-0.5 block text-xs text-warning">
                    Geen sleutel. Kan niet meelezen.
                  </span>
                )}
              </span>
            </>
          );

          return (
            <li key={member.userId}>
              {onOpenProfile ? (
                <button
                  type="button"
                  onClick={() => onOpenProfile(member.userId)}
                  className="flex w-full items-start gap-2 rounded-md p-1 text-left transition-colors hover:bg-hover"
                >
                  {body}
                </button>
              ) : (
                <span className="flex items-start gap-2 p-1">{body}</span>
              )}
            </li>
          );
        })}
      </ul>

      {members.length > 0 ? (
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Vergelijk deze vingerafdrukken buiten Vault om. Klopt er één niet, dan praat
          je met iemand anders dan je denkt.
        </p>
      ) : null}
    </aside>
  );
}
