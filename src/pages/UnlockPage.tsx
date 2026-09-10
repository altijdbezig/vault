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
          className="text-muted hover:text-secondary hover:underline"
        >
          Uitloggen
        </button>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {needsKeyImport ? (
          /*
           * Pasting comes first, not the file picker.
           *
           * On a phone a .asc file is often not reachable at all: iOS hands
           * the Files app a type it does not preview, and a key that arrived
           * through a messaging app usually only exists as text on the
           * clipboard. Pasting works everywhere, so it is the main route and
           * the file picker is the alternative.
           */
          <div className="flex flex-col gap-2">
            <label
              htmlFor="key-import"
              className="text-xs font-semibold uppercase tracking-wide text-secondary"
            >
              Plak je sleutel
            </label>
            <textarea
              id="key-import"
              rows={6}
              required
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={armored}
              onChange={(event) => setArmored(event.target.value)}
              placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----"
              className="rounded border border-strong bg-raised px-3 py-2 font-mono text-sm text-primary outline-none placeholder:text-muted focus:border-accent"
            />
            <p className="text-xs leading-relaxed text-muted">
              Open je back-upbestand, kopieer alles inclusief de BEGIN- en
              END-regels, en plak het hierboven.
            </p>

            <label
              htmlFor="key-file"
              className="mt-2 text-xs font-semibold uppercase tracking-wide text-secondary"
            >
              of kies het bestand
            </label>
            <input
              id="key-file"
              type="file"
              accept=".asc,.txt,text/plain"
              onChange={(event) => {
                void handleFile(event);
              }}
              className="text-xs text-secondary file:mr-3 file:min-h-11 file:rounded file:border-0 file:bg-overlay file:px-3 file:text-xs file:text-primary"
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

        <p className="text-center text-xs leading-relaxed text-muted">
          {needsKeyImport
            ? 'Je bent nog ingelogd, maar op dit apparaat staat geen sleutel. Importeer je back-upbestand om verder te gaan.'
            : 'Je bent nog ingelogd, maar je sleutel staat alleen in het geheugen van deze pagina. Na een refresh moet je hem opnieuw ontgrendelen.'}
        </p>
      </form>
    </AuthCard>
  );
}
