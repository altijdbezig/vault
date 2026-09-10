import { Avatar } from './Avatar';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { SkeletonList } from './Skeleton';
import { UnreadBadge } from './UnreadBadge';
import type { ChannelSummary, ServerRole, ServerSummary } from '../types';

const ROLE_LABELS: Record<ServerRole, string> = {
  owner: 'eigenaar',
  admin: 'admin',
  member: 'lid',
};

interface ChannelSidebarProps {
  server: ServerSummary;
  /** Opens the server settings dialog. Owners and admins only. */
  onOpenSettings: () => void;
  /** Leaves the server. Absent for the owner, who has to transfer first. */
  onLeaveServer?: () => void;
  channels: ChannelSummary[];
  activeChannelId: string | null;
  loading: boolean;
  canCreateChannel: boolean;
  memberCount: number;
  onSelect: (channelId: string) => void;
  onCreateChannel: () => void;
  /** Unread messages per channel id. */
  unread: Record<string, number>;
}

export function ChannelSidebar({
  server,
  onOpenSettings,
  onLeaveServer,
  channels,
  activeChannelId,
  loading,
  canCreateChannel,
  memberCount,
  onSelect,
  onCreateChannel,
  unread,
}: ChannelSidebarProps) {
  return (
    <nav className="flex h-full flex-col">
      <header className="flex items-start gap-2 border-b border-subtle px-3 py-2.5">
        <Avatar userId={server.id} name={server.name} url={server.iconUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-primary">{server.name}</h2>
          <p className="truncate text-2xs text-muted">
            {memberCount} {memberCount === 1 ? 'lid' : 'leden'} · jij bent{' '}
            {ROLE_LABELS[server.role]}
          </p>
        </div>
        {canCreateChannel ? (
          <IconButton label="Serverinstellingen" size="sm" onClick={onOpenSettings}>
            ⚙
          </IconButton>
        ) : null}
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

      <div className="flex flex-col gap-1 border-t border-subtle p-2">
        {canCreateChannel ? (
          <>
            <Button variant="ghost" block onClick={onCreateChannel}>
              Kanaal aanmaken
            </Button>
            {/* Invites moved into server settings. A copyable link sitting
                permanently in the sidebar is one accidental screenshot away
                from being public, and it could not carry an expiry or a use
                limit. */}
            <Button variant="ghost" block onClick={onOpenSettings}>
              Uitnodigingen beheren
            </Button>
          </>
        ) : null}
        {onLeaveServer ? (
          <Button variant="danger" block onClick={onLeaveServer}>
            Server verlaten
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
