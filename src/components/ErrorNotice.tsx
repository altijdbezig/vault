import type { ReactNode } from 'react';

export function ErrorNotice({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <p
      role="alert"
      className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm leading-snug text-danger"
    >
      {message}
    </p>
  );
}

/**
 * The same shape in the warning colour.
 *
 * Used for the consequences of the crypto model that are not errors: a member
 * without a key, a new member who cannot read the backlog, a dropped socket.
 * Those are correct behaviour and should not be dressed up as failures, hence
 * role="status" rather than "alert" — status does not interrupt a screen
 * reader mid-sentence.
 */
export function WarningNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning"
    >
      {children}
    </p>
  );
}
