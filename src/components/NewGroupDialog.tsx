import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from './Button';
import { ErrorNotice } from './ErrorNotice';
import { Field } from './Field';
import { describeError } from '../lib/errorMessages';

interface NewGroupDialogProps {
  onClose: () => void;
  onCreate: (name: string, usernames: string[]) => Promise<string>;
  onCreated: (channelId: string) => void;
}

export function NewGroupDialog({ onClose, onCreate, onCreated }: NewGroupDialogProps) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernames, setUsernames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addUsername(): void {
    const trimmed = username.trim();
    if (!trimmed || usernames.includes(trimmed)) {
      setUsername('');
      return;
    }
    setUsernames((current) => [...current, trimmed]);
    setUsername('');
  }

  function removeUsername(target: string): void {
    setUsernames((current) => current.filter((item) => item !== target));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onCreated(await onCreate(name, usernames));
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
        <h2 className="text-sm font-semibold text-ink-100">Nieuwe groep</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          Iedereen die je nu toevoegt kan meelezen vanaf het eerste bericht. Wie
          je later toevoegt, kan alles van vóór dat moment niet lezen.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <Field
            label="Groepsnaam"
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field
                  label="Deelnemer toevoegen"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter adds a name here; it must not submit the group.
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addUsername();
                    }
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={addUsername}
                disabled={username.trim().length === 0}
              >
                Toevoegen
              </Button>
            </div>

            {usernames.length === 0 ? (
              <p className="text-xs text-ink-500">Nog niemand toegevoegd.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {usernames.map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      onClick={() => removeUsername(item)}
                      title={`${item} weghalen`}
                      className="flex min-h-9 items-center gap-1.5 rounded bg-ink-800 px-2 py-1 text-sm text-ink-100 hover:bg-ink-700"
                    >
                      {item}
                      <span aria-hidden="true" className="text-ink-500">
                        ×
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <ErrorNotice message={error} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuleren
            </Button>
            <Button
              type="submit"
              disabled={busy || name.trim().length === 0 || usernames.length === 0}
            >
              {busy ? 'Bezig…' : 'Groep maken'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
