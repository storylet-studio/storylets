// ---------------------------------------------------------------------------
// The domain-aware 3-way merge: reconcile storylets source by immutable id,
// not by line. Inherited from Patter's shipped merge design (patter-merge.md,
// Reboot 7.4) as a strict subset: id-sorted storage removed the order
// dimension from every entity list, so every shard reduces to id/name-keyed
// entity merges plus per-field 3-way, driven here by a per-shard strategy
// schema rather than five hand-written mergers. The one order kept is a
// declaration list's, which the author arranges with Move up and Move down.
//
// The merged model is ALWAYS valid canonical source; conflicted values
// resolve provisionally to OURS, and the clashes are written into the merged
// shard itself under the reserved key `unresolved` (ruled 2026-10-18, in both
// formats), so the mark travels with the file and validation, and so CI,
// refuses it wherever the file goes. They are also listed for the
// `<file>.storyletconflict` sidecar a UI can render, which stays uncommitted;
// a lingering sidecar is a validate error too.
// Hand gameId renames get a dedicated warning: deal(hand) is called by name
// from game code, so a rename is a breaking change beyond the project's own
// borders (Reboot 7.4).
//
// Pure - data in, data out, no I/O, no VCS.
// ---------------------------------------------------------------------------

import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import type { Issue, SourceFile } from "@storylet-studio/compiler";
import {
  BOX_SCHEMA, CONTRACT_SCHEMA, DECK_SCHEMA, EXTENSION_SCHEMA, HANDS_SCHEMA, MANIFEST_EXTENSION, MAP_SCHEMA, NOTES_SCHEMA,
  PROJECTMAP_SCHEMA,
  PROJECT_SCHEMA, TAGS_SCHEMA, VIEW_SCHEMA,
} from "@storylet-studio/model";
import {
  ATOMIC as ExtATOMIC, COMMENTS, SET as ExtSET, extensionDataStrategy, keyedBy, mapOf, markUnresolved, mergeExtensionData, mergeTree,
  objectOf, unresolvedProblems, withoutMark,
} from "@wildwinter/toolkit/extensions";
import type { Manifest, Strategy } from "@wildwinter/toolkit/extensions";
import type { PlannedWrite } from "./write.js";

export type MergeFileType = "project" | "box" | "tags" | "hands" | "deck" | "view" | "map" | "projectmap" | "notes" | "contract"
  | "extension";

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
  /** The merged model - valid canonical source; conflicts resolved to OURS, and
   *  named under `unresolved` when there are any. */
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

/** A schema tag without its version: `storylets/deck@0` is `storylets/deck`. */
const schemaName = (schema: string): string => schema.split("@")[0]!;

/**
 * Every shard schema, by name, to its merge type: an EXACT table, built from
 * the model's own constants. Until 2026-10-06 this was a chain of prefix
 * tests, and `storylets/projectmap` matched `storylets/project` first, so two
 * designers moving different zones of the project map merged it with the
 * project shard's strategy (its group atomic) and conflicted.
 */
const MERGE_TYPES: ReadonlyMap<string, MergeFileType> = new Map(([
  [PROJECT_SCHEMA, "project"], [BOX_SCHEMA, "box"], [TAGS_SCHEMA, "tags"], [HANDS_SCHEMA, "hands"],
  [DECK_SCHEMA, "deck"], [VIEW_SCHEMA, "view"], [MAP_SCHEMA, "map"], [PROJECTMAP_SCHEMA, "projectmap"],
  [NOTES_SCHEMA, "notes"], [CONTRACT_SCHEMA, "contract"], [EXTENSION_SCHEMA, "extension"],
] as const).map(([schema, type]): [string, MergeFileType] => [schemaName(schema), type]));

/** Detect the merge type from a shard's `schema` tag. The version is not part
 *  of the type: a skew between the three sides is `runMerge`'s to refuse. */
export function detectMergeType(file: { schema?: unknown }): MergeFileType {
  const s = typeof file.schema === "string" ? file.schema : "";
  const type = MERGE_TYPES.get(schemaName(s));
  if (type === undefined) throw new MergeInputError(`cannot detect a storylets merge type from schema '${s}'`);
  return type;
}

// --- the strategy schema -------------------------------------------------------
//
// Every shard is a tree of five merge behaviours:
//   atomic          one value, classic 3-way (objects compare canonically)
//   record          an open string-keyed map of atomics (fields, changes, args)
//   map(of)         an open string-keyed map of a nested strategy
//   set             a string[] treated as a set: adds union, deletes respected
//   keyed(key, of)  an entity array keyed by immutable id, output sorted by
//                   key, or by name for declarations, in the authored order;
//                   delete-vs-edit and added-both surface as conflicts, never
//                   silently
//   object(fields)  a fixed object: named keys get their own strategy,
//                   everything else is atomic
//   comments        comment threads, merged message by message

