export function ErrorNotice({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <p role="alert" className="rounded border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
      {message}
    </p>
  );
}
