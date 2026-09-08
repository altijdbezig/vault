import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { AuthCard } from '../components/AuthCard';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { Field } from '../components/Field';
import { useAuth } from '../hooks/useAuth';
import { describeError } from '../lib/errorMessages';

export function UnlockPage() {
  const { profile, needsKeyImport, unlock, importKey, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [armored, setArmored] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (needsKeyImport) {
        await importKey(armored, password);
      } else {
        await unlock(password);
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setArmored(await file.text());
  }

  return (
    <AuthCard
      title={needsKeyImport ? 'Sleutel importeren' : 'Ontgrendelen'}
      subtitle={
        needsKeyImport
          ? 'Op dit apparaat staat nog geen sleutel. Importeer je back-upbestand.'
          : `Welkom terug${profile ? `, ${profile.username}` : ''}. Voer je wachtwoord in.`
      }
      footer={
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
          className="text-ink-500 hover:text-ink-300 hover:underline"
        >
          Uitloggen
        </button>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {needsKeyImport ? (
          <div className="flex flex-col gap-2">
            <label
              htmlFor="key-file"
              className="text-xs font-semibold uppercase tracking-wide text-ink-300"
            >
              Sleutelbestand
            </label>
            <input
              id="key-file"
              type="file"
              accept=".asc,.txt,text/plain"
              onChange={(event) => {
                void handleFile(event);
              }}
              className="text-xs text-ink-300 file:mr-3 file:rounded file:border-0 file:bg-ink-800 file:px-3 file:py-1.5 file:text-xs file:text-ink-100"
            />
            <label
              htmlFor="key-import"
              className="mt-1 text-xs font-semibold uppercase tracking-wide text-ink-300"
            >
              of plak je sleutel
            </label>
            <textarea
              id="key-import"
              rows={5}
              required
              value={armored}
              onChange={(event) => setArmored(event.target.value)}
              placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----"
              className="rounded border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-xs text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-500"
            />
          </div>
        ) : null}

        <Field
          label="Wachtwoord"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <ErrorNotice message={error} />

        <Button type="submit" disabled={busy}>
          {busy ? 'Bezig…' : needsKeyImport ? 'Importeren en ontgrendelen' : 'Ontgrendelen'}
        </Button>

        <p className="text-center text-xs leading-relaxed text-ink-500">
          {needsKeyImport
            ? 'Je bent nog ingelogd, maar op dit apparaat staat geen sleutel. Importeer je back-upbestand om verder te gaan.'
            : 'Je bent nog ingelogd, maar je sleutel staat alleen in het geheugen van deze pagina. Na een refresh moet je hem opnieuw ontgrendelen.'}
        </p>
      </form>
    </AuthCard>
  );
}
