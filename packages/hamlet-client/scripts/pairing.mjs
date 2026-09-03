// The cross-check that makes the naming convention safe.
//
// Reboot.md 10: a card's `gameId` IS its Patter scene id, and an outcome's
// `gameId` IS the id its scene reports back in a `gameEvent`'s
// `gameData.outcome`. Nothing declares that link, so nothing validates it -
// which is the one real objection to convention over a field. This is the
// answer to the objection, and it is why it runs in the BUILD and not only in
// a test: the failure it catches is a card that performs no dialogue, or a
// scene that ends without saying what happened, and both of those look exactly
// like content somebody meant to write that way.
//
// Deliberately symmetric. A scene with no card is as wrong as a card with no
// scene: it is dialogue the game can never reach.

/** Every gameEvent outcome id anywhere in a compiled scene, in document order. */
export function outcomesReported(scene) {
  const found = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (node.kind === "gameEvent" && node.gameData && typeof node.gameData.outcome === "string") {
      found.push(node.gameData.outcome);
    }
    for (const v of Object.values(node)) walk(v);
  })(scene);
  return found;
}

/**
 * Compare a compiled storylet bundle with a compiled Patter bundle.
 * Returns a list of human-readable problems; empty means they line up.
 *
 * `boxes` limits the check to the boxes the host performs through Patter,
 * because the opt-in is the HOST'S and not the project's (Reboot.md 10): a
 * project may hold boxes that have no dialogue at all.
 */
export function checkPairing(storyletBundle, patterBundle, boxes) {
  const problems = [];
  const scenes = patterBundle.scenes ?? {};
  const wanted = new Set();

  for (const box of storyletBundle.boxes ?? []) {
    if (boxes && !boxes.includes(box.gameId)) continue;
    for (const deck of box.decks ?? []) {
      for (const card of deck.cards ?? []) {
        wanted.add(card.gameId);
        const scene = scenes[card.gameId];
        if (!scene) {
          problems.push(`card "${card.gameId}" has no scene of that name`);
          continue;
        }
        const declared = (card.outcomes ?? []).map((o) => o.gameId);
        const reported = outcomesReported(scene);
        if (reported.length === 0) {
          problems.push(`scene "${card.gameId}" reports no outcome at all`);
          continue;
        }
        for (const r of new Set(reported)) {
          if (!declared.includes(r)) {
            problems.push(`scene "${card.gameId}" reports outcome "${r}", which that card does not declare`
              + ` (it declares: ${declared.join(", ") || "none"})`);
          }
        }
        // A declared outcome no branch reaches is not an error - a scene may
        // legitimately be unable to reach one yet, mid-writing - but the host
        // could never play it, so it is worth saying.
        for (const d of declared) {
          if (!reported.includes(d)) {
            problems.push(`outcome "${d}" of card "${card.gameId}" is reported by no branch of its scene`);
          }
        }
      }
    }
  }

  for (const id of Object.keys(scenes)) {
    if (!wanted.has(id)) problems.push(`scene "${id}" belongs to no card, so nothing can ever play it`);
  }
  return problems;
}
