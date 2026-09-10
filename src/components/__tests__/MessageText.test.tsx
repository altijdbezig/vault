import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageText } from '../MessageText';

/*
 * De vraag die deze suite stelt is niet "rendert markdown mooi" maar "kan een
 * bericht van iemand anders markup of een uitvoerbare href in het DOM zetten".
 * lib/markdown.test.ts controleert de parser; dit controleert wat er
 * daadwerkelijk in de pagina terechtkomt.
 */
describe('MessageText en XSS', () => {
  it('zet een script-tag als tekst in de pagina, niet als element', () => {
    const { container } = render(
      <MessageText text={'<script>alert("xss")</script>'} usernames={[]} />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>alert("xss")</script>')).toBeTruthy();
  });

  it('rendert een img-payload niet als afbeelding', () => {
    const { container } = render(
      <MessageText text={'<img src=x onerror="alert(1)">'} usernames={[]} />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('maakt van een javascript:-link geen anchor', () => {
    const { container } = render(
      <MessageText text="[klik hier](javascript:alert(1))" usernames={[]} />,
    );

    expect(container.querySelector('a')).toBeNull();
    // De reader ziet nog wel wat er stond.
    expect(container.textContent).toContain('klik hier');
  });

  it('maakt van een data:-link geen anchor', () => {
    const { container } = render(
      <MessageText
        text="[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"
        usernames={[]}
      />,
    );

    expect(container.querySelector('a')).toBeNull();
  });

  it('geeft een echte link noopener, noreferrer en een nieuw tabblad', () => {
    const { container } = render(
      <MessageText text="[docs](https://example.com/x)" usernames={[]} />,
    );

    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com/x');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    // Zonder noreferrer leert de doelserver van welke pagina de link kwam, en
    // dat is hier een gesprek.
    expect(anchor?.getAttribute('rel')).toContain('noreferrer');
    expect(anchor?.getAttribute('rel')).toContain('noopener');
  });

  it('laat html in een codeblok zichtbaar maar inert', () => {
    const { container } = render(
      <MessageText text={'```html\n<b>vet</b>\n```'} usernames={[]} />,
    );

    expect(container.querySelector('code b')).toBeNull();
    expect(container.textContent).toContain('<b>vet</b>');
  });
});

describe('MessageText rendert markdown', () => {
  it('maakt de juiste elementen voor vet, cursief, doorhalen en code', () => {
    const { container } = render(
      <MessageText text="**vet** *schuin* ~~weg~~ `code`" usernames={[]} />,
    );

    expect(container.querySelector('strong')?.textContent).toBe('vet');
    expect(container.querySelector('em')?.textContent).toBe('schuin');
    expect(container.querySelector('del')?.textContent).toBe('weg');
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('maakt een lijst en een citaat', () => {
    const { container } = render(
      <MessageText text={'- een\n- twee'} usernames={[]} />,
    );
    expect(container.querySelectorAll('ul li')).toHaveLength(2);

    const quoted = render(<MessageText text="> hallo" usernames={[]} />);
    expect(quoted.container.querySelector('blockquote')?.textContent).toContain('hallo');
  });

  it('markeert een mention van iemand die bestaat', () => {
    const { container } = render(
      <MessageText text="hoi @benjamin" usernames={['benjamin']} ownUsername="jayden" />,
    );

    expect(container.textContent).toContain('@benjamin');
    expect(container.querySelector('span.bg-accent-soft')).toBeTruthy();
  });

  it('geeft een mention van jezelf een andere kleur dan een mention van een ander', () => {
    const mine = render(
      <MessageText text="@jayden" usernames={['jayden']} ownUsername="jayden" />,
    );
    expect(mine.container.querySelector('span.bg-danger-soft')).toBeTruthy();
  });

  it('laat een @ waar niemand op reageert gewoon tekst', () => {
    const { container } = render(
      <MessageText text="mail naar @support" usernames={['benjamin']} />,
    );

    expect(container.querySelector('span.bg-accent-soft')).toBeNull();
    expect(container.textContent).toContain('@support');
  });
});
