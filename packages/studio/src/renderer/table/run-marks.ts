// ---------------------------------------------------------------------------
// Where this run has been: the Board's running-position marker
// (design/graphical-views.md section 2, slice 6a).
//
// Patterpad's play window leaves a live step marker in the script and never
// moves the author's selection: the current line wears an accent dot, every line
// the run has passed through keeps a muted one, and both clear on reset. It
// MARKS, it does not navigate. This is that mechanism wearing our nouns.
//
// The Board's model changes what it can honestly point at, and both differences
// are the reason this is a small module rather than two booleans in the view:
//
//   - the Board deals the WHOLE board at once, so there is no "hand being dealt
//     from" to light up. The live position is where the last PLAY came from.
//   - a played card LEAVES its hand, so marking the card just played would mark
//     something no longer on screen. The trail is what earns its keep: a card
//     played this run wears a muted mark WHEN IT COMES BACK, which answers the
//     question a storylet author actually asks - have I seen this one already?
//
// State only: what is marked, never how it is drawn.
// ---------------------------------------------------------------------------

export interface RunMarks {
  /** A card was played from a hand: the new running position. */
  played: (handGameId: string, cardId: string) => void;
  /** The hand the last play came from, or undefined before the first play. */
  now: () => string | undefined;
  /** Has this run played from this hand before? (The live one counts.) */
  visitedHand: (handGameId: string) => boolean;
  /** Has this card been played this run? */
  visitedCard: (cardId: string) => boolean;
  /** Has anything happened yet? For a view deciding whether to say so. */
  any: () => boolean;
  /** Back to nothing: a restart, or a snapshot restore. */
  reset: () => void;
}

export function runMarks(): RunMarks {
  let current: string | undefined;
  const hands = new Set<string>();
  const cards = new Set<string>();

  return {
    played(handGameId, cardId) {
      current = handGameId;
      hands.add(handGameId);
      cards.add(cardId);
    },
    now: () => current,
    visitedHand: (handGameId) => hands.has(handGameId),
    visitedCard: (cardId) => cards.has(cardId),
    any: () => current !== undefined,
    reset() {
      current = undefined;
      hands.clear();
      cards.clear();
    },
  };
}
