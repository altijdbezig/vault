import type { VerificationStatus } from '../hooks/useVerification';

interface VerifiedBadgeProps {
  status: VerificationStatus;
  name: string;
  /** 'inline' next to a name, 'block' as a row on a profile card. */
  variant?: 'inline' | 'block';
}

/**
 * The verification marker next to somebody's name.
 *
 * Nothing at all for unverified, and that is deliberate: most contacts will
 * never be verified, and a warning icon on all of them would train everybody
 * to ignore the one that matters. A check mark for verified, and for a changed
 * key something that cannot be mistaken for decoration.
 */
export function VerifiedBadge({ status, name, variant = 'inline' }: VerifiedBadgeProps) {
  if (status === 'unverified') {
    return null;
  }

  if (status === 'changed') {
    const label = `De sleutel van ${name} is veranderd sinds je hem verifieerde`;

    return variant === 'block' ? (
      <p
        role="alert"
        className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger"
      >
        <strong>De sleutel van {name} is veranderd</strong> sinds je hem verifieerde. Dat
        kan betekenen dat {name} opnieuw is begonnen op een nieuw apparaat — of dat
        iemand anders zich voordoet als {name}. Vergelijk de vingerafdruk opnieuw
        buiten Vault om voordat je hier iets vertrouwelijks stuurt.
      </p>
    ) : (
      <span
        aria-label={label}
        title={label}
        className="inline-flex shrink-0 items-center gap-0.5 rounded bg-danger-soft px-1 text-2xs font-semibold text-danger"
      >
        <span aria-hidden="true">⚠</span>
        gewijzigd
      </span>
    );
  }

  const label = `Je hebt de sleutel van ${name} geverifieerd`;

  return variant === 'block' ? (
    <p className="flex items-center gap-1.5 text-xs text-success">
      <span aria-hidden="true">✓</span>
      Je hebt deze vingerafdruk geverifieerd.
    </p>
  ) : (
    <span
      aria-label={label}
      title={label}
      className="shrink-0 text-2xs text-success"
      // The check mark is the whole content, so it is not aria-hidden here;
      // the label above is what a screen reader reads instead.
    >
      <span aria-hidden="true">✓</span>
    </span>
  );
}
