// ---------------------------------------------------------------------------
// A property renamed where it is used.
//
// Renaming a declaration used to rename the declaration alone, so every card
// that read or wrote the property broke, and the editor's "uses" count kept
// the old name (the hands-on review, 2026-10, foundation 4). A rename is not a
// Replace, which deliberately leaves conditions and changes alone: it is the
// same property under a new name, so it visits everything that names it, in
// one edit:
//
//   - the declaration itself
//   - references in conditions, priorities and changes' right-hand sides
//   - the target key of a change (`"@story.gold": ...`), in place
//   - a tag group's `boundBy` and a hand's hole references (`@hand.zone`)
//   - a coverage driver keyed by the property (`@world.danger`)
//
// The rewrite keeps the author's own text: each reference is renamed where it
// stands, in the form it was written (`@gold` stays bare, `@story.gold` stays
// qualified), and the result is parsed back and compared with the renamed tree
// before it is kept. Where the text cannot be kept (it never happens with the
// grammar as it is), the expression is written back from the tree.
//
// Pure over the parsed project, like `renameStage`: mutates the shards in
// place and reports which changed, for the caller to write as one undoable step.
// ---------------------------------------------------------------------------

import { parse, unparse } from "@wildwinter/expr";
import type { Dialect, ExprNode } from "@wildwinter/expr";
import type { SourceProject } from "@storylet-studio/compiler";
import { boxSites, changeTarget, locate } from "./stages.js";
import type { StageRenameResult, StageTarget } from "./stages.js";

/** The property a rename is about: a stage target that names a property. */
export type PropertyTarget = Extract<StageTarget, { kind: "property" }>;

/** What a rename touched: the stage rename's shape, `values` counting change
 *  keys, bindings and drivers. */
export type PropertyRenameResult = StageRenameResult;

/** Where `target`'s declaration lives, or undefined when the scope doesn't
 *  declare it. */
export function locateProperty(source: SourceProject, target: PropertyTarget): ReturnType<typeof locate> {
  return locate(source, target);
}

/**
 * Rename `target` to `to` and carry every reference to it. Mutates `source` in
 * place. Undefined when the target names no declaration, `to` is not a usable
 * name, or the scope already declares `to` there (two properties would become
 * one). A declaration already saved under `to` (an editor that writes its
 * list as typed) is taken as renamed, and only the references follow.
 */
