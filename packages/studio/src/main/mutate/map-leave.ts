// ---------------------------------------------------------------------------
// The guard on a box leaving the project map: what in the box still names the
// map, said as the end of a sentence with the thing to open to change it. A
// pure reading of the box; `useProjectMap` (map.ts) refuses with it.
// ---------------------------------------------------------------------------

import { worldDeclarations } from "@storylet-studio/compiler";
import type { SourceBox, SourceProject } from "@storylet-studio/compiler";
import { effectiveGameId, isHoleRef, isSpatial } from "@storylet-studio/model";
import type { TagGroup } from "@storylet-studio/model";
import type { LeaveRefusalDto } from "../../shared/api.js";

/** What still ties a box to the map: the end of a sentence ("its hand "The
 *  Inn" is in the zone "village""), and the thing to open to change it. */
export interface MapTie { said: string; open?: LeaveRefusalDto["open"] }

/** What in a box still names the project map, by binding or by expression, or
 *  undefined when nothing does and it may leave. */
export function whyStillOnMap(source: SourceProject, box: SourceBox, group: TagGroup): MapTie | undefined {
  return mapReferences(box, group) ?? mapExpressionReference(source, box, group);
}

/** A name as a refusal quotes it: the title, else the address. */
const quotedName = (x: { title?: string; gameId?: string; id: string }): string => `"${x.title ?? effectiveGameId(x)}"`;

/** What in a box still names the project map by BINDING or by FILING (see
 *  `MapTie`), or undefined when nothing does. */
function mapReferences(box: SourceBox, group: TagGroup): MapTie | undefined {
  const boxId = box.box.box.id;
  const zone = (id: string): string => {
    const tag = group.tags.find((t) => t.id === id);
    return `"${tag ? effectiveGameId(tag) : id}"`;
  };
  for (const hand of box.hands.hands) {
    const tag = hand.chosen?.[group.id] ?? hand.rule?.bindings?.[group.id];
    if (tag !== undefined) {
      const at = isHoleRef(tag) ? "takes its zone from a property" : `is in the zone ${zone(tag)}`;
      return { said: `its hand ${quotedName(hand)} ${at}`, open: { kind: "hand", box: boxId, id: hand.id, label: hand.title ?? effectiveGameId(hand) } };
    }
  }
  for (const template of box.hands.templates) {
    const fixed = template.bindings?.[group.id];
    if (fixed !== undefined || (template.chooses ?? []).includes(group.id)) {
      return {
        said: `its hand template ${quotedName(template)} ${fixed !== undefined ? `binds the zone ${zone(fixed)}` : "chooses a zone"}`,
        open: { kind: "template", box: boxId, id: template.id, label: template.title ?? effectiveGameId(template) },
      };
    }
  }
  const filed = box.decks.flatMap((d) => d.shard.cards.map((card) => ({ card, deck: d.shard.deck.id })))
    .filter(({ card }) => (card.tags?.[group.id] ?? []).length > 0);
  if (filed.length > 0) {
    const first = filed[0]!;
    return {
      said: filed.length === 1
        ? `its card ${quotedName(first.card)} is filed to a zone`
        : `${filed.length} of its cards are filed to zones, ${quotedName(first.card)} first`,
      open: { kind: "card", box: boxId, deck: first.deck, id: first.card.id, label: first.card.title ?? effectiveGameId(first.card) },
    };
  }
  return undefined;
}

/**
 * An EXPRESSION in a box that reads the project map (see `MapTie`: "its card
 * \"Cold run\" reads @hand.patrolled in its When"), or undefined.
 *
 * In a box on the map the @hand bag carries the zone group and its properties
 * (design/project-map-contract.md 4.1), and the play log is kept by zone; off
 * the map those names resolve to nothing, and the box would stop compiling
 * somewhere the guard promised it would not (the antagonist review, round 3,
 * 1.3). So every condition, priority and change of the box is read for:
 *   - `@hand.<zone property>` or `@hand.<zone group>`, and the bare `@name`
 *     form of either when nothing else in scope declares that name;
 *   - `count_played_in("<zone group>", ...)` and `turns_since_played_in(...)`;
 *   - a zone's value address, `value.<zone>.`.
 *
 * Read as text, which is a second reading of what the compiler checks (the
 * review of 2026-10 noted the duplication). It stays a reading rather than a
 * compile of the box as it would be off the map because the refusal has to
 * name WHERE, in the author's words, and before anything is changed.
 */
