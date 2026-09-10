import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { CodeBlock } from './CodeBlock';
import { parseMarkdown } from '../lib/markdown';
import type { BlockNode, InlineNode } from '../lib/markdown';

interface MessageTextProps {
  /** The decrypted message text. */
  text: string;
  /** Usernames in this channel, so a mention can be told from an at-sign. */
  usernames: readonly string[];
  /** Your own username, so a mention of you can be marked. */
  ownUsername?: string | null;
}

/**
 * Renders a decrypted message.
 *
 * There is no dangerouslySetInnerHTML in this file and there is no sanitiser
 * either, because there is nothing to sanitise: lib/markdown.ts hands over a
 * typed tree and everything below turns that into React elements. Text becomes
 * a text node, which React escapes; a link becomes an <a> whose href already
 * passed a scheme allowlist. The only way a message could become markup is if
 * someone added an innerHTML here, and that is a much easier thing to catch in
 * review than a sanitiser configured slightly wrong.
 */
export function MessageText({ text, usernames, ownUsername }: MessageTextProps) {
  // Parsing is cheap but not free, and a conversation re-renders on every
  // arriving message, every reaction and every presence change.
  const blocks = useMemo(() => parseMarkdown(text, { usernames }), [text, usernames]);
  const ownLower = ownUsername?.toLowerCase() ?? null;

  return (
    <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-primary">
      {blocks.map((block, index) => (
        <Block key={index} node={block} ownLower={ownLower} />
      ))}
    </div>
  );
}

function Block({ node, ownLower }: { node: BlockNode; ownLower: string | null }): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return (
        // break-words so a 200-character URL cannot widen the column, and
        // whitespace-pre-wrap so the line breaks somebody typed survive.
        <p className="break-words whitespace-pre-wrap">
          <Inline nodes={node.children} ownLower={ownLower} />
        </p>
      );

    case 'codeblock':
      return <CodeBlock code={node.code} language={node.language} />;

    case 'blockquote':
      return (
        <blockquote className="border-l-2 border-strong pl-2.5 text-secondary">
          <div className="flex flex-col gap-1.5">
            {node.children.map((child, index) => (
              <Block key={index} node={child} ownLower={ownLower} />
            ))}
          </div>
        </blockquote>
      );

    case 'list': {
      const items = node.items.map((item, index) => (
        <li key={index} className="break-words">
          <Inline nodes={item} ownLower={ownLower} />
        </li>
      ));

      return node.ordered ? (
        <ol className="ml-4 list-decimal space-y-0.5">{items}</ol>
      ) : (
        <ul className="ml-4 list-disc space-y-0.5">{items}</ul>
      );
    }
  }
}

function Inline({
  nodes,
  ownLower,
}: {
  nodes: InlineNode[];
  ownLower: string | null;
}): ReactNode {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case 'text':
            return node.value;

          case 'strong':
            return (
              <strong key={index} className="font-semibold">
                <Inline nodes={node.children} ownLower={ownLower} />
              </strong>
            );

          case 'em':
            return (
              <em key={index} className="italic">
                <Inline nodes={node.children} ownLower={ownLower} />
              </em>
            );

          case 'del':
            return (
              <del key={index} className="text-muted line-through">
                <Inline nodes={node.children} ownLower={ownLower} />
              </del>
            );

          case 'code':
            return (
              <code
                key={index}
                className="rounded border border-subtle bg-inset px-1 py-0.5 font-mono text-xs"
              >
                {node.value}
              </code>
            );

          case 'link':
            return (
              <a
                key={index}
                href={node.href}
                // noreferrer as well as noopener: without it the target site
                // learns which page the link was opened from, and in this app
                // that is a conversation.
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-accent underline decoration-accent/40 underline-offset-2 transition-colors hover:decoration-accent"
              >
                {node.label}
              </a>
            );

          case 'mention': {
            // An @ nobody in the channel answers to stays plain text, so a
            // mail address or an "@daar" does not light up.
            if (!node.known) {
              return `@${node.username}`;
            }

            const isSelf = ownLower !== null && node.username.toLowerCase() === ownLower;

            return (
              <span
                key={index}
                className={`rounded px-1 py-px font-medium ${
                  isSelf
                    ? 'bg-danger-soft text-danger'
                    : 'bg-accent-soft text-accent'
                }`}
              >
                @{node.username}
              </span>
            );
          }
        }
      })}
    </>
  );
}
