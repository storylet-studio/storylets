// The cross-check that makes the naming convention safe.
//
// Reboot.md 10: a card's `gameId` IS its Patter scene id, and an outcome's
// `gameId` is what its scene names, on the option the player takes or in a
// `gameEvent`, with a single-outcome card needing neither. Nothing declares
// those links, so nothing validates them - which is the one real objection to
// convention over a field. This is the answer to the objection, and it is why
// it runs in the BUILD and not only in a test: the failure it catches is a card
// that performs no dialogue, or a branch that ends without saying what
// happened, and both look exactly like content somebody meant to write.
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
 * Every CHOICE OPTION in a compiled scene: an option is a group carrying a
 * prompt. `outcome` is the label it puts on itself, and `overrides` says
 * whether its branch fires a gameEvent that would win over that label.
 */
export function optionsOf(scene) {
  const found = [];
  (function walk(node, insideOption) {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, insideOption));
    if (!node || typeof node !== "object") return;
    const isOption = node.type === "group" && node.prompt !== undefined;
    if (isOption) {
      found.push({
        id: node.id,
        outcome: typeof node.gameData?.outcome === "string" ? node.gameData.outcome : null,
        overrides: outcomesReported(node.children ?? []),
      });
    }
    // The prompt is text, never structure: walking it would find nothing and
    // could mistake a nested group for an option of this one.
    for (const [k, v] of Object.entries(node)) if (k !== "prompt") walk(v, insideOption || isOption);
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
 *
 * THE RESOLUTION RULE this enforces, which is the host's too (performance.js):
 * a gameEvent wins, else the label on the option the player took, else the
 * card's only outcome. So a scene whose card has ONE outcome need say nothing
 * at all, and a scene whose card has several must leave no path that says
 * nothing. That last is the check worth having: it is the mistake nobody sees
 * until a player takes the one branch that was never labelled.
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
        const options = optionsOf(scene);
        const events = outcomesReported(scene);
        const named = [...new Set([...events, ...options.map((o) => o.outcome).filter(Boolean)])];

        for (const n of named) {
          if (!declared.includes(n)) {
            problems.push(`scene "${card.gameId}" names outcome "${n}", which that card does not declare`
              + ` (it declares: ${declared.join(", ") || "none"})`);
          }
        }

        // Can every path say which outcome it reached? With one outcome the
        // answer is always yes, and the scene is spared the bookkeeping.
        if (declared.length > 1) {
          if (options.length === 0 && events.length === 0) {
            problems.push(`scene "${card.gameId}" says nothing about its outcome, and its card declares`
              + ` ${declared.length} (${declared.join(", ")}): label its options, or fire a gameEvent`);
          }
          for (const o of options) {
            if (!o.outcome && o.overrides.length === 0) {
              problems.push(`option "${o.id}" in scene "${card.gameId}" names no outcome and fires no gameEvent,`
                + ` so taking it leaves the host guessing between ${declared.join(", ")}`);
            }
          }
        }

        // A declared outcome nothing can reach is not an error - a scene may
        // legitimately be unable to reach one yet, mid-writing - but the host
        // could never play it, so it is worth saying.
        // Only worth saying when there was a choice to make: a card with one
        // outcome is reached by saying nothing, which is the point of the rule.
        if (declared.length > 1) {
          for (const d of declared) {
            if (!named.includes(d)) {
              problems.push(`outcome "${d}" of card "${card.gameId}" is named by no option and no gameEvent`);
            }
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

