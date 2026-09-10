import { useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './hooks/useAuth';
import { PresenceProvider } from './hooks/usePresence';
import { UnreadProvider } from './hooks/useUnread';
import { AppShell } from './pages/AppShell';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { UnlockPage } from './pages/UnlockPage';

/**
 * The providers the signed-in app runs inside.
 *
 * Exported so tests mount the same stack the app does; a test that assembles
 * its own would quietly stop matching reality the next time one is added.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PresenceProvider>
      <UnreadProvider>{children}</UnreadProvider>
    </PresenceProvider>
  );
}

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
        // No spinner. This state lasts as long as one getSession() call, and a
        // spinner that flashes for 80ms is noise; a line of text that happens
        // to still be there after a second is information.
        <div
          role="status"
          className="flex min-h-full items-center justify-center text-sm text-muted"
        >
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
        <AppProviders>
          <AppShell />
        </AppProviders>
      );
  }
}
