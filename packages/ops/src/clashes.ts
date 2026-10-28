// ---------------------------------------------------------------------------
// Resolving a merge's clashes, one decision at a time (step 6, ruling Q21).
//
// A merge that can't agree keeps OUR side in the merged shard and names the
// clash under the shard's reserved `unresolved` key, with the base, ours and
// theirs it saw (`markUnresolved`, `@wildwinter/toolkit/extensions`). The
// shard alone can therefore drive a resolver: this file reads the mark and
// applies an author's decisions to it.
//
//   - "ours":     keep what the shard holds (our side), and clear the entry;
//   - "theirs":   set the clash's path to their side, and clear the entry;
//   - "resolved": clear the entry only, keeping whatever is there now (the
//                 author has edited it by hand).
//
// Which clashes can take theirs is this format's to say, by its path grammar
// and its merge strategies (`MERGE_SPECS`): a path walks from the shard's top
// through `.key` (an object's field or a map's key) and `[id]` (an entity in a
// list keyed by its id, a declaration by its name, a game scope by its token,
// a comment thread by its id, a message by `author|ts`), and a path ending in
// `:order` is the order of a keyed list. A structural clash isn't a value, and
// a path whose container has gone from the shard can't be set either; both
// still resolve as "ours" or "resolved".
//
// Pure: text in, canonical text out. The caller writes it through the VC layer.
// ---------------------------------------------------------------------------

import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import { EXTENSION_SCHEMA } from "@storylet-studio/model";
import { clearUnresolved, unresolvedOf } from "@wildwinter/toolkit/extensions";
import type { Strategy, UnresolvedEntry } from "@wildwinter/toolkit/extensions";
import { MERGE_SPECS, detectMergeType } from "./merge.js";
import type { ConflictKind } from "./merge.js";

/** What an author decided about one clash. */
export type ClashDecision = "ours" | "theirs" | "resolved";

/** One clash a shard's mark holds, as a resolver lists it. */
export interface ShardClash {
  /** The entry's path in the shard, unique within its mark. */
  path: string;
  kind: ConflictKind;
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
  /** Whether "theirs" can be set as a value. When false, the clash resolves as ours or by hand. */
  settable: boolean;
}

/** A decision `applyResolutions` can't apply: a path the mark doesn't hold, or theirs on a clash that can't take it. */
export class ResolutionError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** One step of a path: a field or map key, or an item of a keyed list. */
type Step = { kind: "key"; name: string } | { kind: "item"; key: string };

/** A clash path, parsed: its steps, and whether it names the order of the list they reach. */
interface ParsedPath { steps: Step[]; order: boolean }

/** Parse `cards[c_1].outcomes[o_2].changes.trust`, `deck.properties:order`, `comments[t_1].messages[Ann|2026-…]`.
 *  Undefined for a path this grammar can't read (an empty one, an unclosed bracket). */
export function parseClashPath(path: string): ParsedPath | undefined {
  let rest = path;
  let order = false;
  if (rest.endsWith(":order")) { order = true; rest = rest.slice(0, -":order".length); }
  const steps: Step[] = [];
  let i = 0;
  while (i < rest.length) {
    const c = rest[i]!;
    if (c === "[") {
      const close = rest.indexOf("]", i);
      if (close < 0) return undefined;
      steps.push({ kind: "item", key: rest.slice(i + 1, close) });
      i = close + 1;
    } else {
      if (c === ".") i++;
      let j = i;
      while (j < rest.length && rest[j] !== "." && rest[j] !== "[") j++;
      if (j === i) return undefined;
      steps.push({ kind: "key", name: rest.slice(i, j) });
      i = j;
    }
  }
  return steps.length > 0 ? { steps, order } : undefined;
}

/** How a keyed list's items are told apart: the comment strategy's threads by id and messages by author and time. */
type ItemKey = (item: Obj) => string | undefined;
const byField = (field: string): ItemKey => (item) => (typeof item[field] === "string" ? item[field] as string : undefined);
const messageKey: ItemKey = (m) => `${String(m["author"] ?? "")}|${String(m["ts"] ?? "")}`;
/** For a shard with no strategy to say (an extension's lists without its manifest): the usual id fields. */
const anyIdField: ItemKey = (item) => {
  for (const f of ["id", "name", "token"]) if (typeof item[f] === "string") return item[f] as string;
  return undefined;
};

/** The strategy a value at the next step merges by, and how a list there is keyed. Undefined: no strategy to follow. */
type Cursor = { spec: Strategy | undefined; itemKey?: ItemKey; inComments?: "threads" | "thread" | "messages" };

