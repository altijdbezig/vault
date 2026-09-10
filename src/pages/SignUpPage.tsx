import { useState } from 'react';
import type { FormEvent } from 'react';
import { AuthCard } from '../components/AuthCard';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { Field } from '../components/Field';
import { useAuth } from '../hooks/useAuth';
import { describeError } from '../lib/errorMessages';

export function SignUpPage({ onSwitchToSignIn }: { onSwitchToSignIn: () => void }) {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signUp(email.trim(), password, username.trim());
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Account aanmaken"
      subtitle="Je wachtwoord is ook de sleutel tot je berichten."
      footer={
        <button type="button" onClick={onSwitchToSignIn} className="text-accent hover:underline">
          Ik heb al een account
        </button>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label="E-mail"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Field
          label="Gebruikersnaam"
          autoComplete="username"
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          hint="Zichtbaar voor anderen. Later niet meer te wijzigen in deze fase."
        />
        <Field
          label="Wachtwoord"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <p className="rounded border border-warning-border bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning">
          Dit wachtwoord versleutelt je privésleutel. Er is geen herstel: raak je
          het kwijt, dan zijn al je berichten definitief onleesbaar. Schrijf het op.
        </p>

        <ErrorNotice message={error} />

        <Button type="submit" disabled={busy}>
          {busy ? 'Sleutelpaar aanmaken…' : 'Account aanmaken'}
        </Button>

        {busy ? (
          <p className="text-center text-xs text-muted">
            Er wordt een PGP-sleutelpaar in je browser gegenereerd. Dit duurt even.
          </p>
        ) : null}
      </form>
    </AuthCard>
  );
}
