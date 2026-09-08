import type { ServerSummary } from '../types';

interface ServerRailProps {
  servers: ServerSummary[];
  activeServerId: string | null;
  /** True when the DM list is showing instead of a server. */
  dmActive: boolean;
  onSelectDm: () => void;
  onSelectServer: (serverId: string) => void;
  onCreateServer: () => void;
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
}: ServerRailProps) {
  return (
    <nav
      aria-label="Servers"
      className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-ink-800 bg-ink-950 py-2"
    >
      <button
        type="button"
        onClick={onSelectDm}
        title="Directe berichten"
        aria-current={dmActive ? 'page' : undefined}
        className={`flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-semibold transition-colors ${
          dmActive
            ? 'rounded-xl bg-accent-500 text-white'
            : 'bg-ink-800 text-ink-300 hover:rounded-xl hover:bg-accent-500 hover:text-white'
        }`}
      >
        DM
      </button>

      <div className="h-px w-8 bg-ink-800" />

      <ul className="flex flex-1 flex-col items-center gap-2 overflow-y-auto">
        {servers.map((server) => (
          <li key={server.id}>
            <button
              type="button"
              onClick={() => onSelectServer(server.id)}
              title={server.name}
              aria-current={server.id === activeServerId ? 'page' : undefined}
              className={`flex h-10 w-10 items-center justify-center rounded-2xl text-xs font-semibold transition-colors ${
                server.id === activeServerId
                  ? 'rounded-xl bg-accent-500 text-white'
                  : 'bg-ink-800 text-ink-300 hover:rounded-xl hover:bg-ink-700 hover:text-ink-100'
              }`}
            >
              {initials(server.name)}
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onCreateServer}
        title="Server aanmaken of joinen"
        className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-800 text-lg text-ink-300 hover:rounded-xl hover:bg-ink-700 hover:text-ink-100"
      >
        +
      </button>
    </nav>
  );
}
