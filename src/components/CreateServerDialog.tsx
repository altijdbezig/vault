import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from './Button';
import { ErrorNotice } from './ErrorNotice';
import { Field } from './Field';
import { describeError } from '../lib/errorMessages';

interface CreateServerDialogProps {
  onClose: () => void;
  onCreate: (name: string) => Promise<string>;
  onJoin: (serverId: string) => Promise<void>;
  onCreated: (serverId: string) => void;
}

export function CreateServerDialog({
  onClose,
  onCreate,
  onJoin,
  onCreated,
}: CreateServerDialogProps) {
  const [name, setName] = useState('');
  const [serverId, setServerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await action();
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    await run(async () => {
      onCreated(await onCreate(name));
    });
  }

  async function handleJoin(event: FormEvent): Promise<void> {
    event.preventDefault();
    await run(async () => {
      const trimmed = serverId.trim();
      await onJoin(trimmed);
      onCreated(trimmed);
    });
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-sm rounded-lg border border-ink-800 bg-ink-900 p-5 shadow-xl">
        <h2 className="text-sm font-semibold text-ink-100">Server</h2>

        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3">
          <Field
            label="Nieuwe server"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            hint="Je wordt eigenaar en krijgt meteen een kanaal #algemeen."
          />
          <Button type="submit" disabled={busy || name.trim().length === 0}>
            {busy ? 'Bezig…' : 'Server aanmaken'}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-ink-800" />
          <span className="text-xs uppercase tracking-wide text-ink-500">of</span>
          <div className="h-px flex-1 bg-ink-800" />
        </div>

        <form onSubmit={handleJoin} className="flex flex-col gap-3">
          <Field
            label="Lid worden met server-id"
            value={serverId}
            onChange={(event) => setServerId(event.target.value)}
            hint="Vraag iemand om het server-id. Uitnodigingslinks komen later."
          />
          <Button type="submit" variant="ghost" disabled={busy || serverId.trim().length === 0}>
            {busy ? 'Bezig…' : 'Lid worden'}
          </Button>
        </form>

        <div className="mt-4">
          <ErrorNotice message={error} />
        </div>

        <div className="mt-4 flex justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            Sluiten
          </Button>
        </div>
      </div>
    </div>
  );
}
