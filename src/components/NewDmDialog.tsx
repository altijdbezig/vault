import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from './Button';
import { ErrorNotice } from './ErrorNotice';
import { Field } from './Field';
import { describeError } from '../lib/errorMessages';

interface NewDmDialogProps {
  onClose: () => void;
  onStart: (username: string) => Promise<string>;
  onStarted: (channelId: string) => void;
}

export function NewDmDialog({ onClose, onStart, onStarted }: NewDmDialogProps) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onStarted(await onStart(username));
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-sm rounded-lg border border-ink-800 bg-ink-900 p-5 shadow-xl">
        <h2 className="text-sm font-semibold text-ink-100">Nieuw gesprek</h2>
        <p className="mt-1 text-xs text-ink-500">
          Zoek op gebruikersnaam. Bestaat het gesprek al, dan open je het gewoon opnieuw.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <Field
            label="Gebruikersnaam"
            autoFocus
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />

          <ErrorNotice message={error} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuleren
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Bezig…' : 'Beginnen'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
