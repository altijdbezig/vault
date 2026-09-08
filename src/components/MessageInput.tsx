import { useState } from 'react';
import type { KeyboardEvent } from 'react';

interface MessageInputProps {
  disabled?: boolean;
  placeholder?: string;
  onSend: (plaintext: string) => void;
}

export function MessageInput({ disabled = false, placeholder, onSend }: MessageInputProps) {
  const [value, setValue] = useState('');

  function submit(): void {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    setValue('');
    onSend(trimmed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends, Shift+Enter breaks the line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="border-t border-ink-800 p-3">
      <textarea
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? 'Bericht versturen…'}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Bericht"
        className="max-h-40 w-full resize-none rounded border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-500 disabled:opacity-50"
      />
      <p className="mt-1 text-xs text-ink-500">
        Enter verstuurt, Shift+Enter maakt een nieuwe regel. Alles wordt versleuteld
        voordat het je browser verlaat.
      </p>
    </div>
  );
}
