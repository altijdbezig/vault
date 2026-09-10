/**
 * Fuzzy matching for the command palette.
 *
 * Written rather than imported. fuse.js and friends are 15 to 30 kB for
 * tokenisers, weights and typo tolerance that a list of channel names does not
 * need — the whole search space here is a few dozen short strings, and the
 * thing people actually want is subsequence matching ("alg" finds "algemeen",
 * "vhq" finds "Vault HQ") with sensible ranking.
 *
 * The scoring is what makes it feel right, so it is worth stating the rules:
 *
 * - A match at the start of the string beats one in the middle.
 * - A match at the start of a word beats one inside a word.
 * - Consecutive characters beat scattered ones.
 * - A shorter target beats a longer one when the score is otherwise equal,
 *   because "dm" should find the DM list before it finds "dominique".
 *
 * Scores are only ever comparable between candidates for the same query. The
 * absolute number means nothing on its own, and comparing the scores of two
 * different queries says nothing about ranking.
 */

export interface FuzzyMatch {
  /** Higher is better. Zero means no match. */
  score: number;
  /** Indices in the target that matched, for highlighting. */
  indices: number[];
}

const SCORE_START = 24;
const SCORE_WORD_START = 16;
const SCORE_CONSECUTIVE = 12;
const SCORE_CHARACTER = 4;
/** Subtracted per skipped character, so scattered matches rank lower. */
const PENALTY_GAP = 1;

/** True for a character that begins a word: after a space, dash, dot or slash. */
function isWordBoundary(target: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const previous = target[index - 1] ?? '';
  return /[\s\-_./#@]/.test(previous);
}

/**
 * Scores one candidate against a query.
 *
 * Greedy left-to-right: for each query character, take the first remaining
 * occurrence. Not optimal in theory — a backtracking matcher would find a
 * better alignment for a few inputs — but on strings this short the difference
 * is invisible, and greedy is predictable, which matters more for a list that
 * reorders itself while you type.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    // An empty query matches everything equally; the caller keeps its own
    // order (most recent first, usually) rather than being reshuffled.
    return { score: 1, indices: [] };
  }

  const haystack = target.toLowerCase();
  const indices: number[] = [];

  let score = 0;
  let cursor = 0;
  let previousIndex = -1;

  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found === -1) {
      return { score: 0, indices: [] };
    }

    if (found === 0) {
      score += SCORE_START;
    } else if (isWordBoundary(target, found)) {
      score += SCORE_WORD_START;
    } else if (found === previousIndex + 1) {
      score += SCORE_CONSECUTIVE;
    } else {
      score += SCORE_CHARACTER;
    }

    // A gap is only a penalty when the match landed mid-word. Skipping to the
    // start of the next word is not a scattered match, it is how initials
    // work: "vh" for "Vault HQ" should beat "vh" inside one long word, and
    // penalising that jump makes it lose.
    if (previousIndex !== -1 && !isWordBoundary(target, found)) {
      score -= Math.min(found - previousIndex - 1, 10) * PENALTY_GAP;
    }

    indices.push(found);
    previousIndex = found;
    cursor = found + 1;
  }

  // Length tiebreaker, small enough that it never outweighs a real
  // positional advantage.
  score += Math.max(0, 8 - target.length / 4);

  return { score: Math.max(score, 1), indices };
}

export interface Scored<T> {
  item: T;
  score: number;
  indices: number[];
}

/**
 * Filters and ranks a list.
 *
 * Stable for equal scores: Array.prototype.sort is stable in every engine we
 * target, so items keep their input order when the query does not distinguish
 * them. That is what makes the palette open with the most recent channel on
 * top instead of an arbitrary one.
 */
export function fuzzyFilter<T>(
  query: string,
  items: readonly T[],
  keyOf: (item: T) => string,
): Scored<T>[] {
  const scored: Scored<T>[] = [];

  for (const item of items) {
    const match = fuzzyMatch(query, keyOf(item));
    if (match.score > 0) {
      scored.push({ item, score: match.score, indices: match.indices });
    }
  }

  return scored.sort((a, b) => b.score - a.score);
}
