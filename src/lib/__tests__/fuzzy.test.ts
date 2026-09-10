import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch } from '../fuzzy';

describe('fuzzyMatch', () => {
  it('matcht een subsequentie', () => {
    expect(fuzzyMatch('alg', 'algemeen').score).toBeGreaterThan(0);
    expect(fuzzyMatch('agn', 'algemeen').score).toBeGreaterThan(0);
  });

  it('geeft nul als een letter ontbreekt', () => {
    expect(fuzzyMatch('xyz', 'algemeen').score).toBe(0);
  });

  it('is niet gevoelig voor hoofdletters', () => {
    expect(fuzzyMatch('VHQ', 'Vault HQ').score).toBeGreaterThan(0);
  });

  it('matcht een lege query op alles, met gelijke score', () => {
    // Zo houdt de caller zijn eigen volgorde als er niets getypt is.
    expect(fuzzyMatch('', 'wat dan ook').score).toBe(1);
    expect(fuzzyMatch('   ', 'iets anders').score).toBe(1);
  });

  it('geeft de posities terug voor de highlight', () => {
    const match = fuzzyMatch('ale', 'algemeen');

    // a-l-g-e: de e komt op index 3.
    expect(match.indices).toEqual([0, 1, 3]);
  });

  describe('rangschikking', () => {
    it('zet een match aan het begin boven een match in het midden', () => {
      const atStart = fuzzyMatch('alg', 'algemeen');
      const inMiddle = fuzzyMatch('alg', 'de algemene chat');

      expect(atStart.score).toBeGreaterThan(inMiddle.score);
    });

    it('laat initialen op woordgrenzen winnen van dezelfde letters in een woord', () => {
      // Dit is waar je een palet voor gebruikt: "vh" hoort "Vault HQ" te
      // vinden. Het gat tussen de v en de h is geen verspreide match maar
      // precies de bedoeling, dus het gat kost hier niets.
      const initials = fuzzyMatch('vh', 'vault hq');
      const insideWord = fuzzyMatch('vh', 'vhoogte');

      expect(initials.score).toBeGreaterThan(insideWord.score);
    });

    it('zet aaneengesloten tekens boven verspreide', () => {
      // Dezelfde query tegen twee kandidaten: dat is de enige vergelijking
      // die iets zegt, want een score is alleen binnen een query zinvol.
      const together = fuzzyMatch('bcd', 'abcdefgh');
      const scattered = fuzzyMatch('bcd', 'abxcxdxx');

      expect(together.score).toBeGreaterThan(scattered.score);
    });

    it('zet een kortere kandidaat boven een langere bij gelijke match', () => {
      // Anders vindt "dm" eerst "dominique de manager".
      const short = fuzzyMatch('dm', 'dm');
      const long = fuzzyMatch('dm', 'dominique de manager');

      expect(short.score).toBeGreaterThan(long.score);
    });
  });
});

describe('fuzzyFilter', () => {
  const items = [
    { id: '1', name: 'algemeen' },
    { id: '2', name: 'ontwikkeling' },
    { id: '3', name: 'alg-archief' },
    { id: '4', name: 'random' },
  ];

  it('laat alleen de matches over', () => {
    const result = fuzzyFilter('alg', items, (item) => item.name);

    expect(result.map((entry) => entry.item.id).sort()).toEqual(['1', '3']);
  });

  it('sorteert op score, hoogste eerst', () => {
    const result = fuzzyFilter('alg', items, (item) => item.name);

    for (let index = 1; index < result.length; index += 1) {
      const previous = result[index - 1];
      const current = result[index];
      expect(previous?.score ?? 0).toBeGreaterThanOrEqual(current?.score ?? 0);
    }
  });

  it('houdt de oorspronkelijke volgorde bij een lege query', () => {
    // Hierdoor opent het palet op de gesprekkenlijst en niet op een
    // willekeurige instelling.
    const result = fuzzyFilter('', items, (item) => item.name);

    expect(result.map((entry) => entry.item.id)).toEqual(['1', '2', '3', '4']);
  });

  it('geeft een lege lijst als niets matcht', () => {
    expect(fuzzyFilter('zzzz', items, (item) => item.name)).toEqual([]);
  });
});
