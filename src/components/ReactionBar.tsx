import type { ReactionGroup } from '../types';

interface ReactionBarProps {
  groups: ReactionGroup[];
  onToggle: (emoji: string) => void;
}

/**
 * How many names to list before summarising.
 *
 * Six fits in a tooltip without becoming a paragraph, and past that the exact
 * list stops being the useful part anyway.
 */
const MAX_NAMES = 6;

function tooltipFor(group: ReactionGroup): string {
  const names =
    group.usernames.length > MAX_NAMES
      ? [...group.usernames.slice(0, MAX_NAMES), `en ${group.usernames.length - MAX_NAMES} meer`]
      : group.usernames;

  return `${names.join(', ')} reageerde${group.usernames.length === 1 ? '' : 'n'} met ${group.emoji}`;
}

export function ReactionBar({ groups, onToggle }: ReactionBarProps) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {groups.map((group) => {
        const label = tooltipFor(group);

        return (
          <button
            key={group.emoji}
            type="button"
            onClick={() => onToggle(group.emoji)}
            // title for the mouse, aria-label for a screen reader: both need
            // to say who reacted, since the emoji alone says nothing.
            title={label}
            aria-label={label}
            // aria-pressed is what makes this a toggle rather than a button
            // that happens to look different when it is yours.
            aria-pressed={group.mine}
            className={`flex h-6 items-center gap-1 rounded-full border px-1.5 text-xs transition-colors ${
              group.mine
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-subtle bg-overlay text-secondary hover:border-strong hover:text-primary'
            }`}
          >
            <span aria-hidden="true">{group.emoji}</span>
            <span className="font-medium">{group.userIds.length}</span>
          </button>
        );
      })}
    </div>
  );
}
