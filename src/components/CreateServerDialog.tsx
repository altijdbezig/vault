import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from './Button';
import { ErrorNotice } from './ErrorNotice';
import { Field } from './Field';
import { describeError } from '../lib/errorMessages';
import { serverIdFromInvite } from '../lib/invite';

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
  const [invite, setInvite] = useState('');
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

  // Accepts a full invite link or the bare id, so pasting either works.
  const invitedServerId = serverIdFromInvite(invite);

  async function handleJoin(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!invitedServerId) {
      setError('Dit is geen geldige uitnodigingslink of server-id.');
      return;
    }
    await run(async () => {
      await onJoin(invitedServerId);
      onCreated(invitedServerId);
    });
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-scrim p-6">
      <div className="w-full max-w-sm rounded-lg border border-subtle bg-raised p-5 shadow-xl">
        <h2 className="text-sm font-semibold text-primary">Server</h2>

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
          <div className="h-px flex-1 bg-overlay" />
          <span className="text-xs uppercase tracking-wide text-muted">of</span>
          <div className="h-px flex-1 bg-overlay" />
        </div>

        <form onSubmit={handleJoin} className="flex flex-col gap-3">
          <Field
            label="Lid worden met een uitnodiging"
            value={invite}
            onChange={(event) => setInvite(event.target.value)}
            placeholder="https://…/join/…"
            hint="Plak de uitnodigingslink die je hebt gekregen. Het kale server-id werkt ook."
          />
          <Button type="submit" variant="ghost" disabled={busy || invite.trim().length === 0}>
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
