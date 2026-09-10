import { useEffect, useRef, useState } from 'react';
import { QUICK_REACTIONS, searchEmoji } from '../lib/emoji';

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Which way the panel opens, so it does not run off the top of the list. */
  align?: 'left' | 'right';
}

/**
 * The reaction picker: a quick row and a searchable grid.
 *
 * Not a Modal, on purpose. A reaction is a two-click interaction and a
 * full-screen dialog with a scrim for putting a thumbs-up under a message
 * would be absurd. So this is a popover with its own Escape and
 * click-outside handling, and it still traps nothing — Tab walks out of it,
 * which for a popover is correct behaviour.
 */
export function EmojiPicker({ onPick, onClose, align = 'left' }: EmojiPickerProps) {
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        // stopPropagation so Escape closes the picker and not, in the same
        // keystroke, the conversation's reply banner behind it.
        event.stopPropagation();
        onClose();
      }
    }

    function onPointerDown(event: PointerEvent): void {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) {
        onClose();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    // Captured on the document so a click anywhere closes it, including on
    // another message's picker button.
    document.addEventListener('pointerdown', onPointerDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  const results = searchEmoji(query);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Kies een emoji"
      className={`absolute bottom-full z-30 mb-1 w-64 overflow-hidden rounded-lg border border-subtle bg-overlay shadow-lg ${
        align === 'right' ? 'right-0' : 'left-0'
      }`}
    >
      <div className="flex gap-0.5 border-b border-subtle p-1.5">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onPick(emoji)}
            aria-label={`Reageer met ${emoji}`}
            className="flex h-8 flex-1 items-center justify-center rounded text-base transition-colors hover:bg-hover"
          >
            {emoji}
          </button>
        ))}
      </div>

      <div className="p-1.5">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Zoek een emoji…"
          aria-label="Zoek een emoji"
          className="mb-1.5 min-h-8 w-full rounded border border-subtle bg-inset px-2 py-1 text-sm text-primary outline-none placeholder:text-muted focus:border-accent"
        />

        {results.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-muted">
            Niets gevonden. Probeer een ander woord.
          </p>
        ) : (
          <div className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto">
            {results.map((entry) => (
              <button
                key={entry.emoji}
                type="button"
                onClick={() => onPick(entry.emoji)}
                // The first keyword is the most descriptive one, so it makes
                // the better label of the two.
                aria-label={`Reageer met ${entry.keywords[0] ?? entry.emoji}`}
                title={entry.keywords[0]}
                className="flex h-7 items-center justify-center rounded text-base transition-colors hover:bg-hover"
              >
                {entry.emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
