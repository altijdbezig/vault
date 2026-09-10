import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryState {
  crashed: boolean;
}

/**
 * What may be logged when the app crashes.
 *
 * The error message is left out on purpose. Nothing in this app puts a
 * plaintext message, a private key or a passphrase into an Error, but a
 * boundary catches everything, including throws from code we did not write,
 * and a console log is the one place where such a thing would end up readable
 * and pasted into a bug report. The error name and the call frames say where
 * it broke, which is what a stack trace is for; the message adds nothing that
 * the frames do not.
 */
function safeDetails(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Onbekende fout (geen Error-object).';
  }

  const frames = (error.stack ?? '')
    .split('\n')
    .filter((line) => line.trim().startsWith('at '))
    .slice(0, 12);

  return [error.name, ...frames].join('\n');
}

/**
 * One boundary around the whole app.
 *
 * A crash in a chat client is bad enough without a white screen: the user
 * cannot tell it apart from a network problem, and their first instinct is to
 * assume their messages are gone. They are not — everything is on the server
 * as ciphertext and in IndexedDB as an encrypted key, and a reload is enough.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { crashed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Vault is vastgelopen:\n%s\n%s', safeDetails(error), info.componentStack ?? '');
  }

  override render(): ReactNode {
    if (!this.state.crashed) {
      return this.props.children;
    }

    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-lg border border-subtle bg-raised p-5 text-center">
          <h1 className="text-sm font-semibold text-primary">Er is iets misgegaan</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Vault is vastgelopen. Je berichten zijn niet weg: die staan versleuteld
            op de server, en je sleutel staat nog op dit apparaat. Herladen is
            genoeg.
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
            className="mt-4 min-h-11 w-full rounded bg-accent px-3 py-2 text-sm font-medium text-accent-on hover:bg-accent-hover"
          >
            Opnieuw laden
          </button>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Blijft het gebeuren, dan staat er meer in de console van je browser.
          </p>
        </div>
      </div>
    );
  }
}
