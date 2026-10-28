// ---------------------------------------------------------------------------
// A quality's stages, edited where they are used.
//
// Values are stored by stage NAME (design/quality.md), which is what makes a
// stage insertable: put one between two others and no value anywhere moves.
// The same choice makes a RENAME the one edit that has to reach every value
// naming the stage, or each of them quietly stops being on the ladder
// (patterkit design/proposals/patter-qualities.md section 2). So a rename
// visits all of them, in one edit:
//
//   - the declaration itself (its stages and, when it starts there, its default)
//   - card and outcome field values, for a quality FIELD
//   - tag starting values, for a quality a tag group (or a tag) declares
//   - a coverage driver's values, for a quality a driver feeds (`@world.act`)
//   - stage literals in conditions, priorities and changes, where they are
//     compared with or assigned to the quality
//
// A literal is rewritten in the author's own text where that is unambiguous,
// and the expression re-written through the parser only where it is not: a
// condition that also compares another quality with the same word keeps that
// one as it was. That rewrite, and the gate count, are the kernel's
// (`@wildwinter/expr`), shared with Patterpad, so a rename means the same in
// both editors.
//
// Reordering changes no value at all, and is the one edit that changes what
// gates MEAN without saying so. `stageGateCount` is how the editor says so.
//
// Pure over the parsed project: mutates the shards in place and reports which
// changed, for the caller to write as one undoable step.
// ---------------------------------------------------------------------------

import { parse, renameStageInExpression, stageGateCount as gatesIn } from "@wildwinter/expr";
import type { Dialect, StageTargetRef } from "@wildwinter/expr";
import type { SourceBox, SourceDeck, SourceProject } from "@storylet-studio/compiler";
import { bundleHostScopes } from "@storylet-studio/model";
import type { FieldDecl, PropertyDecl, TagGroup } from "@storylet-studio/model";

/** A property's scope: the Storylet Engine's own, or a host scope's token
 *  (`world`, `player`, ...), which is any other string. */
export type PropertyScope = "world" | "story" | "box" | "deck" | "hand" | (string & {});

/** The quality a stage edit is about. */
export type StageTarget =
  /** A property. `box` narrows @box, @deck and @hand to the box they live in,
   *  `deck` names the deck for @deck, and `holder` the tag group, tag, hand
   *  template or hand that declares an @hand property (its id). Any other
   *  scope is a host scope the project declares (`world`, `player`, ...). */
  | { kind: "property"; scope: PropertyScope; name: string; box?: string; deck?: string; holder?: string }
  /** A card field (`template: "fields"`) or an outcome field of a box. */
  | { kind: "field"; box: string; template: "fields" | "outcomeFields"; name: string };

/** What a rename touched, for the caller to write and to report. */
export interface StageRenameResult {
  /** The project shard changed (an @world or @story declaration, or a literal
   *  in no box). @world also lives in the game's scopes file when shared. */
  project: boolean;
  /** The project map's zone group changed (an @hand quality it declares). */
  map: boolean;
  boxes: Set<SourceBox>;
  tags: Set<SourceBox>;
  hands: Set<SourceBox>;
  decks: Set<SourceDeck>;
  /** Field and tag values rewritten. */
  values: number;
  /** Expressions rewritten (conditions, priorities, changes). */
  expressions: number;
}

/** The rewrite inside one expression is the kernel's, shared with Patterpad. */
export { renameStageInExpression };

/** Every place an expression lives in a box, with a setter and whether its
 *  value is assigned to a property (a change), and which deck it is in. */
export interface ExprSite { get: () => string | undefined; set: (src: string) => void; assignedTo?: string; deck?: SourceDeck }

export function boxSites(box: SourceBox): ExprSite[] {
  const sites: ExprSite[] = [];
  const at = (holder: Record<string, unknown>, key: string, deck?: SourceDeck): void => {
    sites.push({
      get: () => (typeof holder[key] === "string" ? holder[key] as string : undefined),
      set: (src) => { holder[key] = src; },
      ...(deck ? { deck } : {}),
    });
  };
  for (const deck of box.decks) {
    at(deck.shard.deck as unknown as Record<string, unknown>, "condition", deck);
    for (const card of deck.shard.cards) {
      at(card as unknown as Record<string, unknown>, "condition", deck);
      at(card as unknown as Record<string, unknown>, "priority", deck);
      for (const outcome of card.outcomes) {
        at(outcome as unknown as Record<string, unknown>, "condition", deck);
        // An outcome that changes nothing may leave `changes` out of the shard.
        const changes = (outcome.changes ?? {}) as Record<string, string>;
        for (const key of Object.keys(changes)) {
          sites.push({ get: () => changes[key], set: (src) => { changes[key] = src; }, assignedTo: key, deck });
        }
      }
    }
  }
  for (const t of box.hands.templates) at(t as unknown as Record<string, unknown>, "condition");
  for (const h of box.hands.hands) if (h.rule) at(h.rule as unknown as Record<string, unknown>, "condition");
  return sites;
}