function childOf(cur: Cursor, step: Step): Cursor {
  const spec = cur.spec;
  if (cur.inComments === "threads") return { spec: undefined, inComments: "thread" };
  if (cur.inComments === "thread") {
    return step.kind === "key" && step.name === "messages" ? { spec: undefined, itemKey: messageKey, inComments: "messages" } : { spec: undefined };
  }
  if (spec === undefined) return { spec: undefined };
  switch (spec.kind) {
    case "object": {
      if (step.kind !== "key") return { spec: undefined };
      const field = Object.prototype.hasOwnProperty.call(spec.fields, step.name) ? spec.fields[step.name]! : spec.other ?? { kind: "atomic" };
      return withListKey(field);
    }
    case "map": return step.kind === "key" ? withListKey(spec.of) : { spec: undefined };
    case "keyed": return step.kind === "item" ? withListKey(spec.of) : { spec: undefined };
    default: return { spec: undefined };
  }
}

function withListKey(spec: Strategy): Cursor {
  if (spec.kind === "keyed") return { spec, itemKey: byField(spec.key) };
  if (spec.kind === "comments") return { spec, itemKey: byField("id"), inComments: "threads" };
  return { spec };
}

/** The strategy a shard's top merges by, or undefined for one this format can't type. */
function rootCursor(shard: Obj): Cursor {
  try {
    const type = detectMergeType(shard);
    return { spec: type === "extension" ? undefined : MERGE_SPECS[type] };
  } catch {
    return { spec: undefined };
  }
}

/**
 * A map's key can hold a dot (`@story.trust`, a change's target), which the path's grammar doesn't escape:
 * `changes.@story.trust` is the key `@story.trust` of the map `changes`. Walking the shard with its strategy,
 * a run of key steps under a map is joined back into the longest key the map holds, or, at the end of the
 * path, into one key whatever it holds (their side may be adding it).
 */
function joinMapKeys(shard: Obj, steps: readonly Step[]): Step[] {
  const out: Step[] = [];
  let here: unknown = shard;
  let cur = rootCursor(shard);
  let i = 0;
  while (i < steps.length) {
    const step = steps[i]!;
    let take = 1;
    if (step.kind === "key" && cur.spec?.kind === "map") {
      let end = i;
      while (end + 1 < steps.length && steps[end + 1]!.kind === "key") end++;
      const joined = (to: number): string => steps.slice(i, to + 1).map((s) => (s as { name: string }).name).join(".");
      take = end + 1 - i;
      if (end + 1 < steps.length || !isObj(here) || !Object.prototype.hasOwnProperty.call(here, joined(end))) {
        // Not the whole tail as one key: the longest run the map holds, else one segment, or the whole tail at the end.
        let found = 0;
        for (let to = end; to > i && isObj(here); to--) {
          if (Object.prototype.hasOwnProperty.call(here, joined(to))) { found = to + 1 - i; break; }
        }
        take = found > 0 ? found : end + 1 === steps.length ? end + 1 - i : 1;
      }
      const name = joined(i + take - 1);
      out.push({ kind: "key", name });
      cur = childOf(cur, { kind: "key", name });
      here = isObj(here) ? here[name] : undefined;
    } else {
      out.push(step);
      const next = childOf(cur, step);
      if (step.kind === "key") here = isObj(here) ? here[step.name] : undefined;
      else here = Array.isArray(here) ? here.find((x) => isObj(x) && (cur.itemKey ?? anyIdField)(x) === step.key) : undefined;
      cur = next;
    }
    i += take;
  }
  return out;
}

/** Where a path's last step lands: the container that holds it, and how to reach it there. */
interface Place {
  container: Obj | unknown[];
  last: Step;
  /** For a list: how its items are keyed. */
  itemKey: ItemKey;
}

function locate(shard: Obj, steps: readonly Step[]): Place | undefined {
  let here: unknown = shard;
  let cur = rootCursor(shard);
  const keyOf = (c: Cursor): ItemKey => c.itemKey ?? anyIdField;
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i]!;
    const next = childOf(cur, step);
    if (step.kind === "key") {
      if (!isObj(here) || (!isObj(here[step.name]) && !Array.isArray(here[step.name]))) return undefined;
      here = here[step.name];
    } else {
      if (!Array.isArray(here)) return undefined;
      const k = keyOf(cur);
      const found = here.find((x) => isObj(x) && k(x) === step.key);
      if (found === undefined) return undefined;
      here = found;
    }
    cur = next;
  }
  const last = steps[steps.length - 1]!;
  if (last.kind === "key" ? !isObj(here) : !Array.isArray(here)) return undefined;
  return { container: here as Obj | unknown[], last, itemKey: cur.itemKey ?? anyIdField };
}

/** The list a `:order` path names, and how its items are keyed. */
function locateList(shard: Obj, steps: readonly Step[]): { list: unknown[]; itemKey: ItemKey } | undefined {
  const place = locate(shard, steps);
  if (place === undefined) return undefined;
  const { container, last } = place;
  const list = last.kind === "key" && isObj(container) ? container[last.name] : undefined;
  if (!Array.isArray(list)) return undefined;
  // The list's own keying, one step further down the strategy.
  let cur = rootCursor(shard);
  for (const step of steps) cur = childOf(cur, step);
  return { list, itemKey: cur.itemKey ?? anyIdField };
}

