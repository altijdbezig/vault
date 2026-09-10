import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import type { DisplayMessage } from '../hooks/useMessages';

interface MessageSearchProps {
  messages: DisplayMessage[];
  /** True while a page of older messages is on its way in. */
  loadingOlder: boolean;
  /** True once the very first message of the channel is loaded. */
  reachedStart: boolean;
  onLoadOlder: () => void;
  onJump: (messageId: string) => void;
  onClose: () => void;
}

/** Enough matches to scan; more than this and the query is too broad anyway. */
const MAX_RESULTS = 40;

/** Characters of context to show around a hit. */
const SNIPPET_PADDING = 40;

/**
 * Client-side search through the messages that are loaded.
 *
 * This is the only kind of search this app can have, and the UI says so
 * instead of pretending otherwise. The server holds ciphertext; there is no
 * index to query and there will not be one, because building one would mean
 * handing it something it could read. So: search runs over the plaintext that
 * is already decrypted in this tab, and the panel is explicit about the
 * boundary and offers the button that moves it.
 */
export function MessageSearch({
  messages,
  loadingOlder,
  reachedStart,
  onLoadOlder,
  onJump,
  onClose,
}: MessageSearchProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) {
      return [];
    }

    const found: { message: DisplayMessage; snippet: string; at: number }[] = [];

    // Newest first: in a chat, the thing you are looking for is usually
    // recent, and the list is read from the top.
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message.text === null || message.deleted) {
        continue;
      }

      const at = message.text.toLowerCase().indexOf(needle);
      if (at === -1) {
        continue;
      }

      const start = Math.max(0, at - SNIPPET_PADDING);
      const end = Math.min(message.text.length, at + needle.length + SNIPPET_PADDING);
      const snippet =
        (start > 0 ? '…' : '') +
        message.text.slice(start, end).replace(/\s*\n\s*/g, ' ') +
        (end < message.text.length ? '…' : '');

      found.push({ message, snippet, at: at - start + (start > 0 ? 1 : 0) });

      if (found.length >= MAX_RESULTS) {
        break;
      }
    }

    return found;
  }, [messages, query]);

  const needleLength = query.trim().length;
  const searchable = messages.filter(
    (message) => message.text !== null && !message.deleted,
  ).length;

  return (
    <div className="absolute inset-x-0 top-0 z-30 flex max-h-full flex-col border-b border-subtle bg-raised shadow-md">
      <div className="flex items-center gap-2 px-2 py-2 md:px-4">
        <span aria-hidden="true" className="text-sm text-muted">
          🔍
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              onClose();
            }
          }}
          placeholder="Zoek in dit gesprek…"
          aria-label="Zoek in dit gesprek"
          className="min-h-9 min-w-0 flex-1 rounded-md border border-subtle bg-inset px-2.5 py-1.5 text-base text-primary outline-none placeholder:text-muted focus:border-accent sm:text-sm"
        />
        <IconButton label="Zoeken sluiten" size="sm" onClick={onClose}>
          ×
        </IconButton>
      </div>

      <p className="px-3 pb-2 text-2xs leading-relaxed text-muted md:px-4">
        Er wordt alleen gezocht in de <strong>{searchable}</strong> berichten die nu
        ontsleuteld in dit tabblad staan. De server heeft alleen ciphertext, dus
        verder zoeken kan niet — laad eerst meer geschiedenis.
        {reachedStart ? ' Het begin van het gesprek is geladen.' : null}
      </p>

      {!reachedStart ? (
        <div className="px-3 pb-2 md:px-4">
          <Button variant="secondary" onClick={onLoadOlder} disabled={loadingOlder}>
            {loadingOlder ? 'Laden…' : 'Meer geschiedenis laden'}
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-subtle">
        {needleLength > 0 && needleLength < 2 ? (
          <p className="px-3 py-3 text-xs text-muted md:px-4">Typ nog een letter.</p>
        ) : null}

        {needleLength >= 2 && results.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted md:px-4">
            Niets gevonden in de geladen berichten.
          </p>
        ) : null}

        {results.length > 0 ? (
          <>
            <p
              role="status"
              className="px-3 pt-2 text-2xs uppercase tracking-wider text-muted md:px-4"
            >
              {results.length === MAX_RESULTS
                ? `Eerste ${MAX_RESULTS} treffers`
                : `${results.length} ${results.length === 1 ? 'treffer' : 'treffers'}`}
            </p>
            <ul className="p-1.5 md:px-3">
              {results.map(({ message, snippet, at }) => (
                <li key={message.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onJump(message.id);
                      onClose();
                    }}
                    className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-primary">
                        {message.senderName}
                      </span>
                      <time className="text-2xs text-muted">
                        {new Date(message.createdAt).toLocaleString('nl-NL', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-secondary">
                      {/* The hit itself is marked rather than the whole line,
                          so a long message still shows why it matched. */}
                      {snippet.slice(0, at)}
                      <mark className="rounded bg-accent-soft px-0.5 text-accent">
                        {snippet.slice(at, at + needleLength)}
                      </mark>
                      {snippet.slice(at + needleLength)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