// The engine is `@wildwinter/toolkit/extensions`' `mergeTree`, lifted from this file
// (family parity item 6): the strategy table below is this format's, the five
// behaviours and the walk are the family's.
const ATOMIC: Strategy = ExtATOMIC;
const RECORD: Strategy = mapOf(ATOMIC);
const SET: Strategy = ExtSET;
const keyed = (key: "id" | "name", of: Strategy, renameWarning?: string): Strategy =>
  keyedBy(key, of, renameWarning !== undefined ? { renameWarning } : undefined);
const object = (fields: Record<string, Strategy>): Strategy => objectOf(fields);

/** Declarations (PropertyDecl / FieldDecl / ParamDecl) merge per field, and keep
 *  the order the author gave them: the Card template and the property lists
 *  offer Move up and Move down, and a merge that sorted them by name undid that
 *  silently (family parity item 4). The side that reordered wins; both
 *  reordering differently is a clash that keeps ours. */
const DECLS = keyedBy("name", object({}), { order: "preserve" });

const CARD = object({
  tags: { kind: "map", of: SET },   // tags are sets of tag ids per group
  fields: RECORD,
  // An outcome's own fields merge per NAME, exactly as a card's do and for the
  // same reason: two people filling different fields of one outcome (the
  // after-line and a sound cue, say) is two unrelated edits, and a whole-object
  // 3-way would make them collide.
  outcomes: keyed("id", object({ changes: RECORD, fields: RECORD })),
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
    // `outcomeFields` is the outcome half of the card template (model
    // `Box.outcomeFields`), and merges as the card half does: name-keyed, so
    // two people declaring different outcome fields both land.
    box: object({ fields: DECLS, outcomeFields: DECLS, properties: DECLS, ranking: RECORD }),
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
    // The map's OLD address, kept for the compatibility window so a pre-split
    // project still merges where its map actually is. It goes when the field does.
    map: object({ sites: RECORD, frames: keyed("id", object({})) }),
  }),
  // The map shard: the same strategy the view's map half had, word for word,
  // which is the whole benefit of moving the block rather than reshaping it. A
  // SITE is atomic per hand for the reason a card's point is: half of one
  // designer's position and half of another's is a place neither chose.
  map: object({
    map: object({ sites: RECORD, frames: keyed("id", object({})) }),
  }),
  // The PROJECT map shard (design/project-map-contract.md 1.1): designer shape,
  // like a box's map shard. Its group merges exactly as a group in a tags shard
  // does, tag by tag, and its frames as a canvas's.
  projectmap: object({
    group: object({ tags: keyed("id", object({ properties: DECLS, templates: RECORD })) }),
    frames: keyed("id", object({})),
  }),
  // The comment sidecar. Threads are keyed by id, so two reviewers annotating
  // the same box keep both sets of threads - which is the whole point of a
  // reviewer's return leg, and the reason this shard has to have a strategy at
  // all rather than aborting the merge.
  //
  // Within a thread, Patter's rule, shared through the toolkit (family parity
  // item 5): messages are keyed by author and timestamp, so two replies to one
  // thread both land in time order rather than clashing, a withdrawn message
  // stays withdrawn, and the thread's own fields (anchor, mark, resolved) merge
  // one by one. Threads come back oldest first, the order `threadsFor` shows.
  notes: object({
    comments: COMMENTS,
  }),
  // The installation contract. Every key ATOMIC, which is the strategy the file's
  // ownership asks for (design/engine-server.md 4.11): the server owns it, it
  // rewrites it whole from provisioning, and interleaving one side's hand list
  // with the other's would synthesise a contract no venue was ever provisioned
  // against. A conflict here means "take the server's copy", and saying so costs
  // nothing because nobody hand-edits this file.
  contract: object({}),
  project: object({
    project: RECORD,
    settings: RECORD,
    // The game's own scopes: per scope by token, and in each its declarations
    // per name, as @story's are. `world` is the legacy block, merged until format
    // moves it.
    scopeRegistry: object({ scopes: keyedBy("token", object({ declarations: DECLS }), { order: "preserve" }) }),
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
    // The extensions the project takes: per extension, its pin merges on its own.
    extensions: { kind: "map", of: RECORD },
  }),
  // An extension's data. This is the strategy WITHOUT the manifest (every
  // node's entry as one value), what a merge falls back to when the manifest is
  // missing or unreadable; `runMerge` given the manifest merges each entry
  // field by field by the extension's types (`@wildwinter/toolkit/extensions`).
  extension: extensionDataStrategy(undefined, "storylets"),
};

