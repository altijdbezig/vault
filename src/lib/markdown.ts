/**
 * A small Markdown parser that produces a typed tree, not HTML.
 *
 * Why not marked or markdown-it plus DOMPurify: a message is text written by
 * somebody else, so the only question that matters is what happens when it
 * contains an attack. A parser that emits an HTML string forces us to sanitise
 * that string and to keep trusting the sanitiser forever. This one never
 * produces HTML at all — it produces nodes, and MessageText turns those into
 * React elements, where text is escaped by construction. There is no code path
 * where a message can become markup.
 *
 * The grammar is exactly what the spec asked for and nothing else: bold,
 * italic, strikethrough, inline code, fenced code blocks, blockquotes, lists
 * and links. Deliberately missing:
 *
 * - Headings. Not asked for, and a chat message that can set 32px type is a
 *   chat message someone will shout with.
 * - Underscores for emphasis. _snake_case_ identifiers are common in the
 *   conversations this app is for, and turning half a variable name into
 *   italics is worse than not supporting a second syntax for italics.
 * - Raw HTML. There is no case where a message should carry markup.
 * - Reference links, tables, footnotes. Nobody types those in a chat box.
 */

export interface MentionNode {
  type: 'mention';
  /** The username as written, without the @. */
  username: string;
  /** False when nobody in this channel has that name. */
  known: boolean;
}

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'del'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; label: string }
  | MentionNode;

export type BlockNode =
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'codeblock'; language: string | null; code: string }
  | { type: 'blockquote'; children: BlockNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] };

export interface ParseOptions {
  /**
   * Usernames that exist in this channel, for deciding whether an @mention is
   * a mention or just an at-sign somebody typed.
   *
   * Lower-cased by the parser, so callers do not have to.
   */
  usernames?: readonly string[];
}

/**
 * URL schemes a link may use.
 *
 * This list is the whole XSS defence for links. React will happily render
 * href="javascript:..." with nothing but a console warning, so an allowlist is
 * not belt and braces here — it is the belt. Anything not on it stays plain
 * text, so the reader still sees what was written but cannot click it.
 */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];

export function isSafeHref(href: string): boolean {
  // A relative URL has no scheme and cannot execute anything, but it also has
  // no business in a message: nothing in a conversation should link into the
  // app itself. Requiring an absolute URL keeps the check to one question.
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  return SAFE_SCHEMES.includes(parsed.protocol);
}

/** Bare URLs, for autolinking. Stops before trailing punctuation. */
const AUTOLINK = /^https?:\/\/[^\s<>"']+/i;

/** [label](target) with no nesting in either half. */
const LINK = /^\[([^\]\n]*)\]\(([^)\s]+)\)/;

/** @username. Letters, digits, dot, dash, underscore, like the app allows. */
const MENTION = /^@([a-z0-9][a-z0-9._-]{0,31})/i;

/**
 * Trailing characters that are almost never part of a URL.
 *
 * "kijk op https://example.com." should not link the full stop, and
 * "(zie https://example.com)" should not swallow the bracket. Balanced
 * brackets inside a URL are left alone, so a Wikipedia link still works.
 */
