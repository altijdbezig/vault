import { describe, expect, it } from 'vitest';
import { findMentions, isSafeHref, parseInline, parseMarkdown } from '../markdown';
import type { BlockNode, InlineNode } from '../markdown';

/** Flattens a tree back to the text a reader would see. */
function textOf(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value;
        case 'code':
          return node.value;
        case 'link':
          return node.label;
        case 'mention':
          return `@${node.username}`;
        default:
          return textOf(node.children);
      }
    })
    .join('');
}

function firstParagraph(blocks: BlockNode[]): InlineNode[] {
  const block = blocks[0];
  if (block?.type !== 'paragraph') {
    throw new Error(`Verwachtte een paragraph, kreeg ${block?.type ?? 'niets'}`);
  }
  return block.children;
}

describe('parseInline', () => {
  it('leest vet, cursief, doorhalen en inline code', () => {
    const nodes = parseInline('**vet** *cursief* ~~weg~~ `code`');
    const types = nodes.filter((node) => node.type !== 'text').map((node) => node.type);

    expect(types).toEqual(['strong', 'em', 'del', 'code']);
  });

  it('laat een ongepaarde delimiter staan als tekst', () => {
    // Anders eet een enkele ** de rest van het bericht op.
    const nodes = parseInline('dit is **niet afgesloten');

    expect(nodes).toEqual([{ type: 'text', value: 'dit is **niet afgesloten' }]);
  });

  it('behandelt de inhoud van inline code als letterlijk', () => {
    const nodes = parseInline('`**geen vet**`');

    expect(nodes).toEqual([{ type: 'code', value: '**geen vet**' }]);
  });

  it('laat snake_case met rust', () => {
    // Underscores zijn geen cursief-syntax in Vault, juist hierom.
    const nodes = parseInline('gebruik user_id en channel_id');

    expect(nodes).toEqual([{ type: 'text', value: 'gebruik user_id en channel_id' }]);
  });

  it('linkt een kale url en laat de punt erna staan', () => {
    const nodes = parseInline('kijk op https://example.com/pad.');

    expect(nodes).toEqual([
      { type: 'text', value: 'kijk op ' },
      { type: 'link', href: 'https://example.com/pad', label: 'https://example.com/pad' },
      { type: 'text', value: '.' },
    ]);
  });

  it('houdt gebalanceerde haakjes binnen een url', () => {
    const nodes = parseInline('https://nl.wikipedia.org/wiki/Vault_(film)');
    const link = nodes[0];

    expect(link).toEqual({
      type: 'link',
      href: 'https://nl.wikipedia.org/wiki/Vault_(film)',
      label: 'https://nl.wikipedia.org/wiki/Vault_(film)',
    });
  });

  it('herkent een mention alleen als iemand die naam heeft', () => {
    const nodes = parseInline('@benjamin en @niemand', { usernames: ['benjamin'] });

    expect(nodes).toEqual([
      { type: 'mention', username: 'benjamin', known: true },
      { type: 'text', value: ' en ' },
      { type: 'mention', username: 'niemand', known: false },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('maakt een codeblok met taal', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1;\n```');

    expect(blocks).toEqual([{ type: 'codeblock', language: 'ts', code: 'const a = 1;' }]);
  });

  it('laat een niet-afgesloten codeblok tot het eind lopen', () => {
    const blocks = parseMarkdown('```\nregel een\nregel twee');

    expect(blocks).toEqual([
      { type: 'codeblock', language: null, code: 'regel een\nregel twee' },
    ]);
  });

  it('leest een citaat en parseert de inhoud ervan', () => {
    const blocks = parseMarkdown('> **belangrijk**\n> tweede regel');
    const quote = blocks[0];

    expect(quote?.type).toBe('blockquote');
    if (quote?.type !== 'blockquote') {
      return;
    }
    expect(textOf(firstParagraph(quote.children))).toBe('belangrijk\ntweede regel');
  });

  it('leest een citaat met een codeblok erin', () => {
    const blocks = parseMarkdown('> zoiets:\n> ```sql\n> select 1;\n> ```');
    const quote = blocks[0];

    expect(quote?.type).toBe('blockquote');
    if (quote?.type !== 'blockquote') {
      return;
    }
    expect(quote.children.some((child) => child.type === 'codeblock')).toBe(true);
  });

  it('leest ongeordende en geordende lijsten', () => {
    const unordered = parseMarkdown('- een\n- twee');
    const ordered = parseMarkdown('1. een\n2. twee');

    expect(unordered[0]).toMatchObject({ type: 'list', ordered: false });
    expect(ordered[0]).toMatchObject({ type: 'list', ordered: true });
  });

  it('houdt de regelafbrekingen die iemand typte', () => {
    const blocks = parseMarkdown('eerste\ntweede');

    expect(textOf(firstParagraph(blocks))).toBe('eerste\ntweede');
  });

  it('normaliseert CRLF, zodat een gepast Windows-blok geen \\r bevat', () => {
    const blocks = parseMarkdown('```\r\na\r\nb\r\n```');

    expect(blocks[0]).toEqual({ type: 'codeblock', language: null, code: 'a\nb' });
  });
});

/*
 * Dit is het blok dat ertoe doet.
 *
 * Een bericht is invoer van iemand anders. De parser mag onder geen enkele
 * payload een node opleveren die als markup of als uitvoerbare href kan
 * eindigen. Er is geen saniteerstap om achteraf op te leunen: als hier iets
 * doorglipt, glipt het door tot in het DOM.
 */
describe('markdown is niet te misbruiken', () => {
  it('houdt een script-tag gewoon tekst', () => {
    const payload = '<script>alert("xss")</script>';
    const nodes = parseInline(payload);

    expect(nodes).toEqual([{ type: 'text', value: payload }]);
  });

  it('houdt een img met onerror gewoon tekst', () => {
    const payload = '<img src=x onerror=alert(1)>';

    expect(parseInline(payload)).toEqual([{ type: 'text', value: payload }]);
  });

  it('weigert javascript: in een markdown-link', () => {
    const nodes = parseInline('[klik](javascript:alert(1))');

    // Geen link-node: de hele constructie valt terug op tekst.
    expect(nodes.some((node) => node.type === 'link')).toBe(false);
  });

  it('weigert javascript: ook met rare capitalisatie en witruimte', () => {
    for (const href of [
      'JaVaScRiPt:alert(1)',
      'javascript\t:alert(1)',
      ' javascript:alert(1)',
      'jAvAsCrIpT:void(0)',
    ]) {
      expect(isSafeHref(href)).toBe(false);
    }
  });

  it('weigert data:, vbscript: en file:', () => {
    expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHref('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeHref('file:///etc/passwd')).toBe(false);
  });

  it('staat http, https en mailto toe', () => {
    expect(isSafeHref('http://example.com')).toBe(true);
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('mailto:iemand@example.com')).toBe(true);
  });

  it('weigert een relatieve link', () => {
    // Niets in een gesprek hoort de app in te linken.
    expect(isSafeHref('/dm/whatever')).toBe(false);
    expect(isSafeHref('//example.com')).toBe(false);
  });

  it('linkt geen javascript-url die als kale tekst voorbijkomt', () => {
    const nodes = parseInline('javascript:alert(1)');

    expect(nodes.every((node) => node.type !== 'link')).toBe(true);
  });

  it('maakt van een payload in een codeblok geen node met markup', () => {
    const blocks = parseMarkdown('```html\n<script>alert(1)</script>\n```');

    expect(blocks[0]).toEqual({
      type: 'codeblock',
      language: 'html',
      code: '<script>alert(1)</script>',
    });
  });
});

describe('findMentions', () => {
  it('geeft de genoemde bekende gebruikersnamen terug', () => {
    const found = findMentions('hoi @benjamin en @jayden', ['benjamin', 'jayden', 'iemand']);

    expect(found.sort()).toEqual(['benjamin', 'jayden']);
  });

  it('negeert een naam die niemand heeft', () => {
    expect(findMentions('@spookje', ['benjamin'])).toEqual([]);
  });

  it('is niet gevoelig voor hoofdletters', () => {
    expect(findMentions('@Benjamin', ['benjamin'])).toEqual(['benjamin']);
  });

  it('telt een mention in een codeblok niet mee', () => {
    // Een @naam in een voorbeeld is geen ping. Discord doet dit fout.
    const found = findMentions('```\n@benjamin\n```', ['benjamin']);

    expect(found).toEqual([]);
  });

  it('vindt een mention binnen vette tekst', () => {
    expect(findMentions('**@benjamin**', ['benjamin'])).toEqual(['benjamin']);
  });

  it('vindt een mention in een citaat', () => {
    expect(findMentions('> @benjamin kijk hier', ['benjamin'])).toEqual(['benjamin']);
  });

  it('noemt dezelfde naam één keer', () => {
    expect(findMentions('@a en @a en @a', ['a'])).toEqual(['a']);
  });
});
