// ---------------------------------------------------------------------------
// The domain-aware 3-way merge: reconcile storylets source by immutable id,
// not by line. Inherited from Patter's shipped merge design (patter-merge.md,
// Reboot 7.4) as a strict subset: NO ordered-list merge exists anywhere -
// id-sorted storage removed the order dimension entirely - so every shard
// reduces to id/name-keyed entity merges plus per-field 3-way, driven here by
// a per-shard strategy schema rather than five hand-written mergers.
//
// The merged model is ALWAYS valid canonical source; conflicted values
// resolve provisionally to OURS and are listed separately for the
// `<file>.storyletconflict` sidecar a UI can render. A lingering sidecar is
// a validate error, so an unresolved merge cannot reach CI or export.
// Hand gameId renames get a dedicated warning: deal(hand) is called by name
// from game code, so a rename is a breaking change beyond the project's own
// borders (Reboot 7.4).
//
// Pure - data in, data out, no I/O, no VCS.
// ---------------------------------------------------------------------------

import { canonicalStringify } from "@storylet-studio/compiler";
import type { Issue } from "@storylet-studio/compiler";

export type MergeFileType = "project" | "box" | "tags" | "hands" | "deck" | "view" | "notes";

export type ConflictKind =
  | "both-changed"      // both sides changed the same value differently
  | "delete-vs-edit"    // one side deleted an entity, the other edited it
  | "added-both"        // the same id added on both sides with different content
  | "structural";       // a post-merge structural failure (e.g. a duplicate id)

/** One unresolved 3-way conflict; provisional output is OURS. */
export interface Conflict {
  /** The entity id (or name) involved; "" for a file-level field. */
  id: string;
  /** Dotted path within the file, e.g. `cards[c_1].priority`. */
  path: string;
  base: unknown;
  ours: unknown;
  theirs: unknown;
  kind: ConflictKind;
}

/** A non-blocking note - the merge proceeded, but a human should check. */
export interface Warning {
  id: string;
  path: string;
  message: string;
}

export interface MergeResult {
  type: MergeFileType;
  /** The merged model - valid canonical source; conflicts resolved to OURS. */
  merged: Record<string, unknown>;
  conflicts: Conflict[];
  warnings: Warning[];
}

/** Thrown for un-mergeable input: unknown schema, or version skew between
 *  the three sides. The CLI maps it to exit 2 (the VCS falls back). */
export class MergeInputError extends Error {}

/** The issues a lingering `.storyletconflict` sidecar raises.
 *
 *  The rule is stated at the top of this file - "an unresolved merge cannot
 *  reach CI or export" - and until 2026-08-29 only `runValidate` enforced it,
 *  so `export` and `pack` shipped provisional OURS content silently. Both call
 *  this now, and it lives here rather than in any one of them so the sentence
 *  and the check are in the same file. */
export function sidecarIssues(sidecars: readonly string[]): Issue[] {
  return sidecars.map((sidecar) => ({
    severity: "error" as const, path: sidecar,
    message: "unresolved merge sidecar: resolve the conflicts, then delete this file",
  }));
}

type Obj = Record<string, unknown>;

const eq = (a: unknown, b: unknown): boolean => canonicalStringify(a) === canonicalStringify(b);
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Detect the merge type from a shard's `schema` tag. */
export function detectMergeType(file: { schema?: unknown }): MergeFileType {
  const s = typeof file.schema === "string" ? file.schema : "";
  if (s.startsWith("storylets/project")) return "project";
  if (s.startsWith("storylets/box")) return "box";
  if (s.startsWith("storylets/tags")) return "tags";
  if (s.startsWith("storylets/hands")) return "hands";
  if (s.startsWith("storylets/deck")) return "deck";
  if (s.startsWith("storylets/view")) return "view";
  if (s.startsWith("storylets/notes")) return "notes";
  throw new MergeInputError(`cannot detect a storylets merge type from schema '${s}'`);
}