/**
 * An ABSENT ancestor, as distinct from one that disagrees. `{}` is how a caller
 * says "this shard did not exist at the base", which is the ordinary case when
 * both sides ADDED the same file after the base was taken: every field of
 * theirs then reads as an add, and the merge is a two-sided one.
 *
 * Emptiness, not a missing `schema` key: a base with content but no schema is a
 * malformed shard, and still skew.
 */
const isAbsentBase = (base: Obj): boolean => Object.keys(base).length === 0;

/** 3-way merge BASE / OURS / THEIRS (parsed shard models). All three must be
 *  the same shard type and schema version; skew is a MergeInputError. An
 *  ABSENT base (`{}`) is exempt, because an absence has no version to
 *  disagree with - see `isAbsentBase`. */
export function runMerge(base: Obj, ours: Obj, theirs: Obj, opts?: { type?: MergeFileType; manifest?: Manifest }): MergeResult {
  const type = opts?.type ?? detectMergeType(ours);
  for (const [label, side] of [["BASE", base], ["THEIRS", theirs]] as const) {
    // The skew check exists to stop a v0 shard's fields being merged into a v1
    // one by pretending the two shapes match. An empty base makes no such
    // claim, and refusing it took a whole return leg down over a single file
    // that two people had happened to create independently (2026-09-06).
    // THEIRS is never exempt: that side is a real document either way.
    if (label === "BASE" && isAbsentBase(base)) continue;
    if (!eq(side.schema, ours.schema)) {
      throw new MergeInputError(`schema version skew: ${label} is ${JSON.stringify(side.schema)}, OURS is ${JSON.stringify(ours.schema)}`);
    }
  }
  if (type === "extension") {
    // Compared by content exactly, not through this format's canonical form,
    // whose id-sorting would read a reordered extension list as no change.
    const r = mergeExtensionData(base, ours, theirs, {
      host: "storylets", ...(opts?.manifest !== undefined ? { manifest: opts.manifest } : {}),
    });
    return { type, merged: r.merged, conflicts: [...r.conflicts], warnings: [...r.warnings] };
  }
  // A mark already on either side is carried until somebody resolves it; the
  // merge itself runs on the content alone.
  const r = mergeTree(MERGE_SPECS[type], withoutMark(base), withoutMark(ours), withoutMark(theirs), { equal: eq });
  return {
    type, merged: markUnresolved(r.merged as Obj, r.conflicts, { base, ours, theirs }),
    conflicts: [...r.conflicts], warnings: [...r.warnings],
  };
}

/**
 * The issues a shard carrying the `unresolved` mark raises: one error per
 * clash. Every shard type, read from the project's files as they are, so a
 * mark is refused whatever shard it is in (ruled 2026-10-18). `validate`,
 * `export` and `pack` all ask, as they ask about sidecars.
 */
export function unresolvedMarkIssues(files: readonly SourceFile[]): Issue[] {
  const issues: Issue[] = [];
  for (const file of files) {
    if (!file.text.includes("unresolved")) continue;   // the cheap test first: almost no shard has one
    let shard: unknown;
    try { shard = parseSource(file.text); } catch { continue; }   // a broken shard is the loader's to report
    for (const p of unresolvedProblems(shard)) {
      issues.push({ severity: "error", path: file.path, field: "unresolved",
        message: `unresolved merge at ${p.path}: the shard holds our side of a clash; resolve it, then remove the entry from "unresolved"` });
    }
  }
  return issues;
}

/** The sidecar filename for a merged shard (a lingering one is a validate error). */
export const CONFLICT_SIDECAR_EXTENSION = ".storyletconflict";

/** The sidecar body: everything a UI needs to render both sides. */
export function conflictSidecar(result: MergeResult): string {
  return JSON.stringify({ type: result.type, conflicts: result.conflicts, warnings: result.warnings }, null, 2) + "\n";
}

/**
 * A shard in the MERGE's own normal form: `runMerge(x, x, x)`.
 *
 * The order of an id-keyed array is never a change (the ruling of 2026-09-07,
 * which the server compares by too). The merge sorts every keyed array and
 * every open map as it folds, so a merged shard comes back ordered whether or
 * not the copy on disk was, and a comparison of canonical TEXT then reads a
 * sort as edits nobody made. Asking the merge itself is what keeps every caller
 * agreeing about what a change is: there is one normal form and it is the one
 * the merge already defines.
 *
 * A shard the merge cannot type, anything that is not one of ours, is its own
 * normal form, because there is no strategy to normalise it with.
 */
export function normalForm(shard: Record<string, unknown>): Record<string, unknown> {
  try {
    return runMerge(shard, shard, shard).merged;
  } catch {
    return shard;
  }
}

