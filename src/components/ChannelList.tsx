import { Button } from './Button';
import { OnlineDot } from './OnlineDot';
import { UnreadBadge } from './UnreadBadge';
import { usePresence } from '../hooks/usePresence';
import { channelPrefix } from '../lib/channelName';
import type { ChannelSummary } from '../types';

interface ChannelListProps {
  channels: ChannelSummary[];
  activeId: string | null;
  loading: boolean;
  onSelect: (channelId: string) => void;
  onNewDm: () => void;
  onNewGroup: () => void;
  /** Unread messages per channel id. */
  unread: Record<string, number>;
}

/**
 * DMs and groups in one list.
 *
 * They are the same kind of row on purpose: both are channels without a
 * server, and the only thing that separates them is the glyph in front and how
 * many people are in them.
 */
export function ChannelList({
  channels,
  activeId,
  loading,
  onSelect,
  onNewDm,
  onNewGroup,
  unread,
}: ChannelListProps) {
  const { anyOnline } = usePresence();

  return (
    <nav className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Gesprekken</h2>
        <button
          type="button"
          onClick={onNewDm}
          title="Nieuw gesprek"
          className="flex h-11 w-11 items-center justify-center rounded text-lg leading-none text-ink-500 hover:bg-ink-800 hover:text-ink-100"
        >
          +
        </button>
      </div>

      <ul className="flex-1 overflow-y-auto px-2 pb-2">
        {loading ? <li className="px-2 py-1 text-sm text-ink-500">Laden…</li> : null}

        {!loading && channels.length === 0 ? (
          <li className="px-2 py-2 text-sm leading-relaxed text-ink-500">
            Nog geen gesprekken. Begin er een met + hierboven, of maak een groep.
          </li>
        ) : null}

        {channels.map((channel) => (
          <li key={channel.id}>
            <button
              type="button"
              onClick={() => onSelect(channel.id)}
              className={`flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                channel.id === activeId
                  ? 'bg-ink-800 text-ink-100'
                  : 'text-ink-300 hover:bg-ink-850 hover:text-ink-100'
              }`}
            >
              <span aria-hidden="true" className="shrink-0 text-ink-500">
                {channelPrefix(channel.type)}
              </span>
              {anyOnline(channel.members.map((member) => member.userId)) ? (
                <OnlineDot label={`${channel.displayName} is online`} />
              ) : null}
              <span className="min-w-0 flex-1 truncate">
                {channel.displayName || 'gesprek'}
              </span>
              {channel.type === 'group' && !unread[channel.id] ? (
                <span className="shrink-0 text-xs text-ink-500">{channel.members.length}</span>
              ) : null}
              <UnreadBadge count={unread[channel.id] ?? 0} />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1 border-t border-ink-800 p-2">
        <Button variant="ghost" onClick={onNewDm} className="w-full">
          Nieuw gesprek
        </Button>
        <Button variant="ghost" onClick={onNewGroup} className="w-full">
          Nieuwe groep
        </Button>
      </div>
    </nav>
  );
}
