/** A green dot next to someone who has a Vault tab open right now. */
export function OnlineDot({ label }: { label: string }) {
  return (
    <span
      aria-label={label}
      title={label}
      className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500"
    />
  );
}
