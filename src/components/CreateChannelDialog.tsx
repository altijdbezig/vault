import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from './Button';
import { ErrorNotice } from './ErrorNotice';
import { Field } from './Field';
import { describeError } from '../lib/errorMessages';

interface CreateChannelDialogProps {
  onClose: () => void;
  onCreate: (name: string) => Promise<string>;
  onCreated: (channelId: string) => void;
}

export function CreateChannelDialog({ onClose, onCreate, onCreated }: CreateChannelDialogProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onCreated(await onCreate(name));
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
        <h2 className="text-sm font-semibold text-ink-100">Kanaal aanmaken</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          Je bent zelf het eerste lid. Wie later toegevoegd wordt, kan de berichten
          van vóór dat moment niet lezen.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <Field
            label="Kanaalnaam"
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <ErrorNotice message={error} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuleren
            </Button>
            <Button type="submit" disabled={busy || name.trim().length === 0}>
              {busy ? 'Bezig…' : 'Aanmaken'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