function trimUrlTail(url: string): string {
  let end = url.length;

  while (end > 0) {
    const char = url[end - 1];
    if (char === undefined) {
      break;
    }
    if ('.,;:!?'.includes(char)) {
      end -= 1;
      continue;
    }
    if (char === ')') {
      // Only drop it when it is unbalanced, so parentheses in a real URL stay.
      const slice = url.slice(0, end);
      const opens = (slice.match(/\(/g) ?? []).length;
      const closes = (slice.match(/\)/g) ?? []).length;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    break;
  }

  return url.slice(0, end);
}

interface InlineContext {
  usernames: Set<string>;
}

/**
 * Finds the closing run of a delimiter.
 *
 * Returns -1 when there is none, which is what makes an unmatched ** render as
 * two asterisks instead of eating the rest of the message.
 */
function findClosing(text: string, from: number, delimiter: string): number {
  let index = from;
  while (index <= text.length - delimiter.length) {
    if (text.startsWith(delimiter, index)) {
      return index;
    }
    index += 1;
  }
  return -1;
}

function parseInlineInto(text: string, context: InlineContext): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = '';
  let index = 0;

  const flush = (): void => {
    if (buffer !== '') {
      nodes.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };

  while (index < text.length) {
    const rest = text.slice(index);

    // Inline code first: everything inside it is literal, including the
    // characters that would otherwise start emphasis.
    if (rest.startsWith('`')) {
      const close = findClosing(text, index + 1, '`');
      if (close !== -1) {
        flush();
        nodes.push({ type: 'code', value: text.slice(index + 1, close) });
        index = close + 1;
        continue;
      }
    }

    if (rest.startsWith('**')) {
      const close = findClosing(text, index + 2, '**');
      if (close !== -1 && close > index + 2) {
        flush();
        nodes.push({
          type: 'strong',
          children: parseInlineInto(text.slice(index + 2, close), context),
        });
        index = close + 2;
        continue;
      }
    }

    if (rest.startsWith('~~')) {
      const close = findClosing(text, index + 2, '~~');
      if (close !== -1 && close > index + 2) {
        flush();
        nodes.push({
          type: 'del',
          children: parseInlineInto(text.slice(index + 2, close), context),
        });
        index = close + 2;
        continue;
      }
    }

    // Single asterisk, after the double has had its turn.
    if (rest.startsWith('*')) {
      const close = findClosing(text, index + 1, '*');
      if (close !== -1 && close > index + 1) {
        flush();
        nodes.push({
          type: 'em',
          children: parseInlineInto(text.slice(index + 1, close), context),
        });
        index = close + 1;
        continue;
      }
    }

    const linkMatch = LINK.exec(rest);
    if (linkMatch) {
      const [whole, rawLabel = '', target = ''] = linkMatch;
      if (isSafeHref(target)) {
        flush();
        nodes.push({
          type: 'link',
          href: target,
          // An empty [](url) would render as an invisible link, so fall back
          // to showing the target.
          label: rawLabel.trim() === '' ? target : rawLabel,
        });
        index += whole.length;
        continue;
      }
      // Unsafe scheme: fall through and treat the whole thing as text.
    }

    const autoMatch = AUTOLINK.exec(rest);
    if (autoMatch?.[0]) {
      const url = trimUrlTail(autoMatch[0]);
      if (url !== '' && isSafeHref(url)) {
        flush();
        nodes.push({ type: 'link', href: url, label: url });
        index += url.length;
        continue;
      }
    }

    const mentionMatch = MENTION.exec(rest);
    if (mentionMatch?.[1]) {
      const username = mentionMatch[1];
      flush();
      nodes.push({
        type: 'mention',
        username,
        known: context.usernames.has(username.toLowerCase()),
      });
      index += mentionMatch[0].length;
      continue;
    }

    buffer += text[index] ?? '';
    index += 1;
  }

  flush();
  return nodes;
}

export function parseInline(text: string, options: ParseOptions = {}): InlineNode[] {
  return parseInlineInto(text, {
    usernames: new Set((options.usernames ?? []).map((name) => name.toLowerCase())),
  });
}

const FENCE = /^```([a-z0-9+#-]*)\s*$/i;
const QUOTE = /^>\s?(.*)$/;
const BULLET = /^\s*[-*+]\s+(.+)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.+)$/;

/**
 * Parses a message into blocks.
 *
 * Line-based rather than a full CommonMark state machine, because chat
 * messages are short and the failure mode of a line-based parser (something
 * renders as plain text) is the right failure mode here.
 */
export function parseMarkdown(source: string, options: ParseOptions = {}): BlockNode[] {
  const context: InlineContext = {
    usernames: new Set((options.usernames ?? []).map((name) => name.toLowerCase())),
  };

  // Normalise line endings so a message pasted from Windows does not end up
  // with a stray carriage return inside every code block.
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: BlockNode[] = [];

  let index = 0;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) {
      return;
    }
    // Join with newlines, not spaces: a line break someone typed in a chat
    // message is a line break they meant.
    blocks.push({
      type: 'paragraph',
      children: parseInlineInto(paragraph.join('\n'), context),
    });
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const fence = FENCE.exec(line);

    if (fence) {
      flushParagraph();
      const language = fence[1] ? fence[1].toLowerCase() : null;
      const code: string[] = [];
      index += 1;

      // An unterminated fence runs to the end of the message rather than
      // falling back to plain text: someone who opened a code block and hit
      // send meant everything after it as code.
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;

      blocks.push({ type: 'codeblock', language, code: code.join('\n') });
      continue;
    }

    if (QUOTE.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (index < lines.length) {
        const match = QUOTE.exec(lines[index] ?? '');
        if (!match) {
          break;
        }
        quoted.push(match[1] ?? '');
        index += 1;
      }
      // Recursive, so a quote can contain a code block or a list. A quoted
      // code snippet is one of the few things people actually do in a chat.
      blocks.push({
        type: 'blockquote',
        children: parseMarkdown(quoted.join('\n'), options),
      });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet ?? numbered) {
      flushParagraph();
      const ordered = numbered !== null && bullet === null;
      const items: InlineNode[][] = [];

      while (index < lines.length) {
        const current = lines[index] ?? '';
        const match = ordered ? NUMBERED.exec(current) : BULLET.exec(current);
        if (!match?.[1]) {
          break;
        }
        items.push(parseInlineInto(match[1], context));
        index += 1;
      }

      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      index += 1;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return blocks;
}

/**
 * The usernames mentioned in a message, lower-cased and deduplicated.
 *
 * Runs on the decrypted text, in the client. It has to: the server sees only
 * ciphertext, so there is nowhere else this could happen. Used to decide
 * whether an unread badge should turn red.
 */
export function findMentions(source: string, usernames: readonly string[]): string[] {
  const known = new Set(usernames.map((name) => name.toLowerCase()));
  const found = new Set<string>();

  for (const block of parseMarkdown(source, { usernames })) {
    collectMentions(block, known, found);
  }

  return [...found];
}

function collectMentions(
  block: BlockNode,
  known: Set<string>,
  found: Set<string>,
): void {
  switch (block.type) {
    case 'paragraph':
      collectInlineMentions(block.children, known, found);
      return;
    case 'list':
      for (const item of block.items) {
        collectInlineMentions(item, known, found);
      }
      return;
    case 'blockquote':
      for (const child of block.children) {
        collectMentions(child, known, found);
      }
      return;
    case 'codeblock':
      // A mention inside a code block is a string in someone's example, not a
      // ping. Discord gets this wrong; there is no reason to copy it.
      return;
  }
}

function collectInlineMentions(
  nodes: InlineNode[],
  known: Set<string>,
  found: Set<string>,
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'mention': {
        const lower = node.username.toLowerCase();
        if (known.has(lower)) {
          found.add(lower);
        }
        break;
      }
      case 'strong':
      case 'em':
      case 'del':
        collectInlineMentions(node.children, known, found);
        break;
      default:
        break;
    }
  }
}