const isKeyList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Can this clash take their side as a value in this shard as it stands? */
export function isSettable(shard: unknown, entry: UnresolvedEntry): boolean {
  if (!isObj(shard) || entry.kind === "structural" || typeof entry.path !== "string") return false;
  const parsed = parseClashPath(entry.path);
  if (parsed === undefined) return false;
  // An extension's entries are the extension's own shape: only a field of a node's entry can be named
  // there, never an item of one of its lists, which only the manifest knows how to key.
  if (shard["schema"] === EXTENSION_SCHEMA && parsed.steps.some((s) => s.kind === "item")) return false;
  const steps = joinMapKeys(shard, parsed.steps);
  if (parsed.order) {
    const found = locateList(shard, steps);
    return found !== undefined && isKeyList(entry.theirs);
  }
  return locate(shard, steps) !== undefined;
}

/** Set one clash's path to their side. Their side absent means they removed it, so it goes. */
function setTheirs(shard: Obj, entry: UnresolvedEntry): void {
  const parsed = parseClashPath(entry.path)!;
  const steps = joinMapKeys(shard, parsed.steps);
  if (parsed.order) {
    const { list, itemKey } = locateList(shard, steps)!;
    const wanted = entry.theirs as string[];
    const keyOf = (x: unknown): string | undefined => (isObj(x) ? itemKey(x) : undefined);
    // The items both orders hold take their places in their order; anything else stays where it is.
    const slots = list.map((x, i) => [i, keyOf(x)] as const).filter(([, k]) => k !== undefined && wanted.includes(k));
    const byKey = new Map(slots.map(([i, k]) => [k!, list[i]]));
    const inOrder = wanted.filter((k) => byKey.has(k));
    slots.forEach(([i], n) => { list[i] = byKey.get(inOrder[n]!); });
    return;
  }
  const { container, last, itemKey } = locate(shard, steps)!;
  const theirs = entry.theirs;
  if (last.kind === "key") {
    const obj = container as Obj;
    if (theirs === undefined) delete obj[last.name];
    else obj[last.name] = structuredClone(theirs);
    return;
  }
  const list = container as unknown[];
  const at = list.findIndex((x) => isObj(x) && itemKey(x) === last.key);
  if (theirs === undefined) {
    if (at >= 0) list.splice(at, 1);
  } else if (at >= 0) {
    list[at] = structuredClone(theirs);
  } else {
    list.push(structuredClone(theirs));
  }
}

/** Every clash a shard's mark holds, with whether each can take their side. Empty for a shard with no mark. */
export function clashesOf(shard: unknown): ShardClash[] {
  const mark = unresolvedOf(shard) ?? [];
  return mark
    .filter((e): e is UnresolvedEntry => isObj(e) && typeof e.path === "string")
    .map((e) => ({
      path: e.path, kind: e.kind as ConflictKind,
      ...(e.base !== undefined ? { base: e.base } : {}),
      ...(e.ours !== undefined ? { ours: e.ours } : {}),
      ...(e.theirs !== undefined ? { theirs: e.theirs } : {}),
      settable: isSettable(shard, e),
    }));
}

/** How many clashes a project's shards hold, all told: what a resolver's banner counts. Cheap: almost no shard
 *  has a mark, and each text is tested before it's parsed. A shard that won't parse is the loader's to report. */
export function countClashes(files: readonly { text: string }[]): number {
  let n = 0;
  for (const file of files) {
    if (!file.text.includes("unresolved")) continue;
    try { n += (unresolvedOf(parseSource(file.text)) ?? []).length; } catch { /* reported by the loader */ }
  }
  return n;
}

/**
 * Apply an author's decisions to a merged shard's clashes, by path, and answer
 * the shard's new canonical text. "ours" and "resolved" clear the entry and
 * leave the value as it is; "theirs" sets the path to their side first. The mark
 * goes when nothing is left in it.
 *
 * Throws `ResolutionError` for a path the mark doesn't hold, or "theirs" on a
 * clash that can't take it (see `isSettable`); nothing is applied then.
 */
export function applyResolutions(shardText: string, decisions: Readonly<Record<string, ClashDecision>>): string {
  const shard = parseSource(shardText) as Obj;
  const mark = new Map((unresolvedOf(shard) ?? [])
    .filter((e): e is UnresolvedEntry => isObj(e) && typeof e.path === "string")
    .map((e) => [e.path, e]));
  const paths = Object.keys(decisions);
  for (const path of paths) {
    const entry = mark.get(path);
    if (entry === undefined) throw new ResolutionError(`no unresolved clash at ${path}`);
    const decision = decisions[path];
    if (decision !== "ours" && decision !== "theirs" && decision !== "resolved") {
      throw new ResolutionError(`unknown decision ${JSON.stringify(decision)} for ${path}`);
    }
    if (decision === "theirs" && !isSettable(shard, entry)) {
      throw new ResolutionError(`the clash at ${path} can't take their side as a value: keep ours or edit it`);
    }
  }
  for (const path of paths) if (decisions[path] === "theirs") setTheirs(shard, mark.get(path)!);
  return canonicalStringify(clearUnresolved(shard, paths));
}
