import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { IconButton } from './IconButton';
import { useCoarsePointer } from '../hooks/useMediaQuery';

export interface ReplyTarget {
  id: string;
  senderName: string;
  /** Decrypted text of the message being answered, or null. */
  text: string | null;
}

interface MessageInputProps {
  disabled?: boolean;
  placeholder?: string;
  onSend: (plaintext: string, files: File[]) => void;
  /** Usernames in this channel, for @-completion. */
  usernames: readonly string[];
  /** The message being answered, if any. */
  replyTo?: ReplyTarget | null;
  onCancelReply?: () => void;
  /** Called on every keystroke, for the typing indicator. */
  onTyping?: () => void;
  /** What the current upload is doing, so the box can say so. */
  uploading?: { current: number; total: number; name: string; stage: 'encrypting' | 'uploading' } | null;
}

/** How many completions to show at once. */
const MAX_SUGGESTIONS = 6;

/**
 * The partial @mention immediately before the cursor, if there is one.
 *
 * Anchored to a word boundary so an email address does not open the picker
 * halfway through typing it: "iemand@exam" has a letter before the @, so it is
 * not a mention. Returns the range as well, so the completion can replace
 * exactly what was typed.
 */
function mentionAtCursor(
  value: string,
  cursor: number,
): { query: string; from: number; to: number } | null {
  const before = value.slice(0, cursor);
  const match = /(?:^|[\s(])@([a-z0-9._-]*)$/i.exec(before);
  if (!match) {
    return null;
  }

  const query = match[1] ?? '';
  return { query, from: cursor - query.length - 1, to: cursor };
}

export function MessageInput({
  disabled = false,
  placeholder,
  onSend,
  usernames,
  replyTo = null,
  onCancelReply,
  onTyping,
  uploading = null,
}: MessageInputProps) {
  const [value, setValue] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState(0);
  /**
   * Set after a completion is accepted or dismissed, so the list does not
   * spring back open for the same word. Cleared as soon as the mention being
   * typed changes.
   */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const touch = useCoarsePointer();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Opening a reply should put the cursor in the box: the click was on the
  // message, and having to click again into the field is a wasted step.
  useEffect(() => {
    if (replyTo) {
      textareaRef.current?.focus();
    }
  }, [replyTo]);

  const mention = mentionAtCursor(value, cursor);
  const suggestions = useMemo(() => {
    if (!mention || dismissed === mention.query) {
      return [];
    }
    const query = mention.query.toLowerCase();
    return usernames
      .filter((name) => name.toLowerCase().startsWith(query))
      .slice(0, MAX_SUGGESTIONS);
  }, [mention, usernames, dismissed]);

  useEffect(() => {
    setActive(0);
  }, [mention?.query]);

  function submit(): void {
    const trimmed = value.trim();
    // An attachment with no words is a normal message; empty with no files is
    // not.
    if (disabled || (trimmed === '' && files.length === 0)) {
      return;
    }
    setValue('');
    setFiles([]);
    setDismissed(null);
    // The picker keeps its last selection, so picking the same file twice in a
    // row would otherwise do nothing the second time.
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onSend(trimmed, files);
  }

  function addFiles(picked: FileList | null): void {
    if (!picked || picked.length === 0) {
      return;
    }
    setFiles((current) => [...current, ...Array.from(picked)]);
  }

  function complete(username: string): void {
    if (!mention) {
      return;
    }

    // The trailing space is what lets you keep typing after a mention without
    // reopening the list on the next character.
    const next = `${value.slice(0, mention.from)}@${username} ${value.slice(mention.to)}`;
    const caret = mention.from + username.length + 2;

    setValue(next);
    setDismissed(null);

    // The DOM value is set by React on the next render, so the caret has to
    // move after that, not now.
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (element) {
        element.focus();
        element.setSelectionRange(caret, caret);
        setCursor(caret);
      }
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // The completion list owns the arrow keys, Enter, Tab and Escape while it
    // is open. Without this, Enter would send "@benj" instead of completing.
    if (suggestions.length > 0) {
      const chosen = suggestions[active];

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setActive((current) => (current + 1) % suggestions.length);
          return;
        case 'ArrowUp':
          event.preventDefault();
          setActive((current) => (current - 1 + suggestions.length) % suggestions.length);
          return;
        case 'Tab':
        case 'Enter':
          if (chosen) {
            event.preventDefault();
            complete(chosen);
            return;
          }
          break;
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          setDismissed(mention?.query ?? '');
          return;
        default:
          break;
      }
    }

    if (event.key === 'Escape' && replyTo && onCancelReply) {
      event.stopPropagation();
      onCancelReply();
      return;
    }

    // On a phone Enter is the only way to start a new line, so it must not
    // send there. On a desktop keyboard Enter sends and Shift+Enter breaks
    // the line, which is what people expect from a chat app.
    if (touch) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="border-t border-subtle p-2 md:p-3">
      {replyTo ? (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-subtle bg-overlay px-2 py-1.5">
          <span aria-hidden="true" className="text-xs text-muted">
            ↩
          </span>
          <p className="min-w-0 flex-1 truncate text-xs text-muted">
            Antwoord aan <span className="font-medium text-secondary">{replyTo.senderName}</span>
            {replyTo.text ? (
              <span className="italic"> — {replyTo.text.replace(/\s*\n\s*/g, ' ')}</span>
            ) : null}
          </p>
          <IconButton label="Antwoord annuleren" size="sm" onClick={onCancelReply}>
            ×
          </IconButton>
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex max-w-full items-center gap-1.5 rounded-md border border-subtle bg-overlay py-1 pl-2 pr-1"
            >
              <span aria-hidden="true" className="text-2xs">
                {file.type.startsWith('image/') ? '🖼️' : '📎'}
              </span>
              <span className="min-w-0 truncate text-2xs text-secondary">{file.name}</span>
              <span className="shrink-0 text-2xs text-muted">
                {file.size < 1024 * 1024
                  ? `${Math.max(1, Math.round(file.size / 1024))} kB`
                  : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
              </span>
              <IconButton
                label={`${file.name} weghalen`}
                size="sm"
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
              >
                ×
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}

      {uploading ? (
        <p role="status" className="mb-2 text-2xs text-muted">
          {uploading.stage === 'encrypting' ? 'Versleutelen' : 'Uploaden'}:{' '}
          <span className="text-secondary">{uploading.name}</span>
          {uploading.total > 1 ? ` (${uploading.current} van ${uploading.total})` : null}
          {/* Real byte progress is not available: supabase-js has no upload
              progress callback, so this reports the stage per file instead of
              inventing a percentage. */}
        </p>
      ) : null}

      <div className="relative flex items-end gap-2">
        {suggestions.length > 0 ? (
          <ul
            role="listbox"
            aria-label="Gebruikers"
            className="absolute bottom-full left-0 z-30 mb-1 w-56 overflow-hidden rounded-lg border border-subtle bg-overlay py-1 shadow-lg"
          >
            {suggestions.map((username, index) => (
              <li key={username}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  // onMouseDown, not onClick: the textarea loses focus on
                  // mousedown, which closes the list before a click lands.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    complete(username);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                    index === active ? 'bg-hover text-primary' : 'text-secondary'
                  }`}
                >
                  <span className="text-muted">@</span>
                  {username}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? 'Bericht versturen…'}
          onChange={(event) => {
            setValue(event.target.value);
            setCursor(event.target.selectionStart ?? event.target.value.length);
            if (dismissed !== null) {
              setDismissed(null);
            }
            onTyping?.();
          }}
          // The caret can also move without the value changing (a click, an
          // arrow key), and the completion list depends on where it is.
          onSelect={(event) => setCursor(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={handleKeyDown}
          aria-label="Bericht"
          className="max-h-40 min-h-11 w-full resize-none rounded-md border border-subtle bg-inset px-3 py-2.5 text-base text-primary transition-colors outline-none placeholder:text-muted focus:border-accent disabled:opacity-50 sm:text-sm"
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(event) => addFiles(event.target.files)}
          className="sr-only"
          aria-label="Bestanden kiezen"
        />
        <IconButton
          label="Bijlage toevoegen"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="h-11 w-11 border border-subtle bg-inset"
        >
          📎
        </IconButton>
        <button
          type="button"
          onClick={submit}
          disabled={disabled || (value.trim().length === 0 && files.length === 0)}
          className="h-11 shrink-0 rounded-md bg-accent px-4 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Stuur
        </button>
      </div>

      <p className="mt-1 text-2xs text-muted">
        {touch
          ? 'Alles wordt versleuteld voordat het je browser verlaat.'
          : 'Enter verstuurt, Shift+Enter maakt een nieuwe regel. Alles wordt versleuteld voordat het je browser verlaat.'}
      </p>
    </div>
  );
}
