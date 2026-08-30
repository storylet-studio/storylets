// ---------------------------------------------------------------------------
// Find: go-to-anything across the project by name and gameId (the design
// language's "search anything" promise). Pure functions over the project
// DTO, shared by the detached Find window (Patterpad's search tool window,
// 2026-07-30 - the old Cmd+K modal is retired); the matcher is extracted so
// it is testable.
// ---------------------------------------------------------------------------

import type { ProjectDto, SearchSelection } from "../../shared/api.js";

export type { SearchSelection } from "../../shared/api.js";

export interface SearchHit {
  kind: "deck" | "card" | "template" | "hand" | "tagGroup";
  label: string;
  sublabel: string;
  selection: SearchSelection;
  /** Every expression this item carries, as one blob: the haystack for a
   *  property-usage query ("@world.raining" -> who reads or writes it).
   *  Names are what you usually search; refs are what you chase. */
  uses?: string;
}

/** Every navigable target in the project, flattened. */
export function searchIndex(project: ProjectDto): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const box of project.boxes) {
    for (const deck of box.decks) {
      hits.push({
        kind: "deck", label: deck.title ?? deck.gameId, sublabel: `deck · ${box.gameId}`,
        selection: { kind: "deck", box: box.id, deck: deck.id },
        ...(deck.gate !== undefined ? { uses: deck.gate } : {}),
      });
      for (const card of deck.cards) {
        const uses = [
          card.condition ?? "",
          typeof card.priority === "string" ? card.priority : "",
          ...card.outcomes.flatMap((o) => [o.gate ?? "", ...o.changes]),
        ].filter((x) => x !== "").join(" ");
        hits.push({
          kind: "card", label: card.title ?? card.gameId,
          sublabel: `card · ${deck.title ?? deck.gameId}${card.purpose ? ` · ${card.purpose}` : ""}`,
          selection: { kind: "card", box: box.id, deck: deck.id, card: card.id },
          ...(uses !== "" ? { uses } : {}),
        });
      }
    }
    for (const template of box.templates) {
      hits.push({
        kind: "template", label: template.gameId, sublabel: `hand template · ${box.gameId}`,
        selection: { kind: "template", box: box.id, template: template.id },
      });
    }
    for (const hand of box.hands) {
      hits.push({
        kind: "hand", label: hand.title ?? hand.gameId, sublabel: `hand · ${hand.template ?? "standalone"}`,
        selection: { kind: "hand", box: box.id, hand: hand.id },
      });
    }
    for (const group of box.tagGroups) {
      hits.push({
        kind: "tagGroup", label: group.gameId,
        sublabel: `tag group · ${group.values.join(", ")}`,
        selection: { kind: "tagGroup", box: box.id, group: group.id },
      });
    }
  }
  return hits;
}

/** Subsequence match against label + sublabel; ranks label hits, then prefix.
 *
 *  A query beginning with `@` is a PROPERTY-USAGE search instead: it matches
 *  literally, against the expressions each item carries as well as its name.
 *  "@world.raining" then answers "where else is this read or written?" - the
 *  question the Coverage window's gate flags provoke. Fuzzy matching would be
 *  wrong here: a ref is an exact address, not a name you half-remember. */
export function searchMatch(index: SearchHit[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return index.slice(0, 30);
  const byRef = q.startsWith("@");
  const scored: { hit: SearchHit; score: number }[] = [];
  for (const hit of index) {
    const label = hit.label.toLowerCase();
    if (byRef) {
      const uses = (hit.uses ?? "").toLowerCase();
      if (!uses.includes(q)) continue;
      scored.push({ hit, score: hit.kind === "card" ? 1 : 0 });
      continue;
    }
    const hay = `${label} ${hit.sublabel.toLowerCase()}`;
    if (!subsequence(hay, q)) continue;
    let score = 0;
    if (label.includes(q)) score += 10;
    if (label.startsWith(q)) score += 10;
    if (hit.kind === "card") score += 1;   // cards are the common target
    scored.push({ hit, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 30).map((s) => s.hit);
}

function subsequence(hay: string, needle: string): boolean {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}
