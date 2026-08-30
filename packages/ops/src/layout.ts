// ---------------------------------------------------------------------------
// Layout as a VERB (design/graphical-views.md section 3): select some cards, ask
// for a layout, and they arrange themselves by dependency order. Cards you did
// not select do not move.
//
// Pure graph work, no canvas: it takes ids, edges and a card's size, and returns
// where each card goes. That keeps it testable with hand-written expectations,
// which is the contract-first rule applied to the layer it belongs in (the
// conformance corpus is the cross-RUNTIME contract; this is authoring-side, like
// coverage, merge and influence).
//
// The one rule that shapes the algorithm: **cycles are normal in storylets and
// must not be hidden.** Cards that ENABLE each other in a loop are a legitimate
// thing to write, so such a cycle is never silently broken to force a tree. Its
// members are collapsed into one column, kept together, and REPORTED.
//
// But only the enable edges carry that rule. The classes rank by how strong a
// claim the analyser is making about play order - enable ("A makes B offerable")
// over disable ("playing A stops B") over influence ("A touches what B reads") -
// and a real deck is DENSE with the weaker two pointing backwards: nearly every
// finale disables its own opening. Reading those as cycles welded whole decks
// into one strongly connected component, i.e. one vertical column with every
// arrow hidden under it (reported from the Village, 2026-08-26, where five of
// thirteen decks collapsed). So the enable edges form the skeleton, and each
// weaker edge orders the layout only where it does not contradict something
// stronger; the contradicted ones still DRAW, they just do not layer.
//
// And cards the graph says nothing at all about are not a flow: they wrap into
// rows below it (or a plain grid when nothing links anything), because a column
// of twelve unrelated cards is a list pretending to be a diagram.
// ---------------------------------------------------------------------------

export interface LayoutEdge {
  from: string;
  to: string;
  /** `reference` edges do not order anything: they mean "both read this", which
   *  is a kinship, not a dependency. Layering by them would invent a direction
   *  the analyser never claimed. */
  cls?: string;
}

export interface LayoutOptions {
  /** A card's size, so the caller owns what a card looks like. */
  width: number;
  height: number;
  gapX?: number;
  gapY?: number;
  /** Top-left of the arrangement. Defaults to the origin. */
  origin?: { x: number; y: number };
}

export interface LayoutResult {
  positions: { id: string; x: number; y: number }[];
  /** Each group of cards that depend on each other in a loop, ids sorted. Empty
   *  when the selection is acyclic. The caller SAYS so rather than hiding it. */
  cycles: string[][];
}

/** Tarjan's strongly connected components. Iterative, because a deck can be
 *  deeper than a comfortable recursion and a stack overflow while tidying a
 *  canvas would be an absurd way to lose work. */
function stronglyConnected(ids: string[], out: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const root of ids) {
    if (index.has(root)) continue;
    // Each frame: the node, and how far through its successors we are.
    const work: { node: string; at: number }[] = [{ node: root, at: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const successors = out.get(frame.node) ?? [];
      if (frame.at < successors.length) {
        const next = successors[frame.at]!;
        frame.at++;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter++;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, at: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const popped = stack.pop()!;
          onStack.delete(popped);
          component.push(popped);
          if (popped === frame.node) break;
        }
        components.push(component);
      }
    }
  }
  return components;
}

/**
 * Arrange cards left to right by dependency: everything that depends on nothing
 * in the selection starts at the left, and each card sits one column right of
 * the last thing it depends on. Unconstrained siblings share a column.
 *
 * `ids` is the selection, in the order the deck holds them, which is the
 * tie-break for anything the graph does not decide. The result is therefore
 * stable: the same selection and the same links lay out the same way every time.
 */
