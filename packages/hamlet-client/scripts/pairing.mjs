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

/**
 * @world is the surface the two engines share, and each project DECLARES it
 * separately: ours under `world.properties`, Patter's under
 * `scopeRegistry.scopes[token = "world"].declarations`. Two declarations of one
 * thing drift, and a drift here is invisible at runtime in this host (both
 * engines are handed the same resolver, so they agree by construction) and
 * visible everywhere else: Storyletter's Board and Patterpad's Play window each
 * self-back @world from THEIR declaration, and would disagree. So: every
 * property either side declares must be declared by both, same type, same
 * values, same default.
 */
export function checkWorld(storyletBundle, patterBundle) {
  const problems = [];
  const ours = new Map((storyletBundle.world?.properties ?? []).map((p) => [p.name, p]));
  const scope = (patterBundle.scopeRegistry?.scopes ?? []).find((s) => s.token === "world");
  const theirs = new Map((scope?.declarations ?? []).map((p) => [p.name, p]));
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const [name, p] of ours) {
    const q = theirs.get(name);
    if (!q) { problems.push(`@world.${name} is declared by the storylet project and not by the Patter project`); continue; }
    if (p.type !== q.type) problems.push(`@world.${name} is ${p.type} in the storylet project and ${q.type} in the Patter project`);
    if (!same(p.values, q.values)) problems.push(`@world.${name} has values ${JSON.stringify(p.values)} here and ${JSON.stringify(q.values)} in the Patter project`);
    if (!same(p.default, q.default)) problems.push(`@world.${name} defaults to ${JSON.stringify(p.default)} here and ${JSON.stringify(q.default)} in the Patter project`);
  }
  for (const name of theirs.keys()) {
    if (!ours.has(name)) problems.push(`@world.${name} is declared by the Patter project and not by the storylet project`);
  }
  // Read-only is each story's PROMISE about a value ("I read this, I never
  // write it"), `writable: false` on its declaration, name for name in both
  // formats. The two promises must match, and a card or scene that breaks
  // its own project's promise is that project's compiler's business; what
  // only this can see is a card writing a value the PATTER project holds
  // read-only, or vice versa, because each compiler sees one project.
  const scopeWritable = scope?.writable !== false;
  const writableOurs = (p) => p.writable !== false;
  const writableTheirs = (q) => q.writable ?? scopeWritable;
  for (const [name, p] of ours) {
    const q = theirs.get(name);
    if (q && writableOurs(p) !== writableTheirs(q)) {
      problems.push(`@world.${name} is ${writableOurs(p) ? "writable" : "read-only"} in the storylet project and ${writableTheirs(q) ? "writable" : "read-only"} in the Patter project`);
    }
  }
  for (const box of storyletBundle.boxes ?? []) {
    for (const deck of box.decks ?? []) {
      for (const card of deck.cards ?? []) {
        for (const outcome of card.outcomes ?? []) {
          for (const target of Object.keys(outcome.changes ?? {})) {
            const m = /^@world\.([a-z][a-z0-9_-]*)$/.exec(target);
            if (!m) continue;
            const q = theirs.get(m[1]);
            if (q && !writableTheirs(q)) {
              problems.push(`outcome "${outcome.gameId}" of card "${card.gameId}" writes @world.${m[1]}, which the Patter project declares read-only (writable: false)`);
            }
          }
        }
      }
    }
  }
  return problems;
}

/**
 * A card in a Patter-backed box must PIN its gameId. `effectiveGameId` derives
 * an unpinned one from the title, so editing the title silently renames the
 * card, and with it the scene the convention says it plays. `checkPairing`
 * catches the break after it happens; this catches the card that can break.
 * Reads the SOURCE project, because the compiled bundle has already resolved
 * every gameId and cannot tell a pinned one from a derived one.
 */
export function checkPinnedGameIds(source, boxes) {
  const problems = [];
  for (const box of source.boxes ?? []) {
    const boxId = box.box.box.gameId;
    if (boxes && !boxes.includes(boxId)) continue;
    for (const deck of box.decks ?? []) {
      for (const card of deck.shard.cards ?? []) {
        if (!card.gameId || !card.gameId.trim()) {
          problems.push(`card "${card.title ?? card.id}" (${card.id}) has no pinned gameId: its scene name is derived from its title and would change with it`);
        }
      }
    }
  }
  return problems;
}
