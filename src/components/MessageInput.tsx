import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useCoarsePointer } from '../hooks/useMediaQuery';

interface MessageInputProps {
  disabled?: boolean;
  placeholder?: string;
  onSend: (plaintext: string) => void;
}

export function MessageInput({ disabled = false, placeholder, onSend }: MessageInputProps) {
  const [value, setValue] = useState('');
  const touch = useCoarsePointer();

  function submit(): void {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    setValue('');
    onSend(trimmed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
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
    <div className="border-t border-ink-800 p-3">
      <div className="flex items-end gap-2">
        <textarea
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? 'Bericht versturen…'}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Bericht"
          className="max-h-40 min-h-11 w-full resize-none rounded border border-ink-700 bg-ink-850 px-3 py-2.5 text-base text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-500 disabled:opacity-50 sm:text-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || value.trim().length === 0}
          className="h-11 shrink-0 rounded bg-accent-500 px-4 text-sm font-medium text-white transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Stuur
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-500">
        {touch
          ? 'Alles wordt versleuteld voordat het je browser verlaat.'
          : 'Enter verstuurt, Shift+Enter maakt een nieuwe regel. Alles wordt versleuteld voordat het je browser verlaat.'}
      </p>
    </div>
  );
}
