import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from './Button';
import { ErrorNotice } from './ErrorNotice';
import { Field } from './Field';
import { normalizeChannelName } from '../lib/channelName';
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

  // Shown while typing, so the normalisation is never a surprise afterwards.
  const normalized = normalizeChannelName(name);
  const touched = name.trim().length > 0;

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
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-scrim p-6">
      <div className="w-full max-w-sm rounded-lg border border-subtle bg-raised p-5 shadow-xl">
        <h2 className="text-sm font-semibold text-primary">Kanaal aanmaken</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
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

          <p className="-mt-2 text-xs text-muted" aria-live="polite">
            {!touched ? (
              'Kleine letters, streepjes in plaats van spaties. De # hoef je niet te typen.'
            ) : normalized === '' ? (
              <span className="text-warning">Hier blijft geen naam van over.</span>
            ) : (
              <>
                Wordt aangemaakt als{' '}
                <span className="font-mono text-secondary">#{normalized}</span>
              </>
            )}
          </p>

          <ErrorNotice message={error} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuleren
            </Button>
            <Button type="submit" disabled={busy || normalized === ''}>
              {busy ? 'Bezig…' : 'Aanmaken'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
