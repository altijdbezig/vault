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
      <div className="w-full max-w-sm rounded-lg border border-ink-800 bg-ink-900 p-6 shadow-xl">
        <h1 className="text-lg font-semibold text-ink-100">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-500">{subtitle}</p> : null}
        <div className="mt-5">{children}</div>
        {footer ? <div className="mt-5 border-t border-ink-800 pt-4 text-sm">{footer}</div> : null}
      </div>
    </main>
  );
}