/** The declaration a target names, where it lives, and which boxes' (and
 *  which deck's) expressions can reach it. */
export interface Located {
  decl: PropertyDecl | FieldDecl;
  /** Marks the shard holding the declaration as changed. */
  touch: (r: StageRenameResult) => void;
  /** The boxes whose expressions can name it; every box for @world / @story. */
  boxes: SourceBox[];
  deck?: SourceDeck;
  /** Tag groups whose tags' starting values belong to it. */
  groups: { group: TagGroup; touch: (r: StageRenameResult) => void }[];
}

export function locate(source: SourceProject, target: StageTarget): Located | undefined {
  const boxById = (id: string | undefined) => source.boxes.find((b) => b.box.box.id === id);
  if (target.kind === "field") {
    const box = boxById(target.box);
    const decl = (box?.box.box[target.template] ?? []).find((f) => f.name === target.name);
    if (!box || !decl) return undefined;
    return { decl, touch: (r) => r.boxes.add(box), boxes: [box], groups: [] };
  }
  const named = (list: PropertyDecl[] | undefined) => (list ?? []).find((p) => p.name === target.name);
  switch (target.scope) {
    case "story": {
      const decl = named(source.project.story?.properties);
      return decl ? { decl, touch: (r) => { r.project = true; }, boxes: source.boxes, groups: [] } : undefined;
    }
    case "box": {
      const box = boxById(target.box);
      const decl = named(box?.box.box.properties);
      return box && decl ? { decl, touch: (r) => r.boxes.add(box), boxes: [box], groups: [] } : undefined;
    }
    case "deck": {
      for (const box of source.boxes) {
        const deck = box.decks.find((d) => d.shard.deck.id === target.deck);
        const decl = named(deck?.shard.deck.properties);
        if (deck && decl) return { decl, touch: (r) => r.decks.add(deck), boxes: [box], deck, groups: [] };
      }
      return undefined;
    }
    case "hand": {
      const mapGroup = source.map?.group;
      // The project map's zone group: every box on the map composes it.
      if (mapGroup) {
        const touchMap = (r: StageRenameResult): void => { r.map = true; };
        const onMap = source.boxes.filter((b) => b.box.box.usesMap === true);
        if (mapGroup.id === target.holder) {
          const decl = named(mapGroup.properties);
          if (decl) return { decl, touch: touchMap, boxes: onMap, groups: [{ group: mapGroup, touch: touchMap }] };
        }
        const tag = mapGroup.tags.find((t) => t.id === target.holder);
        const decl = named(tag?.properties);
        if (tag && decl) return { decl, touch: touchMap, boxes: onMap, groups: [] };
      }
      for (const box of source.boxes) {
        const touchTags = (r: StageRenameResult): void => { r.tags.add(box); };
        const touchHands = (r: StageRenameResult): void => { r.hands.add(box); };
        for (const group of box.tags.groups) {
          if (group.id === target.holder) {
            const decl = named(group.properties);
            if (decl) return { decl, touch: touchTags, boxes: [box], groups: [{ group, touch: touchTags }] };
          }
          const tag = group.tags.find((t) => t.id === target.holder);
          const decl = named(tag?.properties);
          if (tag && decl) return { decl, touch: touchTags, boxes: [box], groups: [] };
        }
        for (const holder of [...box.hands.templates, ...box.hands.hands]) {
          if (holder.id !== target.holder) continue;
          const decl = named(holder.properties);
          if (decl) return { decl, touch: touchHands, boxes: [box], groups: [] };
        }
      }
      return undefined;
    }
    default: {
      // A host scope (`@world`, `@player`, ...): the project shard's own copy
      // of it, in `scopeRegistry` (or a legacy `world` block, read as `world`).
      const decl = named(bundleHostScopes(source.project).find((s) => s.token === target.scope)?.declarations as PropertyDecl[] | undefined);
      return decl ? { decl, touch: (r) => { r.project = true; }, boxes: source.boxes, groups: [] } : undefined;
    }
  }
}