// --- the strategy schema -------------------------------------------------------
//
// Every shard is a tree of five merge behaviours:
//   atomic          one value, classic 3-way (objects compare canonically)
//   record          an open string-keyed map of atomics (fields, changes, args)
//   map(of)         an open string-keyed map of a nested strategy
//   set             a string[] treated as a set: adds union, deletes respected
//   keyed(key, of)  an entity array keyed by immutable id (or name for
//                   declarations), output sorted by key; delete-vs-edit and
//                   added-both surface as conflicts, never silently
//   object(fields)  a fixed object: named keys get their own strategy,
//                   everything else is atomic

type Strategy =
  | { kind: "atomic" }
  | { kind: "map"; of: Strategy }
  | { kind: "set" }
  | { kind: "keyed"; key: "id" | "name"; of: Strategy; renameWarning?: string }
  | { kind: "object"; fields: Record<string, Strategy> };

const ATOMIC: Strategy = { kind: "atomic" };
const RECORD: Strategy = { kind: "map", of: ATOMIC };
const SET: Strategy = { kind: "set" };
const keyed = (key: "id" | "name", of: Strategy, renameWarning?: string): Strategy =>
  ({ kind: "keyed", key, of, ...(renameWarning !== undefined ? { renameWarning } : {}) });
const object = (fields: Record<string, Strategy>): Strategy => ({ kind: "object", fields });

/** Declarations (PropertyDecl / FieldDecl / ParamDecl) merge per field. */
const DECLS = keyed("name", object({}));

const CARD = object({
  tags: { kind: "map", of: SET },   // tags are sets of tag ids per group
  fields: RECORD,
  outcomes: keyed("id", object({ changes: RECORD })),
});

/** The merge strategies, exported so a test can walk them against the model's
 *  own field names (see merge.test.ts: a spec key the model no longer has is
 *  invisible at runtime, because the subtree simply falls through to ATOMIC). */
export const MERGE_SPECS: Record<MergeFileType, Strategy> = {
  deck: object({
    deck: object({ properties: DECLS }),
    cards: keyed("id", CARD),
  }),
  hands: object({
    templates: keyed("id", object({ bindings: RECORD, chooses: SET, properties: DECLS })),
    hands: keyed("id", object({
      chosen: RECORD, rule: object({ bindings: RECORD }), properties: DECLS, templates: RECORD,
    }), "hand gameId renamed - deal(hand) is called by name from game code, so this is a breaking change for the game"),
  }),
  tags: object({
    groups: keyed("id", object({
      tags: keyed("id", object({ properties: DECLS, templates: RECORD })),
    })),
  }),
  box: object({
    box: object({ fields: DECLS, properties: DECLS, ranking: RECORD }),
  }),
  // The arrangement layer, which merges more than anything else: positions churn.
  // A POINT is atomic per card, deliberately. Taking x from one side and y from
  // the other would synthesise a position neither designer chose, which is worse
  // than a conflict; two people moving DIFFERENT cards is the common case and
  // costs nothing, because every level here is keyed by id.
  view: object({
    canvases: {
      kind: "map",
      of: object({
        cards: RECORD,
        frames: keyed("id", object({})),
      }),
    },
    map: object({ sites: RECORD, frames: keyed("id", object({})) }),
  }),
  // The comment sidecar. Threads are keyed by id, so two reviewers annotating
  // the same box keep both sets of threads - which is the whole point of a
  // reviewer's return leg, and the reason this shard has to have a strategy at
  // all rather than aborting the merge.
  //
  // A thread's own fields are ATOMIC, `messages` included. That means two people
  // replying to the SAME thread conflict rather than interleaving, which is a
  // real limitation and a deliberate one: `CommentMessage` has no id, `keyed`
  // needs one, and inventing an append-merge for unkeyed lists is a design
  // decision rather than a bug fix. A conflict loses nothing and asks a human;
  // silently interleaving two people's replies could reorder an argument.
  notes: object({
    comments: keyed("id", object({})),
  }),
  project: object({
    project: RECORD,
    settings: RECORD,
    world: object({ properties: DECLS }),
    story: object({ properties: DECLS }),
    templates: { kind: "map", of: ATOMIC },
    coverage: object({
      drivers: { kind: "map", of: RECORD },   // per-driver, per-field 3-way
      // `args` lived here until CoverageConfig lost the field. The entry
      // outlived it and named nothing, which is invisible at runtime: an
      // unnamed key just falls through to ATOMIC. Found 2026-08-29 by the
      // guard in merge.test.ts, which the Patter side suggested after we sent
      // them the same bug in a different key. Neither of us found ours by
      // reading; both were found by holding the spec to the model.
    }),
    export: RECORD,
  }),
};

