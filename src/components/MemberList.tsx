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
    <aside className="w-60 shrink-0 overflow-y-auto border-l border-ink-800 bg-ink-900 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
        Leden — {members.length}
      </h3>

      <ul className="mt-2 flex flex-col gap-3">
        {members.map((member) => (
          <li key={member.userId}>
            <p className="flex items-center gap-1.5 text-sm text-ink-100">
              {isOnline(member.userId) ? (
                <OnlineDot label={`${member.username} is online`} />
              ) : (
                <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0" />
              )}
              <span className="min-w-0 truncate">{member.username}</span>
              {member.userId === currentUserId ? (
                <span className="text-xs text-ink-500">(jij)</span>
              ) : null}
            </p>

            {member.fingerprint ? (
              <div className="mt-0.5 text-[10px]">
                <Fingerprint value={member.fingerprint} />
              </div>
            ) : (
              <p className="mt-0.5 text-xs text-amber-400">
                Geen sleutel. Kan niet meelezen.
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-ink-500">
        Vergelijk deze vingerafdrukken buiten Vault om. Klopt er één niet, dan praat
        je met iemand anders dan je denkt.
      </p>
    </aside>
  );
}