export function layoutByDependency(ids: string[], edges: LayoutEdge[], opts: LayoutOptions): LayoutResult {
  const scope = new Set(ids);
  const rank = new Map(ids.map((id, i) => [id, i]));
  const gapX = opts.gapX ?? 50;
  const gapY = opts.gapY ?? 40;
  const origin = opts.origin ?? { x: 0, y: 0 };

  // How strong a claim each class makes about play order. `reference` stays
  // out entirely (a kinship, not a direction); anything unknown is weakest.
  const tierOf = (cls: string | undefined): number =>
    cls === "enable" || cls === undefined ? 0 : cls === "disable" ? 1 : 2;

  const outEnable = new Map<string, string[]>();
  for (const id of ids) outEnable.set(id, []);
  const weaker: { from: string; to: string; tier: number }[] = [];
  for (const edge of edges) {
    // Only within the selection, never a self-loop, never a `reference`.
    if (edge.from === edge.to) continue;
    if (!scope.has(edge.from) || !scope.has(edge.to)) continue;
    if (edge.cls === "reference") continue;
    if (edge.cls === "enable" || edge.cls === undefined) {
      const list = outEnable.get(edge.from)!;
      if (!list.includes(edge.to)) list.push(edge.to);
    } else {
      weaker.push({ from: edge.from, to: edge.to, tier: tierOf(edge.cls) });
    }
  }

  // Condense ENABLE cycles into single units. A loop of cards that enable each
  // other has no internal order to respect, so its members share a column and
  // stay together. Only enables weld: a disable pointing backwards is a story
  // ending, not a loop.
  const components = stronglyConnected(ids, outEnable);
  const unitOf = new Map<string, number>();
  components.forEach((members, i) => { for (const id of members) unitOf.set(id, i); });

  const unitEdges = new Map<number, Set<number>>();
  const incoming = new Map<number, number>();
  components.forEach((_, i) => { unitEdges.set(i, new Set()); incoming.set(i, 0); });
  const addUnitEdge = (a: number, b: number): void => {
    if (unitEdges.get(a)!.has(b)) return;
    unitEdges.get(a)!.add(b);
    incoming.set(b, incoming.get(b)! + 1);
  };
  for (const [from, tos] of outEnable) {
    for (const to of tos) {
      const a = unitOf.get(from)!;
      const b = unitOf.get(to)!;
      if (a === b) continue;                     // inside a cycle: no ordering
      addUnitEdge(a, b);
    }
  }

  /** Is `to` already reachable from `from` over the unit edges kept so far? */
  const reaches = (from: number, to: number): boolean => {
    const seen = new Set([from]);
    const work = [from];
    while (work.length > 0) {
      const at = work.pop()!;
      if (at === to) return true;
      for (const next of unitEdges.get(at)!) if (!seen.has(next)) { seen.add(next); work.push(next); }
    }
    return false;
  };

  // The weaker edges order what they can: strongest tier first, ties broken by
  // the deck's own order (so a mutual influence pair resolves the way every
  // other tie does), and any edge that would close a loop against something
  // already kept is simply not used for layering. It still draws as an arrow.
  weaker.sort((a, b) => a.tier - b.tier
    || rank.get(a.from)! - rank.get(b.from)!
    || rank.get(a.to)! - rank.get(b.to)!);
  const keptWeaker: { from: string; to: string }[] = [];
  for (const edge of weaker) {
    const a = unitOf.get(edge.from)!;
    const b = unitOf.get(edge.to)!;
    if (a === b) continue;
    if (!unitEdges.get(a)!.has(b)) {
      if (reaches(b, a)) continue;               // would contradict a kept edge
      addUnitEdge(a, b);
    }
    keptWeaker.push({ from: edge.from, to: edge.to });
  }

  // Longest path layering over the condensation, which is a DAG by construction.
  const layer = new Map<number, number>();
  const ready: number[] = [];
  components.forEach((_, i) => { layer.set(i, 0); if (incoming.get(i) === 0) ready.push(i); });
  const pending = new Map(incoming);
  while (ready.length > 0) {
    const unit = ready.shift()!;
    for (const next of unitEdges.get(unit)!) {
      layer.set(next, Math.max(layer.get(next)!, layer.get(unit)! + 1));
      pending.set(next, pending.get(next)! - 1);
      if (pending.get(next) === 0) ready.push(next);
    }
  }

  // A card the kept graph says nothing about is not part of the flow: no edge
  // in, none out, and no loop membership. Those wrap into rows instead of
  // padding out column zero.
  const isolated = ids.filter((id) => {
    const unit = unitOf.get(id)!;
    return components[unit]!.length === 1 && unitEdges.get(unit)!.size === 0 && incoming.get(unit) === 0;
  });
  const isolatedSet = new Set(isolated);

  // Flow nodes by column, then ordered within it: pulled towards the rows of
  // what they depend on (so lines run flat where they can), and tie-broken by
  // the deck's own order so the result never wobbles between runs.
  const columns = new Map<number, string[]>();
  for (const id of ids) {
    if (isolatedSet.has(id)) continue;
    const column = layer.get(unitOf.get(id)!)!;
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column)!.push(id);
  }

  const predecessors = new Map<string, string[]>();
  for (const id of ids) predecessors.set(id, []);
  for (const [from, tos] of outEnable) for (const to of tos) predecessors.get(to)!.push(from);
  for (const e of keptWeaker) predecessors.get(e.to)!.push(e.from);

  const row = new Map<string, number>();
  const positions: { id: string; x: number; y: number }[] = [];
  for (const column of [...columns.keys()].sort((a, b) => a - b)) {
    const members = columns.get(column)!;
    const pull = (id: string): number => {
      const rows = predecessors.get(id)!.map((p) => row.get(p)).filter((r): r is number => r !== undefined);
      return rows.length === 0 ? Number.POSITIVE_INFINITY : rows.reduce((a, b) => a + b, 0) / rows.length;
    };
    members.sort((a, b) => {
      const pa = pull(a);
      const pb = pull(b);
      if (pa !== pb) return pa - pb;
      return rank.get(a)! - rank.get(b)!;
    });
    members.forEach((id, i) => {
      row.set(id, i);
      positions.push({
        id,
        x: origin.x + column * (opts.width + gapX),
        y: origin.y + i * (opts.height + gapY),
      });
    });
  }

  // The unlinked rest, in rows below the flow (a plain grid when there is no
  // flow at all): as wide as the flow or as square as the count, whichever is
  // wider, filled in deck order.
  if (isolated.length > 0) {
    const flowRows = [...columns.values()].reduce((m, c) => Math.max(m, c.length), 0);
    const gridW = Math.max(columns.size, Math.ceil(Math.sqrt(isolated.length)));
    isolated.forEach((id, i) => {
      positions.push({
        id,
        x: origin.x + (i % gridW) * (opts.width + gapX),
        y: origin.y + (flowRows + Math.floor(i / gridW)) * (opts.height + gapY),
      });
    });
  }

  const cycles = components
    .filter((members) => members.length > 1)
    .map((members) => [...members].sort())
    .sort((a, b) => (a[0]! < b[0]! ? -1 : 1));

  return { positions, cycles };
}
