/**
 * Shows a key fingerprint in groups of four characters.
 *
 * Users compare this out of band to verify they are talking to the right
 * person, so it has to be readable and selectable, not truncated.
 */
export function Fingerprint({ value }: { value: string }) {
  const groups = value.toLowerCase().match(/.{1,4}/g) ?? [];

  return (
    <p className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-sm text-ink-300 select-all">
      {groups.map((group, index) => (
        <span key={`${group}-${index}`}>{group}</span>
      ))}
    </p>
  );
}
