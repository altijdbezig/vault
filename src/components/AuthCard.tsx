import type { ReactNode } from 'react';

interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/*
         * The wordmark. Letter-spaced small caps rather than a logo: there is
         * no logo yet, and a name set with some air around it looks
         * deliberate where a placeholder icon looks unfinished.
         */}
        <p className="mb-6 text-center text-xs font-semibold uppercase tracking-[0.35em] text-muted">
          Vault
        </p>

        <div className="rounded-xl border border-subtle bg-raised p-6 shadow-lg">
          <h1 className="text-lg font-semibold tracking-tight text-primary">{title}</h1>
          {subtitle ? (
            <p className="mt-1.5 text-sm leading-snug text-secondary">{subtitle}</p>
          ) : null}
          <div className="mt-5">{children}</div>
          {footer ? (
            <div className="mt-5 border-t border-subtle pt-4 text-sm">{footer}</div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