function mapExpressionReference(source: SourceProject, box: SourceBox, group: TagGroup): MapTie | undefined {
  const boxId = box.box.box.id;
  const groupName = effectiveGameId(group);
  const zoneProps = new Set([...(group.properties ?? []), ...group.tags.flatMap((t) => t.properties ?? [])].map((p) => p.name));
  const handNames = new Set([...zoneProps, groupName]);
  // Declared elsewhere, so a bare `@name` resolves to that instead.
  const elsewhere = new Set([
    ...(source.project.story?.properties ?? []), ...worldDeclarations(source), ...(box.box.box.properties ?? []),
    ...box.decks.flatMap((d) => d.shard.deck.properties ?? []),
    ...box.hands.templates.flatMap((t) => t.properties ?? []), ...box.hands.hands.flatMap((h) => h.properties ?? []),
  ].map((p) => p.name));
  // What the box's OWN @hand bag declares: its own groups (by name, and their
  // and their tags' properties), its templates' and hands' properties. Off the
  // map `@hand.<name>` still resolves to these, so only a map-sourced name
  // counts (the antagonist's sign-off, 3.2: Saltmarsh's `area/docks` declares
  // `danger` itself).
  const ownGroups = box.tags.groups.filter((g) => g.id !== group.id && !isSpatial(g));
  const ownHand = new Set([
    ...ownGroups.map((g) => effectiveGameId(g)),
    ...[...ownGroups.flatMap((g) => [...(g.properties ?? []), ...g.tags.flatMap((t) => t.properties ?? [])]),
      ...box.hands.templates.flatMap((t) => t.properties ?? []), ...box.hands.hands.flatMap((h) => h.properties ?? [])].map((p) => p.name),
  ]);
  const esc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const zones = group.tags.map((t) => effectiveGameId(t));
  const tests: { re: RegExp; said: (m: RegExpExecArray) => string }[] = [
    { re: /@hand\.([A-Za-z_][A-Za-z0-9_-]*)/g, said: (m) => (handNames.has(m[1]!) && !ownHand.has(m[1]!) ? `@hand.${m[1]}` : "") },
    { re: /@([A-Za-z_][A-Za-z0-9_-]*)(?![.\w])/g, said: (m) => (handNames.has(m[1]!) && !elsewhere.has(m[1]!) && !ownHand.has(m[1]!) ? `@${m[1]}` : "") },
    { re: new RegExp(`\\b(count_played_in|turns_since_played_in)\\(\\s*["']${esc(groupName)}["']`, "g"), said: (m) => `${m[1]}("${groupName}")` },
    ...(zones.length > 0
      ? [{ re: new RegExp(`\\bvalue\\.(${zones.map(esc).join("|")})\\.`, "g"), said: (m: RegExpExecArray) => `value.${m[1]}.` }]
      : []),
  ];
  const find = (text: string | number | undefined): string | undefined => {
    if (typeof text !== "string") return undefined;
    for (const t of tests) {
      t.re.lastIndex = 0;
      for (let m = t.re.exec(text); m !== null; m = t.re.exec(text)) { const said = t.said(m); if (said !== "") return said; }
    }
    return undefined;
  };
  const named = quotedName;
  const label = (x: { title?: string; gameId?: string; id: string }): string => x.title ?? effectiveGameId(x);
  for (const { shard } of box.decks) {
    const deck = shard.deck;
    const gate = find(deck.condition);
    if (gate !== undefined) return { said: `its deck ${named(deck)} reads ${gate} in its gate`, open: { kind: "deck", box: boxId, id: deck.id, label: label(deck) } };
    for (const card of shard.cards) {
      const when = find(card.condition) ?? find(card.priority as string | number | undefined);
      const open = { kind: "card" as const, box: boxId, deck: deck.id, id: card.id, label: label(card) };
      if (when !== undefined) return { said: `its card ${named(card)} reads ${when} in its ${find(card.condition) !== undefined ? "When" : "priority"}`, open };
      for (const o of card.outcomes) {
        const oWhen = find(o.condition);
        if (oWhen !== undefined) return { said: `its card ${named(card)} reads ${oWhen} in the When of its outcome ${named(o)}`, open };
        for (const [target, value] of Object.entries(o.changes)) {
          const hit = find(target) ?? find(value);
          if (hit !== undefined) return { said: `its card ${named(card)} reads ${hit} in a change of its outcome ${named(o)}`, open };
        }
      }
    }
  }
  for (const t of box.hands.templates) {
    const hit = find(t.condition);
    if (hit !== undefined) return { said: `its hand template ${named(t)} reads ${hit} in its When`, open: { kind: "template", box: boxId, id: t.id, label: label(t) } };
  }
  for (const h of box.hands.hands) {
    const hit = find(h.rule?.condition);
    if (hit !== undefined) return { said: `its hand ${named(h)} reads ${hit} in its When`, open: { kind: "hand", box: boxId, id: h.id, label: label(h) } };
  }
  return undefined;
}
