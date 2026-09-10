import { useState } from 'react';
import type { FormEvent } from 'react';
import { AuthCard } from '../components/AuthCard';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { Field } from '../components/Field';
import { useAuth } from '../hooks/useAuth';
import { describeError } from '../lib/errorMessages';

export function SignInPage({ onSwitchToSignUp }: { onSwitchToSignUp: () => void }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Inloggen"
      subtitle="Vault"
      footer={
        <button type="button" onClick={onSwitchToSignUp} className="text-accent hover:underline">
          Nog geen account? Aanmaken
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
          label="Wachtwoord"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <ErrorNotice message={error} />

        <Button type="submit" disabled={busy}>
          {busy ? 'Bezig…' : 'Inloggen'}
        </Button>

        <p className="text-center text-xs leading-relaxed text-muted">
          Wachtwoord vergeten kan niet. Je wachtwoord ontsleutelt je berichten, dus
          niemand — ook wij niet — kan het resetten.
        </p>
      </form>
    </AuthCard>
  );
}
