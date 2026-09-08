import { useState } from 'react';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { Fingerprint } from '../components/Fingerprint';
import { useAuth } from '../hooks/useAuth';
import { describeError } from '../lib/errorMessages';

export function AppShell() {
  const { profile, signOut, exportEncryptedKey } = useAuth();
  const [error, setError] = useState<string | null>(null);

  async function handleExport(): Promise<void> {
    setError(null);
    try {
      const armored = await exportEncryptedKey();
      const blob = new Blob([armored], { type: 'application/pgp-keys' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vault-key-${profile?.username ?? 'account'}.asc`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-ink-800 bg-ink-900 px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-ink-100">Vault</span>
          <span className="text-sm text-ink-500">{profile?.username}</span>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            void signOut();
          }}
        >
          Uitloggen
        </Button>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <section className="rounded-lg border border-ink-800 bg-ink-900 p-5">
          <h2 className="text-sm font-semibold text-ink-100">Je sleutel</h2>
          <p className="mt-1 text-xs text-ink-500">
            Deel deze vingerafdruk buiten Vault om — via een gesprek of een ander
            kanaal — zodat anderen kunnen controleren dat ze echt met jou praten.
          </p>
          <div className="mt-3">
            {profile ? <Fingerprint value={profile.fingerprint} /> : null}
          </div>
        </section>

        <section className="mt-4 rounded-lg border border-ink-800 bg-ink-900 p-5">
          <h2 className="text-sm font-semibold text-ink-100">Back-up</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            Je privésleutel staat alleen in deze browser. Wis je browsergegevens
            zonder back-up, dan zijn je berichten weg. Het bestand is versleuteld met
            je wachtwoord, maar bewaar het toch op een veilige plek.
          </p>
          <div className="mt-3">
            <Button
              variant="ghost"
              onClick={() => {
                void handleExport();
              }}
            >
              Sleutel exporteren
            </Button>
          </div>
          <div className="mt-3">
            <ErrorNotice message={error} />
          </div>
        </section>

        <p className="mt-6 text-center text-xs text-ink-500">
          Kanalen en berichten komen in fase 2.
        </p>
      </main>
    </div>
  );
}
