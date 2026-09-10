import { Button } from './Button';
import { SkeletonList } from './Skeleton';
import { UnreadBadge } from './UnreadBadge';
import type { ChannelSummary, ServerSummary } from '../types';

interface ChannelSidebarProps {
  server: ServerSummary;
  channels: ChannelSummary[];
  activeChannelId: string | null;
  loading: boolean;
  canCreateChannel: boolean;
  memberCount: number;
  onSelect: (channelId: string) => void;
  onCreateChannel: () => void;
  /** Unread messages per channel id. */
  unread: Record<string, number>;
  /** The shareable /join link for this server. */
  inviteLink: string;
}

export function ChannelSidebar({
  server,
  channels,
  activeChannelId,
  loading,
  canCreateChannel,
  memberCount,
  onSelect,
  onCreateChannel,
  unread,
  inviteLink,
}: ChannelSidebarProps) {
  return (
    <nav className="flex h-full flex-col">
      <header className="border-b border-subtle px-3 py-2.5">
        <h2 className="truncate text-sm font-semibold text-primary">{server.name}</h2>
        <p className="text-xs text-muted">
          {memberCount} {memberCount === 1 ? 'lid' : 'leden'} · jij bent {server.role}
        </p>
      </header>

      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Kanalen</h3>
        {canCreateChannel ? (
          <button
            type="button"
            onClick={onCreateChannel}
            title="Kanaal aanmaken"
            className="flex h-11 w-11 items-center justify-center rounded text-lg leading-none text-muted hover:bg-hover hover:text-primary"
          >
            +
          </button>
        ) : null}
      </div>

      <ul className="flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <li>
            <SkeletonList rows={4} />
          </li>
        ) : null}

        {!loading && channels.length === 0 ? (
          <li className="px-2 py-2 text-sm leading-relaxed text-muted">
            {canCreateChannel
              ? 'Nog geen kanalen. Maak er een met + hierboven.'
              : 'Nog geen kanalen. Alleen de eigenaar of een admin kan er een aanmaken.'}
          </li>
        ) : null}

        {channels.map((channel) => (
          <li key={channel.id}>
            <button
              type="button"
              onClick={() => onSelect(channel.id)}
              className={`flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                channel.id === activeChannelId
                  ? 'bg-overlay text-primary'
                  : 'text-secondary hover:bg-hover hover:text-primary'
              }`}
            >
              <span aria-hidden="true" className="shrink-0 text-muted">
                #
              </span>
              <span className="min-w-0 flex-1 truncate">{channel.displayName}</span>
              <UnreadBadge count={unread[channel.id] ?? 0} />
            </button>
          </li>
        ))}
      </ul>

      <div className="border-t border-subtle p-2">
        <p className="px-1 text-xs text-muted">Uitnodigingslink:</p>
        <code className="mt-1 block select-all break-all rounded bg-base px-2 py-1 font-mono text-2xs text-secondary">
          {inviteLink}
        </code>
        <p className="mt-1 px-1 text-2xs leading-relaxed text-muted">
          Wie hem opent en inlogt, komt meteen in de server. Werkt het plakken
          niet, dan kan het server-id ook: <span className="select-all">{server.id}</span>
        </p>
        {canCreateChannel ? (
          <Button variant="ghost" onClick={onCreateChannel} className="mt-2 w-full">
            Kanaal aanmaken
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
