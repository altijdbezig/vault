import { useEffect, useState } from 'react';
import { highlightCode, resolveLanguage } from '../lib/highlight';
import type { HighlightToken } from '../lib/highlight';

interface CodeBlockProps {
  code: string;
  /** Whatever was written after the opening fence, or null. */
  language: string | null;
}

/**
 * A fenced code block, with a copy button and a language label.
 *
 * Renders as plain text first and upgrades to highlighted once the lazy
 * highlighter has loaded. That order matters: the code is readable
 * immediately, and a slow or failed import degrades to unstyled code instead
 * of an empty block.
 */
export function CodeBlock({ code, language }: CodeBlockProps) {
  const [tokens, setTokens] = useState<HighlightToken[] | null>(null);
  const [detected, setDetected] = useState<string | null>(() => resolveLanguage(language));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await highlightCode(code, language);
      if (!cancelled) {
        setTokens(result.tokens);
        setDetected(result.language);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  // "Gekopieerd" has to go away again, and it has to go away if this unmounts
  // in the meantime, or React complains about a state update on a gone
  // component the next time someone scrolls fast.
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // A denied clipboard permission is not worth an error message: the code
      // is selectable, so there is a way out that does not need us.
    }
  }

  return (
    <div className="group/code relative my-1.5 overflow-hidden rounded-md border border-subtle bg-inset">
      <div className="flex items-center justify-between gap-2 border-b border-subtle px-2.5 py-1">
        <span className="font-mono text-2xs uppercase tracking-wider text-muted">
          {detected ?? 'code'}
        </span>
        <button
          type="button"
          onClick={() => {
            void handleCopy();
          }}
          className="rounded px-1.5 py-0.5 text-2xs font-medium text-muted transition-colors hover:bg-hover hover:text-primary"
        >
          {copied ? 'Gekopieerd' : 'Kopieer'}
        </button>
      </div>

      {/*
       * overflow-x on the pre, not on the message: a long line of code must
       * scroll inside its own box rather than widening the conversation and
       * pushing the sidebar off a phone screen.
       */}
      <pre className="overflow-x-auto px-2.5 py-2">
        <code className="font-mono text-xs leading-relaxed">
          {tokens === null
            ? code
            : tokens.map((token, index) =>
                token.className === null ? (
                  token.text
                ) : (
                  <span key={index} className={token.className}>
                    {token.text}
                  </span>
                ),
              )}
        </code>
      </pre>
    </div>
  );
}
