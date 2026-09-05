// ---------------------------------------------------------------------------
// The in-memory source project and the issue type. The compiler core is
// pure: it consumes SourceFile[] (path + text), honouring the persistence
// seam (Reboot 8.2) - the fs loader in load.ts and the future hosted shard
// store both feed this same shape.
// ---------------------------------------------------------------------------

import type { BoxShard, ContractShard, DeckShard, HandsShard, ProjectShard, PropertyDecl, ScalarValue, TagsShard, ViewShard , NotesShard } from "@storylet-studio/model";

/** One shard as text: `path` is project-relative, posix separators. */
export interface SourceFile {
  path: string;
  text: string;
}

/**
 * A one-click repair an editor can offer for a diagnostic.
 *
 * STRUCTURED, and raised where the diagnostic is raised. The alternative was to
 * re-derive the fix in the app by reading the message back, which would make
 * every wording change a silent breakage of the repair beside it.
 *
 * The CLI ignores this, and should: a fix is something a person clicks. It lives
 * on the Issue rather than in the app because this is the only place that still
 * has the context (which group, which scope) in a form nobody has to parse.
 */
export type IssueFix =
  /** A change or condition names a property nothing declares. `scope` is the
   *  owner ("story", "box", "deck"), `owner` the id of the shard that would hold
   *  the declaration. */
  | { kind: "declare-property"; scope: string; name: string; owner: string;
      /** The type read off the value being written, when it is readable.
       *  Absent means "could not tell", and the declaration falls back to
       *  the old guess of a number. */
      declType?: PropertyDecl["type"]; declDefault?: ScalarValue }
  /** A tag reference points outside its group: offer that group's real tags.
   *  `holder` is what carries the reference (a card, a hand), `group` the tag
   *  group it should be choosing from. */
  | {
      kind: "repoint-tag"; holder: string; group: string; bad: string;
      /** The group's real tags. Carried WITH the fix because this is the only
       *  place that has them to hand: an editor offering the choice would
       *  otherwise have to go and find the group again to name three strings. */
      options: { id: string; label: string }[];
    };

export interface Issue {
  /** A one-click repair, when one is canonical (storyletter.md section 4). */
  fix?: IssueFix;
  severity: "error" | "warning";
  /** Project-relative shard path the issue is anchored to. */
  path: string;
  /** The entity (id or gameId) involved, when there is one. */
  where?: string;
  /** Which FIELD of that entity the issue is about, named as the shard names it
   *  ("condition", "copies", "fields", "changes", "tags"...). Raised with the
   *  diagnostic for the same reason `fix` is: the editor has to open the page
   *  the problem is on, and reading it back out of the message is how a jump
   *  ends up one tab away from what it was pointing at. The compiler says the
   *  field; which tab holds it is the editor's business, not this one's. */
  field?: string;
  message: string;
}

export interface SourceDeck {
  path: string;
  shard: DeckShard;
}

export interface SourceBox {
  /** The box folder name. */
  path: string;
  box: BoxShard;
  tags: TagsShard;
  hands: HandsShard;
  decks: SourceDeck[];
  /** The arrangement layer, when the box has one. Optional rather than defaulted
   *  to an empty shard, unlike tags and hands: a box HAS tags and hands, possibly
   *  none, whereas the sidecar is a file that mostly does not exist yet. Modelling
   *  that honestly also means nothing which ignores arrangement (the compiler, the
   *  runtime, coverage, influence, every hand-built fixture) has to mention it. */
  view?: ViewShard;
  /** Documentation notes, when the box has any. Optional for the same reason the
   *  view sidecar is: most boxes have none, and nothing which ignores notes (the
   *  compiler, the runtime, every fixture) should have to mention them. */
  notes?: NotesShard;
}

/** One installation contract, as it sits in `contracts/`. */
export interface SourceContract {
  /** The shard's project-relative path ("contracts/the-park.storyletcontract"). */
  path: string;
  shard: ContractShard;
}

export interface SourceProject {
  /** The project shard's path (for issue anchoring). */
  path: string;
  project: ProjectShard;
  boxes: SourceBox[];
  /** The venues this project is installed at (design/engine-server.md 4.11).
   *  Empty on every project that has never met a server, which is all of them
   *  until one is built. Not compiled: `validate` and the editor read it. */
  contracts: SourceContract[];
}
