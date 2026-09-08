import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from './Button';
import { ErrorNotice } from './ErrorNotice';
import { Field } from './Field';
import { describeError } from '../lib/errorMessages';

interface AddGroupMemberDialogProps {
  groupName: string;
  onClose: () => void;
  onAdd: (username: string) => Promise<void>;
}

/**
 * Adding someone to a group.
 *
 * The warning is the point of this dialog, and it is deliberately shown before
 * you confirm rather than afterwards. Everything already in the channel was
 * encrypted to the keys of the members at the time; the new member's key was
 * not among them, and no amount of re-reading changes that. Finding out only
 * once the placeholders appear feels like a bug, so we say it up front.
 */
export function AddGroupMemberDialog({ groupName, onClose, onAdd }: AddGroupMemberDialogProps) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onAdd(username);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-full w-full max-w-sm overflow-y-auto rounded-lg border border-ink-800 bg-ink-900 p-5 shadow-xl">
        <h2 className="text-sm font-semibold text-ink-100">Lid toevoegen aan {groupName}</h2>

        <p className="mt-3 rounded border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs leading-relaxed text-amber-200">
          Let op: dit lid kan de berichten van vóór nu <strong>niet</strong> lezen.
          Die zijn versleuteld met de sleutels van de leden op dat moment en dat
          is achteraf niet te veranderen. Voor hen blijft de geschiedenis leeg.
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
            <Button type="submit" disabled={busy || username.trim().length === 0}>
              {busy ? 'Bezig…' : 'Toevoegen'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
