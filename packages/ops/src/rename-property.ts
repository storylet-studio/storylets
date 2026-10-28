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
// A host scope renamed (`@player` to `@hero`, in Project Settings) is carried
// the same way by `renameScope`, over the same sites: every reference keeps its
// property name and takes the new token.
//
// Pure over the parsed project, like `renameStage`: mutates the shards in
// place and reports which changed, for the caller to write as one undoable step.
// ---------------------------------------------------------------------------

import { parse, unparse } from "@wildwinter/expr";
import type { Dialect, ExprNode } from "@wildwinter/expr";
import type { SourceBox, SourceDeck, SourceProject } from "@storylet-studio/compiler";
import { bundleHostScopes } from "@storylet-studio/model";
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
  carryReferences(source, where.boxes, where.deck, (scope, name) => (isTarget(scope, name) ? { scope, name: to } : undefined), dialect, dialect, result);
  return result;
}

/** What a scope rename touched: the property rename's shape. */
export type ScopeRenameResult = PropertyRenameResult;

/**
 * Rename the host scope `from` (`player`) to `to` (`hero`) and carry every
 * reference to it, as a property rename carries a property: `@player.hp` reads
 * `@hero.hp` in conditions, priorities, changes and their target keys, a tag
 * group's `boundBy` (the project map's zone group's too), a hand's holes, and
 * the coverage drivers' keys. The scope's own entry in `scopeRegistry` is
 * renamed in place, so it keeps its place in the list.
 *
 * `dialect` is the project's as it stands, which knows `@from`; the rewritten
 * text is checked against it with `@to` added. Mutates `source` in place.
 * Undefined, with nothing changed, when `to` is not a usable token, the project
 * already declares `@to` beside `@from` (two scopes would become one), or it
 * declares neither. A registry already saved under `to` (and no longer `from`)
 * is taken as renamed, and only the references follow.
 */
export function renameScope(source: SourceProject, from: string, to: string, dialect: Dialect): ScopeRenameResult | undefined {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(to) || to === from) return undefined;
  const scopes = bundleHostScopes(source.project);
  const found = scopes.find((s) => s.token === from);
  const taken = scopes.some((s) => s.token === to);
  if (found === undefined && !taken) return undefined;
  if (found !== undefined && taken) return undefined;
  const known = dialect.scopes.find((s) => s.token === from);
  if (known === undefined) return undefined;

  const result: ScopeRenameResult = {
    project: false, map: false, boxes: new Set(), tags: new Set(), hands: new Set(), decks: new Set(), values: 0, expressions: 0,
  };
  if (found !== undefined) {
    // A legacy `world` block is `@world`, whose token is fixed: only a registry entry renames.
    if (source.project.scopeRegistry === undefined) return undefined;
    found.token = to;
    result.project = true;
  }
  // The text after the rename names `@to`, which the project's dialect does not know yet.
  const after: Dialect = dialect.scopes.some((s) => s.token === to) ? dialect : { ...dialect, scopes: [...dialect.scopes, { ...known, token: to }] };
  carryReferences(source, source.boxes, undefined, (scope, name) => (scope === from ? { scope: to, name } : undefined), dialect, after, result, true);
  return result;
}

/**
 * Carry a rename through every reference in `boxes` (one deck's only, when
 * `deck` is given), and through the coverage drivers' keys: the work shared by
 * a property rename and a scope rename. `rename` says what a reference becomes;
 * `dialect` reads the text as it is, `after` the text as it will be. With
 * `withMap`, the project map's zone group's `boundBy` too.
 */
