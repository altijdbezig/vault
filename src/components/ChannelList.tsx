import { Button } from './Button';
import { SkeletonList } from './Skeleton';
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
  /**
   * Right-click on a row. The menu itself is built by the caller, which is
   * where the actions live; this only reports where and on what.
   */
  onContextMenu?: (channel: ChannelSummary, x: number, y: number) => void;
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
  onContextMenu,
}: ChannelListProps) {
  const { anyOnline } = usePresence();

  return (
    <nav className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Gesprekken</h2>
        <button
          type="button"
          onClick={onNewDm}
          title="Nieuw gesprek"
          className="flex h-11 w-11 items-center justify-center rounded text-lg leading-none text-muted hover:bg-hover hover:text-primary"
        >
          +
        </button>
      </div>

      <ul className="flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <li>
            <SkeletonList rows={5} />
          </li>
        ) : null}

        {!loading && channels.length === 0 ? (
          <li className="px-2 py-2 text-sm leading-relaxed text-muted">
            Nog geen gesprekken. Begin er een met + hierboven, of maak een groep.
          </li>
        ) : null}

        {channels.map((channel) => (
          <li key={channel.id}>
            <button
              type="button"
              onClick={() => onSelect(channel.id)}
              onContextMenu={
                onContextMenu
                  ? (event) => {
                      event.preventDefault();
                      onContextMenu(channel, event.clientX, event.clientY);
                    }
                  : undefined
              }
              className={`flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                channel.id === activeId
                  ? 'bg-overlay text-primary'
                  : 'text-secondary hover:bg-hover hover:text-primary'
              }`}
            >
              <span aria-hidden="true" className="shrink-0 text-muted">
                {channelPrefix(channel.type)}
              </span>
              {anyOnline(channel.members.map((member) => member.userId)) ? (
                <OnlineDot label={`${channel.displayName} is online`} />
              ) : null}
              <span className="min-w-0 flex-1 truncate">
                {channel.displayName || 'gesprek'}
              </span>
              {channel.type === 'group' && !unread[channel.id] ? (
                <span className="shrink-0 text-xs text-muted">{channel.members.length}</span>
              ) : null}
              <UnreadBadge count={unread[channel.id] ?? 0} />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1 border-t border-subtle p-2">
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