// --- the engine -----------------------------------------------------------------

interface Ctx {
  conflicts: Conflict[];
  warnings: Warning[];
}

function deletedKind(base: unknown, ours: unknown, theirs: unknown): ConflictKind {
  const deleted = base !== undefined && (ours === undefined || theirs === undefined);
  if (deleted) return "delete-vs-edit";
  return base === undefined ? "added-both" : "both-changed";
}

/** Classic 3-way of one value (objects compare canonically). */
function merge3(b: unknown, o: unknown, t: unknown, id: string, path: string, ctx: Ctx): unknown {
  if (eq(o, t)) return o;
  if (eq(b, o)) return t;
  if (eq(b, t)) return o;
  ctx.conflicts.push({ id, path, base: b, ours: o, theirs: t, kind: deletedKind(b, o, t) });
  return o;
}

function mergeValue(spec: Strategy, b: unknown, o: unknown, t: unknown, id: string, path: string, ctx: Ctx): unknown {
  // Composite strategies only apply when neither side deleted the whole
  // value; otherwise the delete-vs-edit question is decided HERE, atomically.
  if (spec.kind === "atomic" || o === undefined || t === undefined || !hasShape(spec, o) || !hasShape(spec, t)) {
    return merge3(b, o, t, id, path, ctx);
  }
  switch (spec.kind) {
    case "set": {
      const B = new Set(asArr(b).filter((x): x is string => typeof x === "string"));
      const O = new Set(asArr(o).filter((x): x is string => typeof x === "string"));
      const T = new Set(asArr(t).filter((x): x is string => typeof x === "string"));
      const out = new Set<string>();
      for (const x of [...O, ...T]) {
        const kept = (O.has(x) && T.has(x)) || !B.has(x);   // survived both, or added
        if (kept) out.add(x);
      }
      return [...out].sort();
    }
    case "map": {
      const B = isObj(b) ? b : {}, O = o as Obj, T = t as Obj;
      const out: Obj = {};
      for (const k of Object.keys({ ...B, ...O, ...T }).sort()) {
        const v = mergeValue(spec.of, B[k], O[k], T[k], id || k, `${path}.${k}`, ctx);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    case "object": {
      const B = isObj(b) ? b : {}, O = o as Obj, T = t as Obj;
      const out: Obj = {};
      for (const k of Object.keys({ ...B, ...O, ...T }).sort()) {
        const v = mergeValue(spec.fields[k] ?? ATOMIC, B[k], O[k], T[k], id, path ? `${path}.${k}` : k, ctx);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    case "keyed":
      return mergeKeyed(spec, asArr(b), asArr(o), asArr(t), path, ctx);
  }
}

/** Does a value structurally fit a composite strategy? (A type change - e.g. a
 *  scalar where an array was - falls back to atomic 3-way rather than lying.) */
function hasShape(spec: Strategy, v: unknown): boolean {
  switch (spec.kind) {
    case "atomic": return true;
    case "set":
    case "keyed": return Array.isArray(v);
    case "map":
    case "object": return isObj(v);
  }
}

/** The id/name-keyed entity merge: presence logic per key (delete-vs-edit,
 *  added-both), fields recursed, output SORTED by key - the whole of
 *  Patter's ordered-list machinery is unnecessary here (Reboot 7.4). */
function mergeKeyed(spec: Extract<Strategy, { kind: "keyed" }>, B: unknown[], O: unknown[], T: unknown[], path: string, ctx: Ctx): unknown[] {
  const keyOf = (v: unknown): string | undefined =>
    isObj(v) && typeof v[spec.key] === "string" ? (v[spec.key] as string) : undefined;
  const toMap = (arr: unknown[]): Map<string, unknown> => {
    const m = new Map<string, unknown>();
    for (const v of arr) {
      const k = keyOf(v);
      if (k !== undefined) m.set(k, v);
    }
    return m;
  };
  const Bm = toMap(B), Om = toMap(O), Tm = toMap(T);
  const out = new Map<string, unknown>();
  const here = (k: string): string => `${path}[${k}]`;

  for (const k of new Set([...Bm.keys(), ...Om.keys(), ...Tm.keys()])) {
    const b = Bm.get(k), o = Om.get(k), t = Tm.get(k);
    const inB = Bm.has(k), inO = Om.has(k), inT = Tm.has(k);
    if (inO && inT) {
      if (!inB && !eq(o, t)) {
        ctx.conflicts.push({ id: k, path: here(k), base: undefined, ours: o, theirs: t, kind: "added-both" });
        out.set(k, o);   // provisional OURS
      } else {
        out.set(k, mergeValue(spec.of, b, o, t, k, here(k), ctx));
      }
    } else if (inO && !inT) {
      if (inB && !eq(o, b)) {
        ctx.conflicts.push({ id: k, path: here(k), base: b, ours: o, theirs: undefined, kind: "delete-vs-edit" });
        out.set(k, o);   // theirs deleted, ours edited -> provisional OURS keeps it
      } else if (!inB) {
        out.set(k, o);   // ours added
      }                  // else: ours unchanged + theirs deleted -> clean delete
    } else if (!inO && inT) {
      if (inB && !eq(t, b)) {
        ctx.conflicts.push({ id: k, path: here(k), base: b, ours: undefined, theirs: t, kind: "delete-vs-edit" });
        // ours deleted -> provisional OURS drops it (still flagged)
      } else if (!inB) {
        out.set(k, t);   // theirs added
      }                  // else: theirs unchanged + ours deleted -> clean delete
    }                    // else: in BASE only -> both deleted -> gone
  }

  // The dedicated rename warning class (queries): the surviving entity's
  // author-facing gameId differs from BASE's.
  if (spec.renameWarning) {
    for (const [k, v] of out) {
      const b = Bm.get(k);
      if (isObj(b) && isObj(v) && typeof b["gameId"] === "string" && typeof v["gameId"] === "string"
        && b["gameId"] !== v["gameId"]) {
        ctx.warnings.push({ id: k, path: here(k), message: `${spec.renameWarning} ("${b["gameId"]}" -> "${v["gameId"]}")` });
      }
    }
  }

  return [...out.keys()].sort().map((k) => out.get(k));
}

/** 3-way merge BASE / OURS / THEIRS (parsed shard models). All three must be
 *  the same shard type and schema version; skew is a MergeInputError. */
export function runMerge(base: Obj, ours: Obj, theirs: Obj, opts?: { type?: MergeFileType }): MergeResult {
  const type = opts?.type ?? detectMergeType(ours);
  for (const [label, side] of [["BASE", base], ["THEIRS", theirs]] as const) {
    if (!eq(side.schema, ours.schema)) {
      throw new MergeInputError(`schema version skew: ${label} is ${JSON.stringify(side.schema)}, OURS is ${JSON.stringify(ours.schema)}`);
    }
  }
  const ctx: Ctx = { conflicts: [], warnings: [] };
  const merged = mergeValue(MERGE_SPECS[type], base, ours, theirs, "", "", ctx) as Obj;
  return { type, merged, conflicts: ctx.conflicts, warnings: ctx.warnings };
}

/** The sidecar filename for a merged shard (a lingering one is a validate error). */
export const CONFLICT_SIDECAR_EXTENSION = ".storyletconflict";

/** The sidecar body: everything a UI needs to render both sides. */
export function conflictSidecar(result: MergeResult): string {
  return JSON.stringify({ type: result.type, conflicts: result.conflicts, warnings: result.warnings }, null, 2) + "\n";
}
