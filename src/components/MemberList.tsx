import { Fingerprint } from './Fingerprint';
import { OnlineDot } from './OnlineDot';
import { usePresence } from '../hooks/usePresence';
import type { ChannelMemberKey } from '../types';

interface MemberListProps {
  members: ChannelMemberKey[];
  currentUserId: string | null;
}

/**
 * Members of the current channel with their key fingerprint.
 *
 * With more than two people in a channel this is the only way to check who you
 * are actually encrypting to, so the fingerprints are shown in full.
 */
export function MemberList({ members, currentUserId }: MemberListProps) {
  const { isOnline } = usePresence();

  return (
    <aside className="w-60 shrink-0 overflow-y-auto border-l border-subtle bg-raised p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
        Leden — {members.length}
      </h3>

      {members.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Leden laden…</p>
      ) : null}

      <ul className="mt-2 flex flex-col gap-3">
        {members.map((member) => (
          <li key={member.userId}>
            <p className="flex items-center gap-1.5 text-sm text-primary">
              {isOnline(member.userId) ? (
                <OnlineDot label={`${member.username} is online`} />
              ) : (
                <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0" />
              )}
              <span className="min-w-0 truncate">{member.username}</span>
              {member.userId === currentUserId ? (
                <span className="text-xs text-muted">(jij)</span>
              ) : null}
            </p>

            {member.fingerprint ? (
              <div className="mt-0.5 text-2xs">
                <Fingerprint value={member.fingerprint} />
              </div>
            ) : (
              <p className="mt-0.5 text-xs text-warning">
                Geen sleutel. Kan niet meelezen.
              </p>
            )}
          </li>
        ))}
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
