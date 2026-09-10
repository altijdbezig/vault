import { useCallback, useEffect, useRef, useState } from 'react';
import { Lightbox } from './Lightbox';
import { formatBytes, isImage } from '../lib/messagePayload';
import type { AttachmentMeta } from '../lib/messagePayload';

interface AttachmentViewProps {
  attachments: readonly AttachmentMeta[];
  senderId: string;
  /** Downloads and decrypts. Provided by useMessages; crypto is not in here. */
  onLoad: (meta: AttachmentMeta, senderId: string) => Promise<Blob>;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'failed'; message: string };

/**
 * The attachments under a message.
 *
 * Nothing is fetched until it is asked for. An image gets one click to
 * decrypt-and-show; a file gets a button that decrypts and then saves. That is
 * a deliberate difference from a normal chat app, where images just appear:
 * here every image costs a download plus a decrypt, and doing that eagerly for
 * a channel full of screenshots would mean decrypting twenty megabytes to
 * scroll past them.
 *
 * The object URLs are the thing to be careful about. Every one of them pins its
 * blob in memory until it is revoked, and a decrypted attachment is exactly
 * the sort of thing that must not stay pinned longer than it is on screen. So
 * they are tracked in a ref and revoked on unmount, and again whenever one is
 * replaced.
 */
export function AttachmentView({ attachments, senderId, onLoad }: AttachmentViewProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {attachments.map((meta) => (
        <Attachment key={meta.path} meta={meta} senderId={senderId} onLoad={onLoad} />
      ))}
    </div>
  );
}

function Attachment({
  meta,
  senderId,
  onLoad,
}: {
  meta: AttachmentMeta;
  senderId: string;
  onLoad: (meta: AttachmentMeta, senderId: string) => Promise<Blob>;
}) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const [zoomed, setZoomed] = useState(false);

  // Every URL this component ever created, so unmount can revoke all of them.
  const urlsRef = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const url of urlsRef.current) {
        URL.revokeObjectURL(url);
      }
      urlsRef.current = [];
    },
    [],
  );

  const load = useCallback(async (): Promise<string | null> => {
    setState({ status: 'loading' });

    try {
      const blob = await onLoad(meta, senderId);
      const url = URL.createObjectURL(blob);
      urlsRef.current.push(url);
      setState({ status: 'ready', url });
      return url;
    } catch (caught) {
      // Never the ciphertext or any part of the file in the log.
      console.error('Bijlage kon niet ontsleuteld worden:', meta.path, caught);
      setState({
        status: 'failed',
        message:
          'Deze bijlage kon niet geopend worden. Mogelijk is hij verstuurd voordat ' +
          'je aan dit kanaal werd toegevoegd.',
      });
      return null;
    }
  }, [meta, onLoad, senderId]);

  /**
   * Saves the file.
   *
   * A temporary anchor with a download attribute, and the object URL is kept
   * (not revoked immediately) because Safari cancels an in-flight download
   * when the URL it points at disappears. The unmount cleanup collects it.
   */
  const save = useCallback(async (): Promise<void> => {
    const url = state.status === 'ready' ? state.url : await load();
    if (!url) {
      return;
    }

    const link = document.createElement('a');
    link.href = url;
    link.download = meta.name;
    link.click();
  }, [load, meta.name, state]);

  if (isImage(meta.mimeType)) {
    return (
      <div className="max-w-sm">
        {state.status === 'ready' ? (
          <>
            <button
              type="button"
              onClick={() => setZoomed(true)}
              className="block overflow-hidden rounded-md border border-subtle transition-colors hover:border-strong"
            >
              <img
                src={state.url}
                alt={meta.name}
                // The stored dimensions, when the sender's client recorded
                // them, keep the conversation from jumping as images decrypt.
                width={meta.width}
                height={meta.height}
                className="max-h-72 w-auto max-w-full object-contain"
              />
            </button>
            {zoomed ? (
              <Lightbox
                url={state.url}
                name={meta.name}
                onClose={() => setZoomed(false)}
                onSave={() => {
                  void save();
                }}
              />
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              void load();
            }}
            disabled={state.status === 'loading'}
            className="flex w-full items-center gap-2 rounded-md border border-subtle bg-overlay px-3 py-2.5 text-left transition-colors hover:border-strong disabled:opacity-60"
          >
            <span aria-hidden="true" className="text-base">
              🖼️
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-primary">
                {meta.name}
              </span>
              <span className="block text-2xs text-muted">
                {state.status === 'loading'
                  ? 'Ontsleutelen…'
                  : `Afbeelding · ${formatBytes(meta.size)} · klik om te tonen`}
              </span>
            </span>
          </button>
        )}

        {state.status === 'failed' ? (
          <p className="mt-1 text-2xs leading-relaxed text-warning">{state.message}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="max-w-sm">
      <div className="flex items-center gap-2 rounded-md border border-subtle bg-overlay px-3 py-2.5">
        <span aria-hidden="true" className="text-base">
          📎
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-primary">{meta.name}</span>
          <span className="block text-2xs text-muted">{formatBytes(meta.size)}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            void save();
          }}
          disabled={state.status === 'loading'}
          className="shrink-0 rounded px-2 py-1 text-2xs font-medium text-accent transition-colors hover:bg-accent-soft disabled:opacity-60"
        >
          {state.status === 'loading' ? 'Ontsleutelen…' : 'Opslaan'}
        </button>
      </div>

      {state.status === 'failed' ? (
        <p className="mt-1 text-2xs leading-relaxed text-warning">{state.message}</p>
      ) : null}
    </div>
  );
}
