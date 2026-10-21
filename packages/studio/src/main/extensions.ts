// ---------------------------------------------------------------------------
// Storylet extensions, as the editor is told them (patterkit design/proposals/
// patter-storylet-extensions.md, "Tier 1: fields"): each extension the project
// takes and has a sound manifest for, its declarations by node kind, and every
// node's values. An extension whose manifest is missing or broken is left out: its data
// is untouched, and validation says why.
// ---------------------------------------------------------------------------

import type { SourceProject } from "@storylet-studio/compiler";
import { effectiveGameId } from "@storylet-studio/model";
import { manifestProblems, viewsFor } from "@wildwinter/toolkit/extensions";
import type { Manifest } from "@wildwinter/toolkit/extensions";
import type { ExtensionDto, ExtensionFieldDto, ExtensionTargetDto } from "../shared/api.js";

export function extensionDtos(source: SourceProject): ExtensionDto[] | undefined {
  const taken = source.project.extensions;
  if (taken === undefined || Object.keys(taken).length === 0) return undefined;
  const out: ExtensionDto[] = [];
  for (const id of Object.keys(taken)) {
    const file = (source.manifests ?? []).find((m) => m.id === id);
    if (file === undefined || manifestProblems(file.manifest).some((p) => p.severity === "error")) continue;
    const manifest = file.manifest as Manifest;
    const targets: Record<string, ExtensionTargetDto> = {};
    for (const [kind, target] of Object.entries(manifest.targets.storylets ?? {})) {
      targets[kind] = { fields: (target.fields ?? []) as unknown as ExtensionFieldDto[] };
    }
    const values: Record<string, Record<string, unknown>> = {};
    for (const shard of [...(source.extensions ?? []), ...source.boxes.flatMap((b) => b.extensions ?? [])]) {
      if (shard.shard.extension !== id) continue;
      for (const byNode of Object.values(shard.shard.entries ?? {})) {
        for (const [node, entry] of Object.entries(byNode ?? {})) {
          if (typeof entry === "object" && entry !== null) values[node] = { ...(values[node] ?? {}), ...entry };
        }
      }
    }
    const views = viewsFor(manifest, "storylets").map((v) => ({ id: v.id, name: v.name }));
    out.push({
      id, name: manifest.name, version: manifest.version, targets, values,
      ...(views.length > 0 ? { views } : {}), ...(manifest.reads !== undefined ? { reads: [...manifest.reads] } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/** What references and map keys choose from, and what a problem names: every box, deck, card, outcome, tag,
 *  tag group, hand and hand template, by the name an author knows it by (a tag and an outcome with their
 *  group's or card's name in front, as problems name them), and the box whose extension shards hold its
 *  values, which is the version control a lock on them is read from, and the node holding it (a view walks the
 *  project by it). */
export function extensionNodeChoices(source: SourceProject): Record<string, { id: string; label: string; box?: string; parent?: string }[]> {
  const out: Record<string, { id: string; label: string; box?: string; parent?: string }[]> = {
    box: [], deck: [], card: [], outcome: [], tag: [], tagGroup: [], hand: [], handTemplate: [],
  };
  // Each with the box whose shards hold its values (the map's group is the project's own: no box).
  const groups = [
    ...source.boxes.flatMap((b) => (b.tags.groups ?? []).map((g) => ({ g, box: { box: b.box.box.id } }))),
    ...(source.map?.group ? [{ g: source.map.group, box: {} }] : []),
  ];
  for (const { g, box } of groups) {
    out["tagGroup"]!.push({ id: g.id, label: effectiveGameId(g), ...box, ...("box" in box ? { parent: box.box } : {}) });
    for (const t of g.tags ?? []) out["tag"]!.push({ id: t.id, label: `${effectiveGameId(g)}/${effectiveGameId(t)}`, ...box, parent: g.id });
  }
  for (const box of source.boxes) {
    const b = box.box.box.id;
    out["box"]!.push({ id: b, label: effectiveGameId(box.box.box), box: b });
    // Not choices a reference can make (the toolkit's references name box, deck, card, outcome and tag), but
    // names a problem about one of them is worded with.
    for (const h of box.hands.hands ?? []) out["hand"]!.push({ id: h.id, label: effectiveGameId(h), box: b, parent: b });
    for (const t of box.hands.templates ?? []) out["handTemplate"]!.push({ id: t.id, label: effectiveGameId(t), box: b, parent: b });
    for (const deck of box.decks) {
      out["deck"]!.push({ id: deck.shard.deck.id, label: effectiveGameId(deck.shard.deck), box: b, parent: b });
      for (const card of deck.shard.cards ?? []) {
        out["card"]!.push({ id: card.id, label: effectiveGameId(card), box: b, parent: deck.shard.deck.id });
        for (const o of card.outcomes ?? []) out["outcome"]!.push({ id: o.id, label: `${effectiveGameId(card)}/${effectiveGameId(o)}`, box: b, parent: card.id });
      }
    }
  }
  return out;
}