/** Do two shard texts say the same thing? Compared in the normal form above, and
 *  byte for byte when either will not parse: a shard somebody has broken by hand
 *  is still a difference. */
function sameShard(a: string, b: string): boolean {
  try {
    const normal = (text: string): string => canonicalStringify(normalForm(parseSource(text) as Obj));
    return normal(a) === normal(b);
  } catch {
    return a === b;
  }
}

/** One shard to fold in: theirs, against ours and the common ancestor. */
export interface ShardMergeInput {
  /** Project-relative path, which is what a parse failure names. */
  rel: string;
  /** Where the shard is written. */
  path: string;
  /** The shard as it stands here, or undefined when we do not have it. */
  ours: string | undefined;
  theirs: string;
  /** The ancestor, or undefined when the shard did not exist then. */
  base: string | undefined;
  /** Take theirs whole rather than merging it (a pull's contract shard). */
  replace?: boolean;
  /** What a parse failure calls the other two sides ("returned" and "sent"). */
  sides?: { theirs: string; base: string };
  /** The project's manifest for an extension, by id, so an extension shard merges
   *  field by field by its types; without one it merges each node's entry whole. */
  manifest?: (id: string) => Manifest | undefined;
}

/** What happened to one shard, and what to write for it. */
export interface ShardMergeStep {
  outcome: "added" | "merged" | "replaced";
  /** The shard's new content, or absent when it already says it. */
  write?: PlannedWrite;
  /** A `.storyletconflict` sidecar, when the merge did not resolve cleanly. */
  sidecar?: PlannedWrite;
  /** The merge itself, for a shard that was merged. */
  result?: MergeResult;
}

/**
 * Plan one shard of a returned or pulled pack: the disposition `unpack --merge`
 * and Storyletter's pull share (pack-merge-back.md section 3), in one place so
 * the two cannot drift again.
 *
 *   - present only theirs: written verbatim, as an add;
 *   - `replace`: theirs taken whole, written only when it says something else;
 *   - otherwise a 3-way whose conflicts resolve to OURS with a sidecar.
 *
 * A shard present only on our side never reaches here: a whole-file delete is
 * never propagated. A merge whose result is what the file already says WRITES
 * NOTHING: the merge emits its own normal form, so a shard stored in another
 * order comes back reordered and otherwise identical, and rewriting it would
 * be a diff, and an unpushed edit, that nobody made.
 *
 * Pure: the caller reads the texts and commits the writes.
 */
export function planShardMerge(input: ShardMergeInput): ShardMergeStep {
  const { rel, path, ours, theirs } = input;
  if (ours === undefined) return { outcome: "added", write: { path, content: theirs } };
  // An extension's manifest is the extension's, not the project's to edit, so
  // there is nothing to three-way: ours stands unless the caller takes theirs.
  if (rel.endsWith(MANIFEST_EXTENSION)) {
    return input.replace === true && ours !== theirs
      ? { outcome: "replaced", write: { path, content: theirs } }
      : { outcome: input.replace === true ? "replaced" : "merged" };
  }
  if (input.replace === true) {
    return { outcome: "replaced", ...(sameShard(ours, theirs) ? {} : { write: { path, content: theirs } }) };
  }
  const sides = input.sides ?? { theirs: "theirs", base: "base" };
  // Named parses. A shard that will not parse stops the merge, since you cannot
  // three-way what you cannot read, but it says which shard and which side.
  const read = (text: string, side: string): Obj => {
    try { return parseSource(text) as Obj; }
    catch (e) {
      throw new MergeInputError(`${rel}: the ${side} copy will not parse (${e instanceof Error ? e.message : String(e)})`);
    }
  };
  const oursObj = read(ours, "local");
  const theirsObj = read(theirs, sides.theirs);
  // No ancestor means the shard did not exist when the base was taken, so every
  // field of theirs reads as an add. `{}` is how `runMerge` is told that, and it
  // is exempt from the schema-skew check for exactly this reason.
  const baseObj = input.base !== undefined ? read(input.base, sides.base) : {};
  const extensionId = oursObj["schema"] === EXTENSION_SCHEMA && typeof oursObj["extension"] === "string"
    ? oursObj["extension"] : undefined;
  const manifest = extensionId !== undefined ? input.manifest?.(extensionId) : undefined;
  const result = runMerge(baseObj, oursObj, theirsObj, manifest !== undefined ? { manifest } : undefined);
  const content = canonicalStringify(result.merged);
  return {
    outcome: "merged", result,
    ...(content !== canonicalStringify(normalForm(oursObj)) ? { write: { path, content } } : {}),
    ...(result.conflicts.length > 0
      ? { sidecar: { path: `${path}${CONFLICT_SIDECAR_EXTENSION}`, content: conflictSidecar(result) } } : {}),
  };
}