export function renameProperty(
  source: SourceProject, target: PropertyTarget, to: string, dialect: Dialect,
): PropertyRenameResult | undefined {
  const from = target.name;
  if (to.trim() === "" || to === from) return undefined;
  const found = locate(source, target);
  const already = found === undefined ? locate(source, { ...target, name: to }) : undefined;
  if (found === undefined && already === undefined) return undefined;
  if (found !== undefined && locate(source, { ...target, name: to }) !== undefined) return undefined;

  const result: PropertyRenameResult = {
    project: false, map: false, boxes: new Set(), tags: new Set(), hands: new Set(), decks: new Set(), values: 0, expressions: 0,
  };
  const where = (found ?? already)!;
  if (found !== undefined) {
    found.decl.name = to;
    found.touch(result);
  }

  const isTarget = (scope: string, name: string): boolean => scope === target.scope && name === from;
  const rename = (src: string): string | undefined => renamePropertyInExpression(src, dialect, isTarget, to);

  for (const box of where.boxes) {
    for (const site of boxSites(box)) {
      if (where.deck !== undefined && site.deck !== where.deck) continue;
      const src = site.get();
      if (src === undefined) continue;
      const next = rename(src);
      if (next === undefined) continue;
      site.set(next);
      result.expressions++;
      if (site.deck) result.decks.add(site.deck); else result.hands.add(box);
    }
    // A change's target key, renamed in place so the changes keep their order.
    for (const deck of box.decks) {
      if (where.deck !== undefined && deck !== where.deck) continue;
      for (const card of deck.shard.cards) {
        for (const outcome of card.outcomes) {
          const changes = outcome.changes as Record<string, string>;
          const keys = Object.keys(changes);
          if (!keys.some((k) => ((t) => t !== undefined && isTarget(t.scope, t.name))(changeTarget(k, dialect)))) continue;
          const renamed: Record<string, string> = {};
          for (const key of keys) {
            const t = changeTarget(key, dialect);
            const nextKey = t !== undefined && isTarget(t.scope, t.name) ? rename(key) ?? key : key;
            renamed[nextKey] = changes[key]!;
          }
          for (const key of keys) delete changes[key];
          Object.assign(changes, renamed);
          result.values++;
          result.decks.add(deck);
        }
      }
    }
    // What binds a tag group, and a hand's hole references.
    for (const group of box.tags.groups) {
      const next = group.boundBy !== undefined ? rename(group.boundBy) : undefined;
      if (next !== undefined) { group.boundBy = next; result.values++; result.tags.add(box); }
    }
    for (const hand of [...box.hands.templates, ...box.hands.hands]) {
      const chosen = (hand as { chosen?: Record<string, string> }).chosen;
      for (const [group, ref] of Object.entries(chosen ?? {})) {
        const next = rename(ref);
        if (next !== undefined) { chosen![group] = next; result.values++; result.hands.add(box); }
      }
    }
  }

  // A coverage driver is keyed by the reference it feeds.
  const drivers = source.project.coverage?.drivers;
  if (drivers !== undefined) {
    const key = `@${target.scope}.${from}`;
    if (drivers[key] !== undefined) {
      const renamed: typeof drivers = {};
      for (const [k, v] of Object.entries(drivers)) renamed[k === key ? `@${target.scope}.${to}` : k] = v;
      for (const k of Object.keys(drivers)) delete drivers[k];
      Object.assign(drivers, renamed);
      result.values++;
      result.project = true;
    }
  }
  return result;
}

/**
 * Rename every reference `isTarget` picks out in `src` to `to`, keeping the
 * author's text; undefined when there is none, or `src` does not parse.
 */
export function renamePropertyInExpression(
  src: string, dialect: Dialect, isTarget: (scope: string, name: string) => boolean, to: string,
): string | undefined {
  let ast: ExprNode;
  try { ast = parse(src, dialect); } catch { return undefined; }
  let hits = 0;
  const walk = (n: ExprNode): ExprNode => {
    switch (n.kind) {
      case "scopedvar":
        if (isTarget(n.scope, n.name)) { hits++; return { ...n, name: to }; }
        return n;
      case "binary": return { ...n, left: walk(n.left), right: walk(n.right) };
      case "unary": return { ...n, operand: walk(n.operand) };
      case "call": return { ...n, args: n.args.map(walk) };
      default: return n;
    }
  };
  const next = walk(ast);
  if (hits === 0) return undefined;
  const wanted = JSON.stringify(next);

  // Every reference outside a string literal, renamed where its own parse says
  // it is the target: `@gold` and `@story.gold` alike.
  let text = "";
  let at = 0;
  for (const ref of references(src)) {
    let refers = false;
    try {
      const n = parse(src.slice(ref.at, ref.end), dialect);
      refers = n.kind === "scopedvar" && isTarget(n.scope, n.name);
    } catch { /* not a reference on its own: leave it */ }
    if (!refers) continue;
    text += src.slice(at, ref.nameAt) + to;
    at = ref.end;
  }
  text += src.slice(at);
  try {
    if (JSON.stringify(parse(text, dialect)) === wanted) return text;
  } catch { /* fall through to the tree */ }
  return unparse(next, dialect);
}

/** Each `@scope.name` or `@name` outside a string literal: where it starts,
 *  where its name starts, and where it ends. */
function references(src: string): { at: number; nameAt: number; end: number }[] {
  const out: { at: number; nameAt: number; end: number }[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'") {
      // Past the literal, escapes and all.
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "@") {
      const m = /^@(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(i));
      if (m) {
        const end = i + m[0].length;
        out.push({ at: i, nameAt: end - m[2]!.length, end });
        i = end;
        continue;
      }
    }
    i++;
  }
  return out;
}
