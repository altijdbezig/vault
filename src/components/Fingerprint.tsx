interface FingerprintProps {
  value: string;
  /** 'sm' in a member list, 'md' on a profile card or the key panel. */
  size?: 'sm' | 'md';
}

/**
 * Shows a key fingerprint in groups of four characters.
 *
 * Users compare this out of band to verify they are talking to the right
 * person, so it has to be readable and selectable, not truncated.
 *
 * The mono font is JetBrains Mono for one reason: it slashes the zero and
 * distinguishes 1, l and I. A fingerprint comparison read out over the phone
 * falls apart on exactly those characters.
 */
export function Fingerprint({ value, size = 'sm' }: FingerprintProps) {
  const groups = value.toLowerCase().match(/.{1,4}/g) ?? [];

  return (
    <p
      className={`flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-secondary select-all ${
        size === 'md' ? 'text-sm' : 'text-xs'
      }`}
    >
      {groups.map((group, index) => (
        <span key={`${group}-${index}`}>{group}</span>
      ))}
    </p>
  );
}
