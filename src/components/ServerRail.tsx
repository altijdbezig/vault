import type { ServerSummary } from '../types';

interface ServerRailProps {
  servers: ServerSummary[];
  activeServerId: string | null;
  /** True when the DM list is showing instead of a server. */
  dmActive: boolean;
  onSelectDm: () => void;
  onSelectServer: (serverId: string) => void;
  onCreateServer: () => void;
  /** True when something inside that server is unread. */
  hasUnread: (serverId: string) => boolean;
  /** Unread messages across all DMs and groups. */
  dmUnread: number;
}

/**
 * A dot, not a number.
 *
 * At rail size a count is unreadable, and "there is something here" is the
 * only thing this level of the interface has to say.
 */
function UnreadDot({ label }: { label: string }) {
  return (
    <span
      aria-label={label}
      className="pointer-events-none absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-base bg-accent"
    />
  );
}

/** Two letters is enough to tell servers apart at this size. */
function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

export function ServerRail({
  servers,
  activeServerId,
  dmActive,
  onSelectDm,
  onSelectServer,
  onCreateServer,
  hasUnread,
  dmUnread,
}: ServerRailProps) {
  return (
    <nav
      aria-label="Servers"
      className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-subtle bg-base py-2"
    >
      <div className="relative">
        <button
          type="button"
          onClick={onSelectDm}
          title="Directe berichten"
          aria-current={dmActive ? 'page' : undefined}
          className={`flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-semibold transition-colors ${
            dmActive
              ? 'rounded-xl bg-accent text-accent-on'
              : 'bg-overlay text-secondary hover:rounded-xl hover:bg-accent-hover hover:text-accent-on'
          }`}
        >
          DM
        </button>
        {dmUnread > 0 && !dmActive ? <UnreadDot label="ongelezen gesprekken" /> : null}
      </div>

      <div className="h-px w-8 bg-overlay" />

      <ul className="flex flex-1 flex-col items-center gap-2 overflow-y-auto">
        {servers.length === 0 ? (
          <li className="px-1 text-center text-2xs leading-tight text-muted">
            nog geen servers
          </li>
        ) : null}

        {servers.map((server) => (
          <li key={server.id} className="relative">
            <button
              type="button"
              onClick={() => onSelectServer(server.id)}
              title={server.name}
              aria-current={server.id === activeServerId ? 'page' : undefined}
              className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xs font-semibold transition-colors ${
                server.id === activeServerId
                  ? 'rounded-xl bg-accent text-accent-on'
                  : 'bg-overlay text-secondary hover:rounded-xl hover:bg-active hover:text-primary'
              }`}
            >
              {initials(server.name)}
            </button>
            {hasUnread(server.id) ? <UnreadDot label={`ongelezen in ${server.name}`} /> : null}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onCreateServer}
        title="Server aanmaken of joinen"
        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-overlay text-lg text-secondary hover:rounded-xl hover:bg-active hover:text-primary"
      >
        +
      </button>
    </nav>
  );
}
