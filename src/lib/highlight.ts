/**
 * Syntax highlighting for code blocks in messages.
 *
 * Two things worth knowing about the shape of this module.
 *
 * First, it is lazy. highlight.js with every language is about a megabyte, and
 * a curated set is still large enough that it has no business in the entry
 * chunk — the sign-in screen must not download a syntax highlighter. Same
 * pattern as lib/crypto/openpgp.ts: one cached dynamic import, triggered by
 * the first code block that actually appears.
 *
 * Second, and more important: highlight.js returns an HTML string, and this
 * module never lets that string near the DOM. It parses it with DOMParser and
 * converts it to a flat list of {text, className} tokens, which MessageText
 * renders as React elements. So the guarantee from lib/markdown.ts holds all
 * the way through: a message cannot become markup, not even by way of the
 * highlighter. An injected HTML string plus a sanitiser would be the usual
 * approach and it would mean trusting two libraries instead of zero.
 */

export interface HighlightToken {
  text: string;
  /** The hljs-* class chain for this run, or null for unstyled text. */
  className: string | null;
}

export interface HighlightResult {
  tokens: HighlightToken[];
  /** What the highlighter decided the language is, for the block's label. */
  language: string | null;
}

/**
 * The languages we register.
 *
 * A closed list, because auto-detection is only as good as the set it chooses
 * from and because every extra language is bytes in the lazy chunk. These are
 * the ones that turn up in a conversation about this project; add to the list
 * when something is missing rather than importing everything.
 */
const LANGUAGE_LOADERS = {
  typescript: () => import('highlight.js/lib/languages/typescript'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  bash: () => import('highlight.js/lib/languages/bash'),
  python: () => import('highlight.js/lib/languages/python'),
  sql: () => import('highlight.js/lib/languages/sql'),
  css: () => import('highlight.js/lib/languages/css'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  diff: () => import('highlight.js/lib/languages/diff'),
  rust: () => import('highlight.js/lib/languages/rust'),
  go: () => import('highlight.js/lib/languages/go'),
  java: () => import('highlight.js/lib/languages/java'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
} as const;

type LanguageName = keyof typeof LANGUAGE_LOADERS;

/**
 * What people type in a fence versus what highlight.js calls it.
 *
 * Kept small on purpose: this is for the aliases that actually get typed, not
 * an exhaustive mapping.
 */
const ALIASES: Record<string, LanguageName> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  py: 'python',
  postgres: 'sql',
  postgresql: 'sql',
  psql: 'sql',
  html: 'xml',
  svg: 'xml',
  yml: 'yaml',
  rs: 'rust',
  golang: 'go',
  md: 'markdown',
  patch: 'diff',
};

type Hljs = typeof import('highlight.js/lib/core')['default'];

let enginePromise: Promise<Hljs> | null = null;

async function loadEngine(): Promise<Hljs> {
  enginePromise ??= (async () => {
    const core = await import('highlight.js/lib/core');
    const hljs = core.default;

    // Registered in parallel; the imports are separate chunks but Vite will
    // usually roll them into one because they are always requested together.
    await Promise.all(
      Object.entries(LANGUAGE_LOADERS).map(async ([name, load]) => {
        const module = await load();
        hljs.registerLanguage(name, module.default);
      }),
    );

    return hljs;
  })();

  return enginePromise;
}

/** Maps a fence label onto a registered language, or null. */
export function resolveLanguage(label: string | null): LanguageName | null {
  if (!label) {
    return null;
  }
  const lower = label.toLowerCase();
  if (lower in LANGUAGE_LOADERS) {
    return lower as LanguageName;
  }
  return ALIASES[lower] ?? null;
}

/**
 * Turns the highlighter's HTML into tokens.
 *
 * highlight.js only ever emits text nodes and nested spans carrying hljs-*
 * classes, so a depth-first walk that concatenates the class chain covers it
 * completely. Anything that is not a span or a text node is walked into but
 * contributes no class of its own — that cannot happen with real hljs output,
 * and if it ever did, the content would come through as plain text rather than
 * as an element.
 */
export function tokenizeHighlightedHtml(html: string): HighlightToken[] {
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = parsed.body.firstElementChild;
  if (!root) {
    return [];
  }

  const tokens: HighlightToken[] = [];

  const walk = (node: Node, inherited: string | null): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        if (text !== '') {
          tokens.push({ text, className: inherited });
        }
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const element = child as Element;
      // Only hljs-* classes are carried through. A class that is not one of
      // ours is dropped rather than passed to React, so nothing from the
      // highlighter can reach a style we did not write.
      const own = [...element.classList].filter((name) => name.startsWith('hljs-'));
      const combined = [inherited, own.join(' ')].filter(Boolean).join(' ') || null;
      walk(element, combined);
    }
  };

  walk(root, null);
  return tokens;
}

/**
 * Highlights a block of code.
 *
 * A named language is used as given; without one, highlight.js guesses from
 * the registered set. The guess is returned as well, so the block can show
 * what it decided rather than leaving the reader wondering.
 *
 * Never throws. A highlighter that fails on some pathological input must not
 * take the message with it, so the fallback is one unstyled token — which is
 * exactly what the block renders before this resolves anyway.
 */
export async function highlightCode(
  code: string,
  label: string | null,
): Promise<HighlightResult> {
  const fallback: HighlightResult = {
    tokens: [{ text: code, className: null }],
    language: resolveLanguage(label),
  };

  try {
    const hljs = await loadEngine();
    const language = resolveLanguage(label);

    if (language) {
      const result = hljs.highlight(code, { language, ignoreIllegals: true });
      return { tokens: tokenizeHighlightedHtml(result.value), language };
    }

    const result = hljs.highlightAuto(code);
    return {
      tokens: tokenizeHighlightedHtml(result.value),
      // A low-confidence guess is worse than no label: it makes the block
      // claim to be Perl because of two sigils. relevance is hljs's own
      // score and 5 is roughly where a guess stops being a coin flip.
      language: result.relevance >= 5 ? (result.language ?? null) : null,
    };
  } catch {
    return fallback;
  }
}