function carryReferences(
  source: SourceProject, boxes: readonly SourceBox[], deck: SourceDeck | undefined,
  rename: ReferenceRename, dialect: Dialect, after: Dialect, result: PropertyRenameResult, withMap = false,
): void {
  const redo = (src: string): string | undefined => renameReferencesInExpression(src, dialect, rename, after);
  const refers = (key: string): boolean => ((t) => t !== undefined && rename(t.scope, t.name) !== undefined)(changeTarget(key, dialect));

  for (const box of boxes) {
    for (const site of boxSites(box)) {
      if (deck !== undefined && site.deck !== deck) continue;
      const src = site.get();
      if (src === undefined) continue;
      const next = redo(src);
      if (next === undefined) continue;
      site.set(next);
      result.expressions++;
      if (site.deck) result.decks.add(site.deck); else result.hands.add(box);
    }
    // A change's target key, renamed in place so the changes keep their order.
    for (const d of box.decks) {
      if (deck !== undefined && d !== deck) continue;
      for (const card of d.shard.cards) {
        for (const outcome of card.outcomes) {
          const changes = (outcome.changes ?? {}) as Record<string, string>;
          const keys = Object.keys(changes);
          if (!keys.some(refers)) continue;
          const renamed: Record<string, string> = {};
          for (const key of keys) renamed[refers(key) ? redo(key) ?? key : key] = changes[key]!;
          for (const key of keys) delete changes[key];
          Object.assign(changes, renamed);
          result.values++;
          result.decks.add(d);
        }
      }
    }
    // What binds a tag group, and a hand's hole references.
    for (const group of box.tags.groups) {
      const next = group.boundBy !== undefined ? redo(group.boundBy) : undefined;
      if (next !== undefined) { group.boundBy = next; result.values++; result.tags.add(box); }
    }
    for (const hand of [...box.hands.templates, ...box.hands.hands]) {
      const chosen = (hand as { chosen?: Record<string, string> }).chosen;
      for (const [group, ref] of Object.entries(chosen ?? {})) {
        const next = redo(ref);
        if (next !== undefined) { chosen![group] = next; result.values++; result.hands.add(box); }
      }
    }
  }

  // The project map's zone group, bound by the state its boxes share.
  const mapGroup = withMap ? source.map?.group : undefined;
  if (mapGroup?.boundBy !== undefined) {
    const next = redo(mapGroup.boundBy);
    if (next !== undefined) { mapGroup.boundBy = next; result.values++; result.map = true; }
  }

  // A coverage driver is keyed by the reference it feeds (`@world.danger`, as the settings write it).
  const drivers = source.project.coverage?.drivers;
  if (drivers !== undefined) {
    const keyOf = (k: string): string => {
      const m = /^@([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(k);
      const r = m ? rename(m[1]!, m[2]!) : undefined;
      return r ? `@${r.scope}.${r.name}` : k;
    };
    if (Object.keys(drivers).some((k) => keyOf(k) !== k)) {
      const renamed: typeof drivers = {};
      for (const [k, v] of Object.entries(drivers)) { if (keyOf(k) !== k) result.values++; renamed[keyOf(k)] = v; }
      for (const k of Object.keys(drivers)) delete drivers[k];
      Object.assign(drivers, renamed);
      result.project = true;
    }
  }
}

/** What a reference becomes under a rename (its scope and name), or undefined to leave it. */
export type ReferenceRename = (scope: string, name: string) => { scope: string; name: string } | undefined;

/**
 * Rename every reference `isTarget` picks out in `src` to `to`, keeping the
 * author's text; undefined when there is none, or `src` does not parse.
 */
export function renamePropertyInExpression(
  src: string, dialect: Dialect, isTarget: (scope: string, name: string) => boolean, to: string,
): string | undefined {
  return renameReferencesInExpression(src, dialect, (scope, name) => (isTarget(scope, name) ? { scope, name: to } : undefined));
}

/**
 * Rename every reference `rename` picks out in `src`, its scope, its name or
 * both, keeping the author's text; undefined when there is none, or `src` does
 * not parse. `dialect` reads `src`; `after` reads the result (a scope rename's
 * new token is one `dialect` does not know yet).
 */
export function renameReferencesInExpression(
  src: string, dialect: Dialect, rename: ReferenceRename, after: Dialect = dialect,
): string | undefined {
  let ast: ExprNode;
  try { ast = parse(src, dialect); } catch { return undefined; }
  let hits = 0;
  const walk = (n: ExprNode): ExprNode => {
    switch (n.kind) {
      case "scopedvar": {
        const r = rename(n.scope, n.name);
        if (r === undefined) return n;
        hits++;
        return { ...n, scope: r.scope, name: r.name };
      }
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
  // it is a target: `@gold` and `@story.gold` alike. A name keeps the form it
  // was written in; a reference whose scope changes is written qualified.
  let text = "";
  let at = 0;
  for (const ref of references(src)) {
    let r: { scope: string; name: string } | undefined;
    let was: string | undefined;
    try {
      const n = parse(src.slice(ref.at, ref.end), dialect);
      if (n.kind === "scopedvar") { r = rename(n.scope, n.name); was = n.scope; }
    } catch { /* not a reference on its own: leave it */ }
    if (r === undefined) continue;
    text += r.scope === was ? src.slice(at, ref.nameAt) + r.name : `${src.slice(at, ref.at)}@${r.scope}.${r.name}`;
    at = ref.end;
  }
  text += src.slice(at);
  try {
    if (JSON.stringify(parse(text, after)) === wanted) return text;
  } catch { /* fall through to the tree */ }
  return unparse(next, after);
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