/** Does `(scope, name)` in an expression name the target's quality? */
const refersTo = (target: StageTarget): StageTargetRef | undefined =>
  target.kind === "field" ? undefined : (scope, name) => scope === target.scope && name === target.name;

/** A change's target key (`@story.act`, a bare `@act`) as scope and name. */
export function changeTarget(key: string, dialect: Dialect): { scope: string; name: string } | undefined {
  try {
    const n = parse(key, dialect);
    return n.kind === "scopedvar" ? { scope: n.scope, name: n.name } : undefined;
  } catch { return undefined; }
}

/**
 * Rename the stage `from` to `to` on the quality `target` names, and carry
 * every value and literal that names it. Mutates `source` in place. Undefined
 * when the target is not a quality with that stage, or `to` is already one.
 * A declaration already saved with `to` in place of `from` is taken as renamed,
 * and only the values and literals follow.
 */
export function renameStage(
  source: SourceProject, target: StageTarget, from: string, to: string, dialect: Dialect,
): StageRenameResult | undefined {
  const found = locate(source, target);
  if (!found || found.decl.type !== "quality") return undefined;
  const stages = found.decl.stages ?? [];
  if (to.trim() === "" || from === to) return undefined;
  // The declaration may have been saved with the new name already (an editor
  // that writes its list as typed): then only the values follow. A ladder
  // holding both names, or neither, is not a rename.
  const declared = stages.includes(from) && !stages.includes(to);
  const alreadyDeclared = !stages.includes(from) && stages.includes(to);
  if (!declared && !alreadyDeclared) return undefined;

  const result: StageRenameResult = {
    project: false, map: false, boxes: new Set(), tags: new Set(), hands: new Set(), decks: new Set(), values: 0, expressions: 0,
  };
  if (declared) {
    found.decl.stages = stages.map((s) => (s === from ? to : s));
    if (found.decl.default === from) found.decl.default = to;
    found.touch(result);
  }

  if (target.kind === "field") {
    const box = found.boxes[0]!;
    for (const deck of box.decks) {
      for (const card of deck.shard.cards) {
        const holders = target.template === "fields" ? [card] : card.outcomes;
        for (const h of holders) {
          if (h.fields?.[target.name] === from) {
            h.fields[target.name] = to;
            result.values++;
            result.decks.add(deck);
          }
        }
      }
    }
    return result;
  }

  for (const { group, touch } of found.groups) {
    for (const tag of group.tags) {
      if (tag.values?.[target.name] === from) {
        tag.values[target.name] = to;
        result.values++;
        touch(result);
      }
    }
  }

  // A coverage driver feeding the quality (`@world.act`) proposes its stages
  // by name: they follow the rename like any other value.
  const driver = source.project.coverage?.drivers?.[`@${target.scope}.${target.name}`];
  if (driver) {
    const at = driver.values.indexOf(from);
    if (at >= 0) {
      driver.values = driver.values.map((v) => (v === from ? to : v));
      result.values++;
      result.project = true;
    }
  }

  const isTarget = refersTo(target)!;
  for (const box of found.boxes) {
    for (const site of boxSites(box)) {
      if (found.deck !== undefined && site.deck !== found.deck) continue;
      const src = site.get();
      if (src === undefined) continue;
      const assigned = site.assignedTo !== undefined
        && ((t) => t !== undefined && isTarget(t.scope, t.name))(changeTarget(site.assignedTo, dialect));
      const next = renameStageInExpression(src, dialect, isTarget, from, to, assigned);
      if (next === undefined) continue;
      site.set(next);
      result.expressions++;
      if (site.deck) result.decks.add(site.deck); else result.hands.add(box);
    }
  }
  return result;
}

/**
 * How many conditions and priorities order against the target's ladder (`<`,
 * `<=`, `>`, `>=` with the quality on one side): the gates a reorder changes
 * the meaning of without changing a value. Zero for a field, which no
 * expression reads.
 */
export function stageGateCount(source: SourceProject, target: StageTarget, dialect: Dialect): number {
  const found = locate(source, target);
  const isTarget = refersTo(target);
  if (!found || !isTarget) return 0;
  let gates = 0;
  for (const box of found.boxes) {
    for (const site of boxSites(box)) {
      if (found.deck !== undefined && site.deck !== found.deck) continue;
      const src = site.get();
      if (src !== undefined) gates += gatesIn(src, dialect, isTarget);
    }
  }
  return gates;
}
