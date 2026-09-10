import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { UnreadBadge } from './UnreadBadge';
import { fuzzyFilter } from '../lib/fuzzy';

export interface CommandItem {
  id: string;
  /** What gets matched and shown. */
  label: string;
  /** Second line: which server a channel is in, or what an action does. */
  detail?: string;
  /** Grouping header. */
  group: string;
  /** A glyph, or an avatar when the entry is a person or a server. */
  icon?: string;
  avatar?: { userId: string; name: string; url: string | null };
  unread?: number;
  onSelect: () => void;
}

interface CommandPaletteProps {
  items: CommandItem[];
  onClose: () => void;
}

/** More than this and the list stops being scannable anyway. */
const MAX_RESULTS = 24;

/**
 * Highlights the matched characters.
 *
 * Built from the indices the matcher already produced rather than by searching
 * the label again, so what lights up is exactly what caused the match. A
 * second search would disagree with the ranking in confusing ways.
 */
function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) {
    return <>{text}</>;
  }

  const marked = new Set(indices);
  const parts: { text: string; hit: boolean }[] = [];

  for (const [index, character] of [...text].entries()) {
    const hit = marked.has(index);
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) {
      last.text += character;
    } else {
      parts.push({ text: character, hit });
    }
  }

  return (
    <>
      {parts.map((part, index) =>
        part.hit ? (
          <mark key={index} className="bg-transparent font-semibold text-accent">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Jump to anything: a conversation, a channel, a server, a setting.
 *
 * Its own overlay rather than Modal, because the shape is different: no title
 * bar, the search field is the whole header, and the list under it is the
 * content. It still does the three things a dialog has to do — Escape, focus
 * in on open, focus back on close.
 *
 * Arrow keys move a highlight while focus stays in the input, which is what
 * makes it usable without the mouse: you type, you arrow, you press Enter,
 * and you never leave the field.
 */
export function CommandPalette({ items, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();

    return () => {
      const target = returnFocusRef.current;
      if (target?.isConnected) {
        target.focus();
      }
    };
  }, []);

  const results = useMemo(
    () => fuzzyFilter(query, items, (item) => `${item.label} ${item.detail ?? ''}`).slice(0, MAX_RESULTS),
    [query, items],
  );

  // A new query means a new list, so the highlight goes back to the top.
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keep the highlighted row on screen when arrowing past the fold.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = useCallback(
    (index: number): void => {
      const chosen = results[index];
      if (!chosen) {
        return;
      }
      // Close first: the action usually navigates, and closing afterwards
      // would set state on a component the navigation may have unmounted.
      onClose();
      chosen.item.onSelect();
    },
    [results, onClose],
  );

  function handleKeyDown(event: React.KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      case 'ArrowDown':
        event.preventDefault();
        setActive((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((current) =>
          results.length === 0 ? 0 : (current - 1 + results.length) % results.length,
        );
        return;
      case 'Home':
        event.preventDefault();
        setActive(0);
        return;
      case 'End':
        event.preventDefault();
        setActive(Math.max(0, results.length - 1));
        return;
      case 'Enter':
        event.preventDefault();
        choose(active);
        return;
      default:
        return;
    }
  }

  // Group headers are drawn when the group changes, which only reads well
  // because equal scores keep their input order.
  let lastGroup: string | null = null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
      <button
        type="button"
        aria-label="Sluiten"
        onClick={onClose}
        className="absolute inset-0 bg-scrim"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Spring naar"
        className="relative flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-subtle bg-raised shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-subtle px-3 py-2.5">
          <span aria-hidden="true" className="text-muted">
            ›
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Spring naar een gesprek, kanaal of instelling…"
            aria-label="Zoek"
            aria-controls="command-results"
            aria-activedescendant={results[active] ? `command-item-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-md text-primary outline-none placeholder:text-muted"
          />
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">
            Niets gevonden voor “{query}”.
          </p>
        ) : (
          <ul
            id="command-results"
            ref={listRef}
            role="listbox"
            aria-label="Resultaten"
            className="min-h-0 flex-1 overflow-y-auto p-1.5"
          >
            {results.map((result, index) => {
              const header = result.item.group !== lastGroup ? result.item.group : null;
              lastGroup = result.item.group;

              return (
                <li key={result.item.id}>
                  {header ? (
                    <p className="px-2 pb-1 pt-2.5 text-2xs font-semibold uppercase tracking-wider text-muted first:pt-0.5">
                      {header}
                    </p>
                  ) : null}

                  <button
                    id={`command-item-${index}`}
                    data-index={index}
                    role="option"
                    type="button"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(index)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${
                      index === active ? 'bg-accent-soft' : 'hover:bg-hover'
                    }`}
                  >
                    {result.item.avatar ? (
                      <Avatar
                        userId={result.item.avatar.userId}
                        name={result.item.avatar.name}
                        url={result.item.avatar.url}
                        size="sm"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-overlay text-xs text-muted"
                      >
                        {result.item.icon ?? '›'}
                      </span>
                    )}

                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm ${
                          index === active ? 'text-primary' : 'text-secondary'
                        }`}
                      >
                        <Highlighted text={result.item.label} indices={result.indices} />
                      </span>
                      {result.item.detail ? (
                        <span className="block truncate text-2xs text-muted">
                          {result.item.detail}
                        </span>
                      ) : null}
                    </span>

                    <UnreadBadge count={result.item.unread ?? 0} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="border-t border-subtle px-3 py-1.5 text-2xs text-muted">
          ↑↓ kiezen · Enter openen · Esc sluiten
        </p>
      </div>
    </div>
  );
}
