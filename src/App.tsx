import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { UnreadProvider } from './hooks/useUnread';
import { AppShell } from './pages/AppShell';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { UnlockPage } from './pages/UnlockPage';

/**
 * Routing is a switch on auth status on purpose.
 *
 * Phase 1 has four screens and no addressable resources yet, so a router would
 * only add indirection. It arrives in phase 3, with servers and channels.
 */
export default function App() {
  const { status } = useAuth();
  const [showSignUp, setShowSignUp] = useState(false);

  switch (status) {
    case 'loading':
      return (
        <div className="flex min-h-full items-center justify-center text-sm text-ink-500">
          Bezig met laden…
        </div>
      );

    case 'signed-out':
      return showSignUp ? (
        <SignUpPage onSwitchToSignIn={() => setShowSignUp(false)} />
      ) : (
        <SignInPage onSwitchToSignUp={() => setShowSignUp(true)} />
      );

    case 'locked':
      return <UnlockPage />;

    case 'unlocked':
      return (
        <UnreadProvider>
          <AppShell />
        </UnreadProvider>
      );
  }
}
