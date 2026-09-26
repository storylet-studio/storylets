// The @world check, the one pairing check that stays the Hamlet's own: the two
// projects each declare @world, and this host hands both engines one resolver,
// so the declarations must agree. The cards-against-scenes check that used to
// live here is with-patter's checkPairing now (the build and the tests import it).

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

