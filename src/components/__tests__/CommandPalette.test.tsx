import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../CommandPalette';
import type { CommandItem } from '../CommandPalette';

function items(onSelect: () => void = () => {}): CommandItem[] {
  return [
    { id: '1', label: 'algemeen', group: 'Vault HQ', icon: '#', onSelect, unread: 3 },
    { id: '2', label: 'ontwikkeling', group: 'Vault HQ', icon: '#', onSelect },
    { id: '3', label: 'jayden', group: 'Gesprekken', icon: '@', onSelect },
    {
      id: '4',
      label: 'Instellingen',
      detail: 'Profiel, uiterlijk, sleutel',
      group: 'Acties',
      icon: '⚙',
      onSelect,
    },
  ];
}

function input(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Zoek' });
}

// Auto-cleanup is off in this project (no globals), so without this every
// render stacks up in the same document and every query finds two of
// everything.
afterEach(cleanup);

describe('CommandPalette', () => {
  it('toont alles bij een lege query, in de meegegeven volgorde', () => {
    render(<CommandPalette items={items()} onClose={() => {}} />);

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(4);
    expect(options[0]?.textContent).toContain('algemeen');
    expect(options[3]?.textContent).toContain('Instellingen');
  });

  it('zet de focus in het zoekveld', () => {
    render(<CommandPalette items={items()} onClose={() => {}} />);

    expect(document.activeElement).toBe(input());
  });

  it('filtert op een subsequentie', () => {
    render(<CommandPalette items={items()} onClose={() => {}} />);

    fireEvent.change(input(), { target: { value: 'ontw' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('ontwikkeling');
  });

  it('vindt een instelling op een woord uit de toelichting', () => {
    // De detailregel telt mee in de match, anders is "sleutel" niet te vinden
    // zonder te weten dat het onder Instellingen zit.
    render(<CommandPalette items={items()} onClose={() => {}} />);

    fireEvent.change(input(), { target: { value: 'sleutel' } });

    expect(screen.getAllByRole('option')[0]?.textContent).toContain('Instellingen');
  });

  it('zegt het als er niets gevonden is', () => {
    render(<CommandPalette items={items()} onClose={() => {}} />);

    fireEvent.change(input(), { target: { value: 'zzzzzz' } });

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/Niets gevonden/)).toBeTruthy();
  });

  it('opent de eerste treffer met Enter', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        items={[{ id: '1', label: 'algemeen', group: 'Kanalen', onSelect }]}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledTimes(1);
    // Eerst sluiten, dan navigeren: de actie unmount dit meestal.
    expect(onClose).toHaveBeenCalled();
  });

  it('verplaatst de selectie met de pijltjestoetsen', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <CommandPalette
        items={[
          { id: '1', label: 'eerste', group: 'G', onSelect: first },
          { id: '2', label: 'tweede', group: 'G', onSelect: second },
        ]}
        onClose={() => {}}
      />,
    );

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('loopt rond aan het einde van de lijst', () => {
    const first = vi.fn();
    render(
      <CommandPalette
        items={[
          { id: '1', label: 'eerste', group: 'G', onSelect: first },
          { id: '2', label: 'tweede', group: 'G', onSelect: () => {} },
        ]}
        onClose={() => {}}
      />,
    );

    // Omhoog vanaf de eerste komt onderaan uit, en nog een keer weer bovenaan.
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(first).toHaveBeenCalledTimes(1);
  });

  it('zet de selectie terug naar boven bij een nieuwe query', () => {
    const target = vi.fn();
    render(
      <CommandPalette
        items={[
          { id: '1', label: 'appel', group: 'G', onSelect: target },
          { id: '2', label: 'banaan', group: 'G', onSelect: () => {} },
        ]}
        onClose={() => {}}
      />,
    );

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.change(input(), { target: { value: 'app' } });
    fireEvent.keyDown(input(), { key: 'Enter' });

    // Zonder de reset zou de selectie op index 1 staan, die na het filteren
    // niet meer bestaat, en zou Enter niets doen.
    expect(target).toHaveBeenCalledTimes(1);
  });

  it('sluit met Escape', () => {
    const onClose = vi.fn();
    render(<CommandPalette items={items()} onClose={onClose} />);

    fireEvent.keyDown(input(), { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('toont de ongelezen-teller bij een kanaal', () => {
    render(<CommandPalette items={items()} onClose={() => {}} />);

    expect(screen.getByLabelText('3 ongelezen')).toBeTruthy();
  });

  it('markeert wat er matchte, zodat de rangschikking navolgbaar is', () => {
    const { container } = render(<CommandPalette items={items()} onClose={() => {}} />);

    fireEvent.change(input(), { target: { value: 'alg' } });

    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThan(0);
    expect([...marks].map((mark) => mark.textContent).join('')).toBe('alg');
  });

  it('geeft de actieve rij door aan een schermlezer', () => {
    render(<CommandPalette items={items()} onClose={() => {}} />);

    // aria-activedescendant is wat een schermlezer volgt terwijl de focus in
    // het invoerveld blijft staan.
    expect(input().getAttribute('aria-activedescendant')).toBe('command-item-0');

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().getAttribute('aria-activedescendant')).toBe('command-item-1');
  });
});
