import { Button } from './Button';
import type { ChannelSummary } from '../types';

interface ChannelListProps {
  channels: ChannelSummary[];
  activeId: string | null;
  loading: boolean;
  onSelect: (channelId: string) => void;
  onNewDm: () => void;
}

export function ChannelList({
  channels,
  activeId,
  loading,
  onSelect,
  onNewDm,
}: ChannelListProps) {
  return (
    <nav className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Gesprekken</h2>
        <button
          type="button"
          onClick={onNewDm}
          title="Nieuw gesprek"
          className="rounded px-1.5 text-lg leading-none text-ink-500 hover:bg-ink-800 hover:text-ink-100"
        >
          +
        </button>
      </div>

      <ul className="flex-1 overflow-y-auto px-2 pb-2">
        {loading ? <li className="px-2 py-1 text-sm text-ink-500">Laden…</li> : null}

        {!loading && channels.length === 0 ? (
          <li className="px-2 py-1 text-sm leading-relaxed text-ink-500">
            Nog geen gesprekken. Begin er een met +.
          </li>
        ) : null}

        {channels.map((channel) => (
          <li key={channel.id}>
            <button
              type="button"
              onClick={() => onSelect(channel.id)}
              className={`w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                channel.id === activeId
                  ? 'bg-ink-800 text-ink-100'
                  : 'text-ink-300 hover:bg-ink-850 hover:text-ink-100'
              }`}
            >
              <span className="text-ink-500">@</span> {channel.displayName || 'gesprek'}
            </button>
          </li>
        ))}
      </ul>

      <div className="border-t border-ink-800 p-2">
        <Button variant="ghost" onClick={onNewDm} className="w-full">
          Nieuw gesprek
        </Button>
      </div>
    </nav>
  );
}
