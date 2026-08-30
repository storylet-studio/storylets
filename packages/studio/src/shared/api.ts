// ---------------------------------------------------------------------------
// The typed IPC contract between main and renderer - the ONE surface the two
// sides share (Patterpad's shared/api.ts discipline). The renderer never
// touches fs, ops or Node; main never touches the DOM. DTOs are trimmed,
// display-ready projections of the source project.
// ---------------------------------------------------------------------------

import type { Bundle, PropertyType, SaveFile, ScalarValue } from "@storylet-studio/model";
import type { JobProgress } from "@wildwinter/app-shell/job";
import type { BoxKit, CoverageReport, PropertyUsage, ReplaceHit, ReplaceOptions } from "@storylet-studio/ops";
import type { IssueFix } from "@storylet-studio/compiler";
import type { TraceEvent } from "@storylet-studio/runtime";   // Live Link: the frames carry the runtime's own events

// The updater's wire shapes are the shell's; re-exported so preload, renderer and
// main all read one definition rather than three that can drift.
import type { UpdaterDownloadProgress, UpdaterPromptOptions } from "@wildwinter/app-shell/updater";
export type { UpdaterDownloadProgress, UpdaterPromptOptions };

export type { CoverageReport } from "@storylet-studio/ops";
// Find: the Property and Replace tabs carry the ops types across unchanged.
export type { PropertyUsage, ReplaceHit, ReplaceOptions } from "@storylet-studio/ops";
export type { JobProgress } from "@wildwinter/app-shell/job";

/** The long-job progress channel. Declared HERE, not imported from
 *  @wildwinter/app-shell/job, because the preload is sandboxed: a bare module
 *  specifier in that bundle cannot be resolved at runtime and the whole preload
 *  fails to load, which takes window.studio with it. api.ts is a relative
 *  import, so it bundles.
 *
 *  jobs.test.ts asserts this equals the kit's JOB_PROGRESS, so the two cannot
 *  drift apart in silence. */
export const JOB_PROGRESS_CHANNEL = "job:progress";

/** A different project is now open. Sent to every tool window that shows
 *  something about the project (the satellite registry in main/index.ts), so
 *  none of them is left describing one that has gone. Declared here for the
 *  same reason as the channel above: the preload is sandboxed. */
export const PROJECT_CHANGED = "project:changed";

/**
 * How a canvas is named when a comment marker is anchored to it.
 *
 * A deck's node canvas is named by the DECK ID, which is already unique. A box's
 * map has no id of its own, so it borrows the box's behind this prefix. Both
 * sides build the name, so it lives in the contract rather than in either of
 * them: `canvasId()` below is the only thing that should ever concatenate it.
 */
export const MAP_CANVAS = "map:";

/** The canvas name for a deck's node canvas, or a box's map. */
export const canvasId = (ref: { kind: "deck"; deck: string } | { kind: "map"; box: string }): string =>
  (ref.kind === "deck" ? ref.deck : `${MAP_CANVAS}${ref.box}`);

/** Chambray/Indigo are the blue defaults (what "system" resolves to); the
 *  green Linen/Baize pair stays as an explicit choice. */
export type ThemeChoice = "chambray" | "indigo" | "linen" | "baize" | "system";

/** A project in Open Recent: where it is, and what it calls itself.
 *
 *  The name is not derivable from the path (app-shell 0.25.0). A project is
 *  called what its own file says, so two of them can sit in folders named
 *  `draft`, and one can be renamed without moving. Optional because the path is
 *  the identity: an entry recorded before its name was known still works. */
export interface RecentProject {
  path: string;
  name?: string;
}

export interface StudioState {
  theme: ThemeChoice;
  recents: RecentProject[];
  /** Open-where-you-left-off: the last project dir, and the page inside it. */
  lastProject?: string;
  lastPlace?: LastPlace;
  /** Side-pane state (remembered, Patterpad's model): open/closed + dragged
   *  widths in px (absent = the default width). */
  panes: PaneState;
  /** Auto-rebuild: re-export the .storyletsc bundle on change so it never goes
   *  stale (Patterpad's Auto Rebuild). Off by default. */
  autoRebuild: boolean;
  /** How the centre lists its contents (cards / decks): as cards or a table.
   *  Remembered per user, shared across deck + box centres. */
  viewMode: ViewMode;
  /** The Board floats over the editor (always-on-top), Patterpad's Play
   *  pin. Default true; remembered. */
  boardPinned: boolean;
  /** The editor opens each card as the Board plays it. Default FALSE: the Board
   *  MARKS rather than navigates (graphical-views 2), and an editor that jumped
   *  under you mid-playthrough is the disruption that rule exists to avoid. An
   *  author who wants it says so, and is remembered. */
  boardFollow: boolean;
  /** The Board's List | Map choice for the OPEN project (remembered per
   *  project, keyed main-side). Defaults to "map": a project that never chose
   *  opens on its map, and the Board falls back to List when it has none. */
  boardView: "list" | "map";
  /** Which box the Board's navigator was watching, per project: a box gameId,
   *  "" for an explicitly chosen Everything, absent when never chosen (the
   *  Board's default rule decides). */
  boardBox?: string;
  /** The Find window's pin (Patterpad's search tool window). Default true. */
  searchPinned: boolean;
  /** The Coverage window's pin. Default true, like its siblings. */
  coveragePinned: boolean;
  /** The Links window's pin. Default true, like its siblings. */
  linksPinned: boolean;
  /**
   * Who is commenting: stamped on each message they post.
   *
   * In the APP's state, never the project's, which is Patterpad's rule adopted
   * whole: a name belongs to the person at the keyboard, not to the work, and a
   * project that carried one would hand it to whoever opened the file next.
   * Absent until they say (or skip).
   */
  identity?: { name: string; email?: string };
  /** Review ▸ Show Resolved Comments. Off by default: a resolved thread is done. */
  showResolved: boolean;
  /** Review ▸ Review Feedback: the walk's bar is up. A remembered MODE, as it is
   *  in Patterpad, so a reviewer who closed the app mid-pass comes back to it. */
  reviewWalk: boolean;
  /** View ▸ Coverage Overlay: the canvases wear the last run's coverage. A
   *  remembered mode, like the feedback walk. */
  coverageOverlay: boolean;
  /** Remembered helper-window bounds (Patterpad's shape); absent = default
   *  size, centred. Reset View clears them. */
  boardBounds?: WindowBounds;
  searchBounds?: WindowBounds;
  linksBounds?: WindowBounds;
  coverageBounds?: WindowBounds;
  /** Expanded nav nodes (disclosure is the user's, not the focus's). */
  navExpanded?: string[];
  /** Which spatial group's map a box was last showing, keyed by box. A box can
   *  carry several maps and the choice is the person's, not the project's; the
   *  map is a box's landing page now, so arriving at the wrong one of two is an
   *  arrival at the wrong page. An id that no longer exists falls back to the
   *  box's first spatial group, so a deleted group cannot strand the view. */
  mapGroups?: Record<string, string>;
  /** Where each canvas was looking, keyed by view ("node:<deck>",
   *  "map:<box>:<group>"). UI memory like the pane widths: reopening on the page
   *  you left (rule 13) is half the trick if the map reopens zoomed out to
   *  everything. Capped and pruned by the renderer, never merged, never a shard. */
  canvasCameras?: Record<string, { x: number; y: number; scale: number }>;
}

/**
 * The page the author had open when they last closed the app (structure rule 13).
 *
 * UI memory, like the pane widths: it belongs to the person, not to the project, so
 * it lives in the user's state and never in a shard. The DOCUMENT and its TAB, not
 * merely the deck: coming back to a box's Map or a card's Outcomes is the point.
 *
 * Deliberately loose strings rather than the renderer's Focus / Inspected unions,
 * which are renderer types: this crosses the bridge, it is read back from a file
 * that an older or newer version may have written, and everything in it is checked
 * against the project on the way in.
 */
export interface LastPlace {
  focus: { kind: string; box?: string; deck?: string };
  inspected?: {
    kind: string; box?: string; deck?: string; card?: string;
    template?: string; hand?: string; group?: string;
  };
  /** The open document's tab ("map" on a box, "outcomes" on a card). */
  tab?: string;
}

/** The centre's view of a collection. "node" is the deck's canvas: an ordinary
 *  view, not a mode - which is why it lives here beside the other two rather
 *  than in a state of its own. Only the deck offers it.
 *
 *  The MAP is not here: a box page is tabbed rather than switched (Contents /
 *  Dealing / Tags / ...), so the box's map is one of those tabs and its state is
 *  the document's tab, not this. */
export type ViewMode = "cards" | "table" | "node";

/** A helper window's remembered rectangle. */
export interface WindowBounds { x?: number; y?: number; width: number; height: number }

export interface PaneState {
  nav: boolean;
  inspector: boolean;
  navW?: number;
  inspW?: number;
}

/**
 * Which canvas a furniture call is about. A plain shape rather than the ops
 * `CanvasRef` type: this crosses the bridge, so it is structural and checked on
 * the far side like everything else here.
 */
export type CanvasRefDto = { kind: "deck"; deck: string } | { kind: "map" };

/** One frame on a canvas: a titled band behind the content. */
export interface FrameDto {
  id: string;
  x: number; y: number; w: number; h: number;
  title?: string;
  /** A furniture palette name (model's FURNITURE_COLOURS), never a hex value:
   *  the theme decides what it looks like. */
  colour?: string;
  z?: number;
}

/** A canvas's furniture, in draw order (back to front). */
export interface CanvasFurnitureDto {
  frames: FrameDto[];
}

/** One message in a thread, as the editor shows it. */
export interface CommentMessageDto { author: string; ts: string; body: string }

/** One thread about one thing. */
export interface CommentDto {
  id: string;
  anchor: string;
  resolved?: boolean;
  /** Present when this thread is drawn as a marker on a canvas. */
  mark?: { canvas: string; x: number; y: number };
  messages: CommentMessageDto[];
}

/**
 * One comment marker as a canvas draws it (design/annotation.md 3).
 *
 * `item` is the thing it follows, absent when it sits on the canvas itself, and
 * that difference is already resolved here: the renderer should never have to
 * work out which kind it has, and `x`/`y` mean different things in the two cases
 * (an offset from the item, or canvas coordinates).
 */
export interface CommentMarkerDto {
  /** The thread's id: what to open, and what to move. */
  id: string;
  x: number;
  y: number;
  item?: string;
  /** How many unresolved messages, for the marker's own badge. Zero means the
   *  thread is resolved, which is drawn quietly rather than hidden: an author
   *  looking at a canvas should see that a place was discussed. */
  open: number;
  /** The first line of the first message: the hover, so a marker can be read
   *  without opening it. */
  gist: string;
  /** Who opened the thread. On the hover beside the gist, because "who is asking"
   *  is half of what a reviewer wants from a marker before deciding to open it. */
  author: string;
}

export interface Problem {
  severity: "error" | "warning";
  path: string;
  where?: string;
  /** Which field of `where` the problem is about, as the shard names it. The
   *  problems bar uses it to open the tab the problem is actually on. */
  field?: string;
  message: string;
  /** A one-click repair (storyletter.md section 4), raised by the compiler with
   *  the diagnostic so nothing here has to read a message back to work out what
   *  went wrong. Patterpad's `problem-fix` slot, with our two canonical fixes. */
  fix?: IssueFix;
}

export type { IssueFix } from "@storylet-studio/compiler";

export interface OutcomeDto {
  id: string;
  /** The effective host-facing name (pinned, else derived from title / id). */
  gameId: string;
  /** The raw pinned gameId, absent when the gameId is derived - lets the editor
   *  show a computed name as a placeholder rather than a typed-in value. */
  gameIdPinned?: string;
  title?: string;
  /** The outcome's story beat, first-class like a card's purpose. */
  purpose?: string;
  /** Gate condition source, when the outcome is gated. */
  gate?: string;
  /** Change lines for the read view, e.g. "@story.reputation ← ... - 1". */
  changes: string[];
}

export interface CardDto {
  id: string;
  gameId: string;
  /** The raw pinned gameId, absent when the gameId is derived (see OutcomeDto). */
  gameIdPinned?: string;
  title?: string;
  /** The story beat - first-class, the card's body text. */
  purpose?: string;
  /** Condition source; absent = always eligible. */
  condition?: string;
  priority: number | string;
  redraw: string;
  /** Tags as gameIds: tag group -> tag names. */
  tags: { group: string; values: string[] }[];
  /** Copies on the board at once; blank = 1 (the default). */
  copies: string;
  /** Scarce across flows (design/shared-scarcity.md). Absent takes the deck's
   *  flag; set here it overrides the deck, which is how a single unique card
   *  stays in the content it belongs to. */
  shared?: boolean;
  /** The world cap when shared, as typed; blank = the same as copies. */
  sharedCopies: string;
  fields: { name: string; value: string }[];
  outcomes: OutcomeDto[];
}

/** An outcome in editable source form (expressions as strings). */
export interface OutcomeEdit {
  /** Stable id (a fresh one for a new outcome). */
  id: string;
  gameId: string;
  title?: string;
  purpose?: string;
  /** Gate source; blank = ungated. */
  gate?: string;
  changes: { target: string; value: string }[];
}

/** A card edit in source form: only the keys present are applied. */
export interface CardEdit {
  /** Rename the host-facing gameId (slugged). */
  gameId?: string;
  title?: string;
  purpose?: string;
  /** Condition source; blank clears it. */
  condition?: string;
  /** Priority as typed: a number literal stays numeric, else an expression. */
  priority?: string;
  /** "always" | "never" | a turn count. */
  redraw?: string;
  /** Tags as gameIds. */
  tags?: { group: string; values: string[] }[];
  /** Copies as typed; blank or "1" clears to the default. */
  copies?: string;
  /** Scarce across flows; null clears the override back to the deck's flag. */
  shared?: boolean | null;
  /** The world cap as typed; blank clears it back to copies. */
  sharedCopies?: string;
  fields?: { name: string; value: string }[];
  outcomes?: OutcomeEdit[];
}

/** A declared property for the expr-editor catalogue. */
export interface ConditionProperty {
  scope: string;
  name: string;
  type: "boolean" | "number" | "string" | "enum" | "flags" | "quality";
  enumValues?: string[];
  /** A quality's ordered ladder. Separate from `enumValues` because the ORDER
   *  carries meaning: expr-editor lists stages in it, offers the ordering
   *  operators on it, and seeds an outcome to `advance()` because of it. */
  stages?: string[];
  purpose?: string;
}

export interface DeckDto {
  id: string;
  gameId: string;
  /** The raw pinned gameId, absent when derived (see OutcomeDto). */
  gameIdPinned?: string;
  title?: string;
  purpose?: string;
  /** Deck gate source, when gated. */
  gate?: string;
  /** This pile is scarce across flows (design/shared-scarcity.md): every card
   *  in it is shared unless the card says otherwise. */
  shared?: boolean;
  /** @deck state declarations. */
  properties: PropertyDeclDto[];
  cards: CardDto[];
}

/** A deck edit: identity plus its Settings document (gate + @deck state). */
export interface DeckEdit {
  title?: string;
  gameId?: string;
  purpose?: string;
  /** Gate source; blank clears it. */
  gate?: string;
  /** Scarce across flows; false clears it (design/shared-scarcity.md). */
  shared?: boolean;
  properties?: PropertyDeclDto[];
}

export interface TemplateDto {
  id: string;
  gameId: string;
  purpose?: string;
  /** Display lines: fixed bindings ("zone = docks") and holes ("npc = ?"). */
  bindings: string[];
  slots: string;
  /** How many hands instance this template. */
  instances: number;
}

export interface TagGroupDto {
  id: string;
  gameId: string;
  values: string[];
  /** The group is a MAP: its tags carry geometry and the box offers a Map tab
   *  (the spatial template of play). */
  spatial?: boolean;
}

export interface FieldDeclDto {
  name: string;
  type: string;
  /** Display value of the declared default (raw string; coerced on save). */
  default: string;
  values?: string[];
}

/** A property declaration in editable form (default as a display string). */
export interface PropertyDeclDto {
  name: string;
  type: string;
  default: string;
  values?: string[];
  /** A quality's ordered ladder of stage names (design/quality.md). */
  stages?: string[];
  /** What this property is for: the hover tip on its pills (expr-editor's
   *  propertyTip), and a word to the next designer. */
  purpose?: string;
}

export interface BoxDto {
  id: string;
  gameId: string;
  /** The raw pinned gameId, absent when derived (see OutcomeDto). */
  gameIdPinned?: string;
  title?: string;
  purpose?: string;
  ranking: { specificity: boolean };
  /** The card template - the fields a card may set. */
  fields: FieldDeclDto[];
  properties: PropertyDeclDto[];
  decks: DeckDto[];
  templates: TemplateDto[];
  tagGroups: TagGroupDto[];
  /** `tags`: the hand's bound tags (group gameId -> tag gameId), template
   *  bindings under chosen for an instance, rule bindings for a standalone.
   *  The Where row shows a place's region from it and warns on contradictions. */
  hands: { id: string; gameId: string; title?: string; template?: string; slots?: number; tags: Record<string, string> }[];
}

export interface ProjectDto {
  /** How many OPEN comment threads each thing has, keyed by id: the reading
   *  layer's whole input, so a bubble is drawn by presence rather than by asking
   *  main about every row on screen. Resolved threads are not counted, since a
   *  badge that kept counting them would never reach zero. */
  threads: Record<string, number>;
  dir: string;
  name: string;
  /** How many @story properties exist: the Story nav row's count. */
  storyPropertyCount: number;
  boxes: BoxDto[];
}

/** One shard's version-control state, folded from simple-vc-lib `fileStatus`
 *  in main (the renderer never touches fs or the VCS). `key` names the shard
 *  the way the editor addresses it:
 *
 *    "project"        the .storyletproj shard
 *    "box:<boxId>"    that box's box.storyletbox
 *    "tags:<boxId>"   its tags.storylettags
 *    "hands:<boxId>"  its hands.storylethands
 *    "deck:<deckId>"  that deck's decks/<name>.storyletdeck
 *
 *  A row that edits several shards (a box row: its box + tags + hands) folds
 *  their states in the renderer, most actionable state winning. */
export interface ShardVcDto {
  key: string;
  /** Writable on disk right now. `false` = the read-only bit is set; under a
   *  lock VCS with no other holder that is normal, and the save checks it out. */
  writable: boolean;
  /** Who else holds it - the editor goes read-only and names them. */
  lockedBy?: string[];
  /** A newer revision is on the server (get latest before editing). */
  outOfDate?: boolean;
  /** You hold it: still yours to edit, and nothing is wrong. */
  checkedOutByMe?: boolean;
  /** Tracked, with uncommitted local changes. */
  dirty?: boolean;
  /** The VCS has never seen it. Only shards marked `primary` decide this - see
   *  `shardRefs`, and app-shell 0.26.0's note on the seam. */
  untracked?: boolean;
}

/** The project's version-control snapshot. TRIMMED: only shards with something
 *  to say are listed - an absent key is clean, writable and up to date (the
 *  common case, and most of a large project). */
export interface VcStatusDto {
  /** The backend simple-vc-lib detected ("git" / "perforce" / "filesystem"). */
  system: string;
  shards: ShardVcDto[];
}

/** A box kit: the scaffold a new box copies (RebootAmendments A10). Blank is
 *  always present; RPG is the narrated encounters starter. Owned by ops
 *  (runNewBox), so the CLI and the editor scaffold the identical box. */
export type { BoxKit };

export interface OpenResult {
  project: ProjectDto;
  problems: Problem[];
  /** Launch at an item (`storyletter <path> --at <where>`): land HERE instead
   *  of the remembered place. Main resolves the query; the renderer goes there
   *  the way it goes to a Find hit. Absent on every ordinary open. */
  at?: ReviewAt;
}

export interface BoxEdit {
  title?: string;
  gameId?: string;
  purpose?: string;
  ranking?: { specificity: boolean };
  fields?: FieldDeclDto[];
  properties?: PropertyDeclDto[];
}

/** The Find window's tabs (Patterpad's search modes, the three we need):
 *  find an item by name, replace text across items, or find where a property
 *  is read and written. */
export type SearchMode = "find" | "replace" | "property";

/** How Find is opened: on a tab, optionally with a query already typed (the
 *  Coverage window's gate links open the Property tab on a ref). */
export interface SearchOpen { mode?: SearchMode; query?: string }

/** Where a Find hit navigates (the Find window drives the editor over IPC). */
export type SearchSelection =
  | { kind: "card"; box: string; deck: string; card: string }
  | { kind: "deck"; box: string; deck: string }
  | { kind: "template"; box: string; template: string }
  | { kind: "hand"; box: string; hand: string }
  | { kind: "tagGroup"; box: string; group: string };

/**
 * Where a comment thread lives, resolved by main into somewhere the renderer can
 * GO (design/annotation.md, the Review Feedback walk).
 *
 * A superset of `SearchSelection`, because a thread can hang off two things Find
 * has no reason to know about: a BOX (a document Find does not list, since you
 * reach it from the navigator) and an OUTCOME (inside a card's Outcomes tab).
 * A marker is not a fifth kind: it is one of these plus a canvas, because a
 * marker's thread is always ALSO about the thing it is anchored to.
 */
export type ReviewAt =
  | SearchSelection
  | { kind: "box"; box: string }
  | { kind: "outcome"; box: string; deck: string; card: string; outcome: string };

/** One stop on the Review Feedback walk. */
export interface ReviewItemDto {
  /** The thread, so the walk can open its popover once it has arrived. */
  thread: string;
  /** The id the thread is anchored to: what its bubble hangs off. */
  anchor: string;
  /** Where to go to see it. */
  at: ReviewAt;
  /** The canvas this thread is DRAWN on, when it is a marker. The walk opens
   *  that canvas rather than the anchor's editor, because a marker's whole point
   *  is where it sits. */
  canvas?: string;
  /** A trail an author reads at a glance: "Village · Arrival · Arrive at the
   *  Gate". Built in main, which is the side that knows the containment. */
  where: string;
  author: string;
  /** The first message: what the bar shows. */
  text: string;
  /** Only present when Show Resolved pulled it into the walk, so the bar can
   *  mark it (Patterpad's rule). */
  resolved?: boolean;
}

/** A binding in editable form: a fixed tag gameId, a hole ("the instance
 *  chooses"), or unbound. */
export interface BindingDto { group: string; value?: string; hole?: boolean; }

export interface TemplateDetail {
  id: string;
  gameId: string;
  purpose?: string;
  /** One row per tag group: fixed tag, hole, or unbound. */
  bindings: BindingDto[];
  /** Shared availability condition, evaluated per instance. */
  condition?: string;
  slots: string;
  /** Declared @hand state every instance carries. */
  properties: PropertyDeclDto[];
  /** The box's tag groups (gameId + tag gameIds) for the binding picker. */
  groups: { gameId: string; values: string[] }[];
  /** Hands instancing this template (for the derived footer). */
  instances: string[];
}
export interface TemplateEdit {
  gameId?: string;
  purpose?: string;
  /** Shared condition source; blank clears it. */
  condition?: string;
  bindings?: BindingDto[];
  slots?: string;
  properties?: PropertyDeclDto[];
}

/** Project-level settings (the .storyletproj shard), edited in the settings
 *  dialog and written whole on save. */
export interface ProjectSettingsDto {
  name: string;
  /** NOTE: the project's opaque `id` is deliberately NOT here. It binds saves
   *  to a bundle (SaveEnvelope.content.project) and must stay stable, so it is
   *  generated at init and never author-edited (Patterpad shows no such field). */
  version: string;
  world: PropertyDeclDto[];
  story: PropertyDeclDto[];
  /** The coverage drivers, edited beside the @world declarations they feed
   *  (Patterpad's World Properties tab). Stored in the shard as a map keyed by
   *  ref; carried here as an ordered list so the editor can reorder and hold
   *  a half-typed row. */
  drivers: CoverageDriverDto[];
  bundlePath: string;
  metadata: "full" | "stripped";
  /** Does the bundle carry the maps (zone shapes and background pictures)? */
  exportMap: boolean;
  playAdvancesTurns: number;
  /** Also warn when state is written but nothing reads it (off by default:
   *  cards are routinely written ahead of the content that will read them). */
  warnUnreadWrites: boolean;
}

/** One coverage driver in editable form. `ref` is the whole "@world.name"
 *  (the editor shows "@world." as fixed chrome and edits the tail). */
export interface CoverageDriverDto {
  ref: string;
  kind: "initial" | "recurring";
  /** Recurring only: the per-turn re-roll chance. */
  cadence?: "rarely" | "sometimes" | "often";
  values: ScalarValue[];
}

/** A card as the Links window draws it. Named rather than inlined twice, and it
 *  carries the deck's TITLE as well as its id: the canvas draws titles, never
 *  gameIds or internal ids (design/graphical-views.md section 3). */
export interface LinkCard {
  id: string;
  gameId: string;
  title?: string;
  /** The deck's internal id, for revealing it in the editor. */
  deck: string;
  /** The deck's display title, for the card's face. */
  deckTitle: string;
  box: string;
}

/** One neighbour in the Links window: the card, and the edge that reaches it. */
/** One reason a link exists, in FIELDS rather than as a sentence. The Links
 *  window phrases and typesets it (property in the mono voice, the words around
 *  it quiet), which a pre-joined string cannot do: "@story.world_events
 *  (tree_bloomed) by touch-the-bark" is every fact and no grammar, and a reader
 *  cannot tell which part is the property, which the flag and which the outcome.
 *  The CLI keeps the one-line form (ops `describeContribution`). */
export interface LinkReason {
  /** Canonical `@scope.name`. */
  property: string;
  /** The flag within a flags property, when the match is flag-level. */
  flag?: string;
  /** The gameId of the outcome that writes it. Load-bearing: one card's outcomes
   *  can push a property both ways, so naming the outcome is what turns an
   *  apparent contradiction into "enabled if you fight, disabled if you flee". */
  outcome?: string;
  /** A caveat on this reason: "through the deck gate", "computed value". */
  note?: string;
}

/** How deep the live run's journal goes, on BOTH sides of the link.
 *
 *  Main keeps this many trace frames so a Board opened after the game started
 *  reads the same depth of story; the Board's own journal keeps the same. Both
 *  said 200 in their own file until 2026-08-29, and main's comment said the two
 *  "must agree" while nothing made them - which is what a shared constant is
 *  for, and why it belongs here in the contract rather than in either half. */
export const LIVE_LOG_CAP = 200;

export interface LinkNeighbour {
  card: LinkCard | undefined;
  cls: "enable" | "disable" | "influence" | "reference";
  /** Why this link exists: one entry per contributing property. Never empty. */
  via: LinkReason[];
  /** What a coverage run SAW, when one has been run (design/graphical-views.md
   *  4). Absent means either no run, or a run that never saw this happen - the
   *  two are told apart by `LinksView.evidence`, which is absent only in the
   *  first case. Static analysis says what COULD; this says what DID. */
  observed?: { runs: number; count: number };
  /** Observed but NOT statically predicted: the analyser missed something, and
   *  two independent derivations disagreeing is a bug detector for both. Such a
   *  neighbour has an empty `via`, because there is no static reason to give. */
  flagged?: true;
}

/** One edge on a canvas, in the Links window's four classes. Class and direction
 *  only: a drawn edge is a line and an arrowhead, and WHY it exists is the Links
 *  window's question, answered there from `LinkNeighbour.via`. It carried a
 *  display-ready `why` for a while that no canvas ever read. */
export interface GraphEdge {
  from: string;
  to: string;
  cls: LinkNeighbour["cls"];
  /** What a coverage run had to say about this edge, when one has been run
   *  (design/graphical-views.md 4). Absent = no run, and every edge is drawn as
   *  it always was: static edges ARE the feature, evidence only sharpens them.
   *  `observed` a run saw it, `possible` derived but never seen, `flagged` seen
   *  but never derived. */
  evidence?: "observed" | "possible" | "flagged";
}

/** A deck's links: the half of the node view that has to be computed. The CARDS
 *  come from the DeckDto the centre is already rendering (titles, gameIds and
 *  their order), so they are not repeated here: one truth for a card's face. */
export interface DeckGraph {
  hasProject: boolean;
  /** Where the author has put cards on this canvas, keyed by card id. Sparse: a
   *  card with no entry has never been placed and lays out by default. */
  positions: Record<string, { x: number; y: number }>;
  /** Edges with BOTH ends in this deck. */
  edges: GraphEdge[];
  /** How many links these cards have to cards outside this deck. A deck can
   *  legitimately have no internal edges while being well connected elsewhere,
   *  and a canvas that just looks empty would read as broken. */
  outsideLinks: number;
  /** What the author has drawn around the cards. */
  furniture: CanvasFurnitureDto;
  /** Analysis caveats worth showing (notably @hand). */
  notes: string[];
}

/** One zone on a box's map: a tag of a spatial group that has been traced. */
/** A background image behind a map, ready to draw: the URL to load, where it
 *  sits, and how it behaves. Sent in DRAW order (back to front). */
export interface MapBackgroundDto {
  id: string;
  /** The file's name, for the interface to show and for a menu to name. */
  file: string;
  /** Where the renderer loads it from (see `assetUrl`). */
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  hidden?: boolean;
  locked?: boolean;
  /** True when the file is not where the shard says: drawn as a placeholder, and
   *  reported by validation as a warning. */
  missing?: boolean;
}

export interface MapZoneDto {
  id: string;
  /** Tags are declared names, so this is both the label and the identity colour. */
  gameId: string;
  polygon: { x: number; y: number }[];
  /** Where it sits in the stack, when it has been moved. The list arrives in
   *  DRAW order (back to front) so a view can paint it as it comes; this is here
   *  for a view that has to say what a move would do. */
  z?: number;
}

/**
 * A hand whose zone changed as a side effect of an edit on the map: a pin
 * dropped, an outline dragged, a zone drawn or cleared.
 *
 * `zone` null means the hand now sits in NO zone. That is not a quiet state: a
 * hand that needs a zone and has none is an error, and the Problems bar will be
 * naming it by the time the author looks up.
 */
export interface SiteRebinding {
  id: string;
  zone: string | null;
}

/**
 * The scheme a box's background images are served over.
 *
 * A URL is `storylet-asset://<boxId>/<file>`. Main resolves it against the OPEN
 * project and refuses anything else, so this is a window onto one box's own
 * pictures rather than onto the disk. Streamed by Chromium rather than sent over
 * IPC because a site plan is measured in megabytes.
 */
export const ASSET_SCHEME = "storylet-asset";

/** The URL for one of a box's assets. */
export const assetUrl = (boxId: string, file: string): string =>
  `${ASSET_SCHEME}://${encodeURIComponent(boxId)}/${encodeURIComponent(file)}`;

/** One map in the project: a box, and one of its spatial tag groups.
 *
 *  The Board needs this and cannot work it out for itself: it holds a compiled
 *  bundle, and a group's spatial marker is source-only (Reboot 6, geometry never
 *  compiles), so nothing in the bundle says which group is a map. */
export interface ProjectMapDto {
  box: string;
  boxGameId: string;
  group: string;
  groupGameId: string;
  /** Maps stamped with the same space number are ONE PLACE carried by several
   *  boxes (ops sharedSpaces: identical group and geometry). The Board draws
   *  a space once, on Everything, with every member box's hands pinned. */
  space?: number;
}

/** A hand pinned on the map. */
export interface MapSiteDto {
  /** The hand's id: what the pin is keyed by in the sidecar. */
  id: string;
  gameId: string;
  x: number;
  y: number;
  /** The zone this hand is BOUND to, from the hand itself rather than from the
   *  ground under the pin: its `chosen` hole, or a standalone hand's own rule
   *  binding, or the fixed binding its template gives every instance. Absent when
   *  the hand has no route to this group, or has one and has not filled it. */
  zone?: string;
  /** Can dragging this pin rebind the hand? False in two different ways, and the
   *  wording has to tell them apart: a hand whose template BINDS this group for
   *  every instance (moving one would move them all), and a hand with no
   *  relationship to the group at all, whose pin is a note about where it sits. */
  rebinds: boolean;
  /** The template binds this group for every instance of it: the reason. */
  fixedBy?: string;
}

/** A box's map: everything the Map view draws, for ONE spatial group.
 *
 *  The zones come from the group's tags and the sites from the view sidecar, which
 *  is the whole design in one sentence: the map is the tag data you already have,
 *  seen from above, plus where things sit. */
export interface BoxMapDto {
  hasProject: boolean;
  /** Every spatial group in the box, so the view can offer the others. Empty means
   *  this box has no map and the view should not have been reachable. */
  groups: { id: string; gameId: string }[];
  /** The group being shown. */
  groupId?: string;
  zones: MapZoneDto[];
  /** Tags of this group with no outline yet: what "place a zone" can offer. */
  undrawn: { id: string; gameId: string }[];
  /** The pictures behind this map, in draw order. */
  backgrounds: MapBackgroundDto[];
  sites: MapSiteDto[];
  /** Hands with no pin yet: what "place a hand" can offer. */
  unplaced: { id: string; gameId: string }[];
  /** What the author has drawn around all this. */
  furniture: CanvasFurnitureDto;
}

/** The Links window's whole state for one card. */
export interface LinksView {
  hasProject: boolean;
  /** The card at the centre, or undefined when nothing suitable is selected. */
  card: LinkCard | undefined;
  /** Cards whose outcomes can affect this one. */
  predecessors: LinkNeighbour[];
  /** Cards this one can affect. */
  dependents: LinkNeighbour[];
  /** The coverage run these observations come from. Absent = no run this
   *  session, which is when the view offers "run a fresh coverage test for more
   *  info" rather than quietly showing every edge as unobserved. The view works
   *  in full without it: static edges are the feature (the 2026-08-03 ruling). */
  evidence?: { runs: number; at: string };
  /** Analysis caveats worth showing (notably @hand). */
  notes: string[];
  pinned: boolean;
}

/** What a merge-back reports: enough for a toast and a problems-style list. */
export interface PackMergeSummary {
  /** One line per shard, already display-ready. */
  shards: { path: string; added: boolean; conflicts: number }[];
  conflicts: number;
  warnings: number;
  /** Pictures the pack brought that we do not have, and ones we kept our own of. */
  assets: number;
  keptAssets: number;
  /**
   * The project ids disagree: shown as the HEADLINE of the confirmation, with
   * Cancel as the default button.
   *
   * A warning and never a refusal. An id can legitimately differ (a fork, an id
   * reissued after a template copy), and a check with no way through is a wall
   * rather than a guard - see `ProvenanceCheck` in ops for the whole argument.
   */
  provenance?: string;
}

/** What the Coverage window needs to open: the project it is looking at, how
 *  many drivers are configured (the note above the results), the pin, and any
 *  report cached from earlier this session. */
export interface CoverageInfo {
  hasProject: boolean;
  name: string;
  driverCount: number;
  pinned: boolean;
  last?: CoverageReport;
}

/**
 * The last coverage run, projected down to what a CANVAS needs.
 *
 * A slim shape rather than the whole `CoverageReport`, because the overlay asks
 * two questions per item ("was it dealt", "was it played") and shipping the
 * issues, the driver list and the per-outcome table to redraw a card face would
 * be sending a document to answer a yes or no.
 */
export interface CoverageOverlayDto {
  /** When the run finished, so the canvas can say how old its evidence is. An
   *  overlay that cannot be dated invites being read as live. */
  at: string;
  runs: number;
  /** Per card: how many times it was dealt, and how many times an outcome of it
   *  was played. Keyed by card id. Absent from the map = not in the run at all. */
  cards: Record<string, { dealt: number; played: number }>;
  /** Per hand: total deals across the run, keyed by hand id. */
  hands: Record<string, number>;
  /** The busiest hand's deal count, so heat is relative to this project rather
   *  than to a number picked out of the air. Zero when nothing was dealt. */
  busiest: number;
}

/** A hand: a place on the board, owning what it is dealt (Reboot 2.4, the
 *  successor of sites). An instance of a hand template (chosen tags fill its
 *  holes) or standalone with its own inline rule. */
export interface HandDetail {
  id: string;
  gameId: string;
  gameIdPinned?: string;
  title?: string;
  purpose?: string;
  /** The template this hand instances, as a gameId; absent = standalone. */
  template?: string;
  /** One row per hole of the chosen template (value as a tag gameId). */
  chosen: { group: string; value: string; values: string[] }[];
  /** Standalone hands: the inline rule. */
  rule?: { bindings: BindingDto[]; condition?: string; slots: string };
  /** Slot override as typed; blank follows the template's / rule's slots. */
  slots: string;
  /** This hand's own state (standalone; instances inherit the template's). */
  properties: PropertyDeclDto[];
  /** The box's templates, for the picker. */
  templates: { gameId: string; chooses: string[]; slots: string }[];
  /** The box's tag groups (for chosen pickers and rule bindings). */
  groups: { gameId: string; values: string[] }[];
}

export interface HandEdit {
  gameId?: string;
  title?: string;
  purpose?: string;
  /** Template gameId; "" converts the hand to standalone (an empty rule). */
  template?: string;
  /** Hole fills: group gameId -> tag gameId. */
  chosen?: { group: string; value: string }[];
  rule?: { bindings?: BindingDto[]; condition?: string; slots?: string };
  slots?: string;
  properties?: PropertyDeclDto[];
}

export interface ValueDetail {
  id?: string; gameId: string; properties: PropertyDeclDto[];
  /** This tag's own starting values for the properties its GROUP declares,
   *  keyed by name, in the same string form `PropertyDeclDto.default` uses.
   *  Absent or blank means "start where the group says". */
  values?: Record<string, string>;
}
export interface TagGroupDetail {
  id: string; gameId: string; purpose?: string;
  /** Declared once here, held by every tag in the group. */
  properties: PropertyDeclDto[];
  values: ValueDetail[];
}
export interface TagGroupEdit {
  gameId?: string; purpose?: string; properties?: PropertyDeclDto[]; values?: ValueDetail[];
}

// --- Live Link (design/live-link.md) -------------------------------------------
/** The editor-side server's state, Patterpad's DebugStatus shape: grey off,
 *  amber listening, green connected and in sync, red connected on a different
 *  build. `boxes` is what the game's hello named, for the tooltip. */
export type LiveLinkStatus =
  | { state: "off" }
  | { state: "error"; message: string }
  | { state: "listening"; port: number }
  | { state: "connected"; port: number; project?: string; build: "match" | "stale" | "unknown"; boxes: string[];
      /** Every flow the game has open, in the order it reported them. A
       *  single-player game sends one and nothing about the UI changes; with
       *  several, the Board follows one and offers the rest
       *  (design/live-link.md, Patterpad's debug-link shape). */
      flows: string[];
      /** The flow the Board is currently following. */
      following: string | null };

/** The game's cheap snapshot: hand gameId -> card gameIds in dealt order, box
 *  gameId -> clock. */
export interface LiveLinkBoard { hands: Record<string, string[]>; turns: Record<string, number> }
/** One runtime trace event, verbatim, as the game's flow emitted it, with the
 *  flow it came from. */
export interface LiveLinkTrace { t: "trace"; flow: string; event: TraceEvent }
/** What main forwards to the Board window over `liveLink:frame`: a hello (a run
 *  begins, or a refresh landed: clear and start reading from here), a board
 *  snapshot, or one trace event. */
export type LiveLinkFrame =
  | { t: "hello"; project?: string; build: "match" | "stale" | "unknown" }
  | ({ t: "board"; flow: string } & LiveLinkBoard)
  | LiveLinkTrace;
/** What a Board opening mid-run asks for: the state, the last snapshot (if a
 *  game has sent one) and the recent trace, so it has the table at once. */
export interface LiveLinkSnapshot {
  status: LiveLinkStatus;
  /** The last board each flow sent, keyed by flow id. Kept PER FLOW so that
   *  following a different participant shows their table at once rather than
   *  waiting for them to move - Patterpad's `lastFrame` per flow, same reason. */
  boards: Record<string, LiveLinkBoard>;
  trace: LiveLinkTrace[];
}

export type MenuCommand =
  | { cmd: "open" }
  | { cmd: "open-recent"; path: string }
  | { cmd: "search" }
  // Find's other tabs: Edit > Replace… and Review > Find Property Usage…
  | { cmd: "replace" }
  | { cmd: "search-property" }
  | { cmd: "undo" }
  | { cmd: "redo" }
  | { cmd: "table" }
  | { cmd: "new-project" }
  | { cmd: "new-card" }
  | { cmd: "save" }
  | { cmd: "go-up" }
  | { cmd: "project-overview" }
  | { cmd: "coverage" }
  | { cmd: "coverage-overlay"; on: boolean }
  | { cmd: "links" }
  | { cmd: "export" }
  | { cmd: "export-xlsx" }   // Publish Spreadsheet: the readable workbook
  | { cmd: "export-html" }   // Publish Playable HTML: the one-file playable page
  | { cmd: "duplicate" }
  | { cmd: "toggle-nav" }
  | { cmd: "reset-view" }
  | { cmd: "toggle-auto-rebuild" }
  | { cmd: "project-settings"; section?: string }
  | { cmd: "identity" }
  | { cmd: "about"; version: string }
  | { cmd: "show-resolved"; on: boolean }
  | { cmd: "review-walk"; on: boolean }
  | { cmd: "review-next" }
  | { cmd: "review-prev" }
  | { cmd: "open-pack" }
  | { cmd: "export-pack" }
  | { cmd: "merge-pack" }
  | { cmd: "live-link" }   // Play > Live Link: toggle the server (the bottom-right chip mirrors it)
  | { cmd: "theme"; theme: ThemeChoice }
  | { cmd: "nav-back" }
  | { cmd: "nav-forward" }
  | { cmd: "close-project" };

/** The surface the preload bridge exposes as `window.studio`. */
export interface StudioApi {
  getState(): Promise<StudioState>;
  /** Open via the system dialog; null = cancelled. */
  openProjectDialog(): Promise<OpenResult | { error: string } | null>;
  openProjectPath(path: string): Promise<OpenResult | { error: string }>;
  /** Show the open project's folder in Finder / the file manager. */
  revealProject(): void;
  /** Close the open project and return to the welcome screen. */
  closeProject(): Promise<void>;
  /** Scaffold a new project (runInit) under a chosen parent dir; null = cancelled. */
  createProject(name: string): Promise<OpenResult | { error: string } | null>;
  /** Copy a shipped worked example somewhere the author owns, and open it. Null
   *  when they cancel the folder picker. */
  openExample(name: string): Promise<OpenResult | { error: string } | null>;
  /** Re-read the project from disk and re-validate (files are the truth:
   *  hand edits and VCS updates surface here). Null when nothing is open. */
  revalidate(): Promise<OpenResult | null>;
  /** The per-shard version-control snapshot behind the lock / read-only /
   *  out-of-date badges. Throttled and cached in main (a remote read is a
   *  server hit under SVN and Plastic), so this is cheap to call on load,
   *  revalidate, focus and a poll. Null when nothing is open. */
  vcStatus(): Promise<VcStatusDto | null>;
  setTheme(theme: ThemeChoice): Promise<void>;
  /** The theme changed anywhere in the app. Every window listens: a tool window
   *  that only read the theme at boot sat in the old palette beside a re-themed
   *  editor, which reads as a broken window rather than as a preference. */
  onTheme(handler: (theme: ThemeChoice) => void): void;
  /** A helper window's pin was set from OUTSIDE the window: Reset View re-pins
   *  them all in main, and the pin button has to show a state it did not choose
   *  (app-shell 0.23.0). Without this the button read "unpinned" over a window
   *  that was floating, and the two disagreed until the window was reopened. */
  onWindowPinned(handler: (pinned: boolean) => void): void;
  /** Remember the page for next launch. Cheap and frequent: main writes only when
   *  it changes. */
  setLastPlace(place: LastPlace): Promise<void>;
  setPanes(panes: PaneState): Promise<void>;
  setAutoRebuild(on: boolean): Promise<void>;
  setViewMode(mode: ViewMode): Promise<void>;
  setNavExpanded(ids: string[]): Promise<void>;
  /** The whole camera map, written through on a debounce (canvas-memory.ts). */
  setCanvasCameras(cameras: Record<string, { x: number; y: number; scale: number }>): Promise<void>;
  /** Which map each box is showing. Written on the pick, which is rare. */
  setMapGroups(groups: Record<string, string>): Promise<void>;
  /** The current project settings (name / gameId / version / world + story
   *  properties / export). Null when nothing is open. */
  projectSettings(): Promise<ProjectSettingsDto | null>;
  saveProjectSettings(dto: ProjectSettingsDto): Promise<OpenResult | { error: string }>;
  /** Add a new box (folder + shards) to the project, scaffolded from a kit. */
  createBox(kit: BoxKit): Promise<{ result: OpenResult; boxId: string } | { error: string }>;
  /** Clone a whole box: fresh ids throughout, cross-references remapped. */
  duplicateBox(boxId: string): Promise<{ result: OpenResult; boxId: string } | { error: string }>;
  /** Delete a whole box (every shard in its folder); undoable. */
  deleteBox(boxId: string): Promise<OpenResult | { error: string }>;
  /** Reorder: sparse `order`, the cards mechanism generalised. */
  moveBox(boxId: string, targetId: string, before: boolean): Promise<OpenResult | { error: string }>;
  moveDeck(deckId: string, targetId: string, before: boolean): Promise<OpenResult | { error: string }>;
  moveHand(boxId: string, handId: string, targetId: string, before: boolean): Promise<OpenResult | { error: string }>;

  // --- box / template / tag-group editing (M1b Phase 3) ---------------------
  saveBox(boxId: string, edit: BoxEdit): Promise<OpenResult | { error: string }>;
  templateDetail(boxId: string, templateId: string): Promise<TemplateDetail | null>;
  saveTemplate(boxId: string, templateId: string, edit: TemplateEdit): Promise<OpenResult | { error: string }>;
  createTemplate(boxId: string): Promise<{ result: OpenResult; templateId: string } | { error: string }>;
  deleteTemplate(boxId: string, templateId: string): Promise<OpenResult | { error: string }>;
  duplicateDeck(deckId: string): Promise<{ result: OpenResult; deckId: string } | { error: string }>;
  duplicateTemplate(boxId: string, templateId: string): Promise<{ result: OpenResult; templateId: string } | { error: string }>;
  duplicateHand(boxId: string, handId: string): Promise<{ result: OpenResult; handId: string } | { error: string }>;
  duplicateTagGroup(boxId: string, groupId: string): Promise<{ result: OpenResult; groupId: string } | { error: string }>;
  handDetail(boxId: string, handId: string): Promise<HandDetail | null>;
  saveHand(boxId: string, handId: string, edit: HandEdit): Promise<OpenResult | { error: string }>;
  createHand(boxId: string): Promise<{ result: OpenResult; handId: string } | { error: string }>;
  deleteHand(boxId: string, handId: string): Promise<OpenResult | { error: string }>;
  tagGroupDetail(boxId: string, groupId: string): Promise<TagGroupDetail | null>;
  saveTagGroup(boxId: string, groupId: string, edit: TagGroupEdit): Promise<OpenResult | { error: string }>;
  createTagGroup(boxId: string): Promise<{ result: OpenResult; groupId: string } | { error: string }>;
  deleteTagGroup(boxId: string, groupId: string): Promise<OpenResult | { error: string }>;

  // --- editing (M1) ----------------------------------------------------------
  /** Apply a card edit, write canonically, re-validate. */
  saveCard(deckId: string, cardId: string, edit: CardEdit): Promise<OpenResult | { error: string }>;
  /** Add a new card to a deck; the result carries the new card's id. */
  createCard(deckId: string): Promise<{ result: OpenResult; cardId: string } | { error: string }>;
  /** Clone a card (fresh id, deduped gameId), inserted after the original. */
  duplicateCard(deckId: string, cardId: string): Promise<{ result: OpenResult; cardId: string } | { error: string }>;
  deleteCard(deckId: string, cardId: string): Promise<OpenResult | { error: string }>;
  /** Reorder: move a card before/after a target card in its deck. */
  moveCard(deckId: string, cardId: string, targetId: string, before: boolean): Promise<OpenResult | { error: string }>;
  /** The expr-editor property catalogue reachable from a card in this deck. */
  cardCatalogue(deckId: string): Promise<ConditionProperty[]>;
  /** The box-scoped catalogue (no @deck): query conditions edit against this. */
  boxCatalogue(boxId: string): Promise<ConditionProperty[]>;

  /** Add a new deck (a new shard) to a box; the result carries its id. */
  createDeck(boxId: string): Promise<{ result: OpenResult; deckId: string } | { error: string }>;
  /** Remove an EMPTY deck's shard file. */
  deleteDeck(deckId: string): Promise<OpenResult | { error: string }>;
  /** Rename a deck (title and/or gameId; the file moves with the gameId). */
  renameDeck(deckId: string, edit: DeckEdit): Promise<OpenResult | { error: string }>;

  /** Undo / redo the last committed change (file-state based). Null = nothing to do. */
  undo(): Promise<OpenResult | null>;
  redo(): Promise<OpenResult | null>;

  // --- the Board (M2) --------------------------------------------------------
  /** Open the live-session window. */
  openTable(): Promise<void>;
  /** Site the Board over the editor (always-on-top; remembered). */
  setBoardPinned(on: boolean): Promise<void>;
  setBoardFollow(on: boolean): Promise<void>;
  setBoardView(view: "list" | "map"): Promise<void>;
  setBoardBox(box: string): Promise<void>;

  // --- the Find window (Patterpad's detached search tool) --------------------
  /** Open (or focus) the Find window, on a tab and with a query when asked. */
  openSearch(open?: SearchOpen): Promise<void>;
  /** The tab and query Find was opened with and has not yet consumed (the
   *  Coverage window's gate links open the Property tab on a ref). Undefined =
   *  opened plain. */
  pendingSearchQuery(): Promise<SearchOpen | undefined>;
  /** Find window only: another surface wants it on this tab, with this query. */
  onSearchSeed(handler: (open: SearchOpen) => void): void;
  setSearchPinned(on: boolean): Promise<void>;
  /** Find window only: navigate the editor to a hit. A `ReviewAt` rather than a
   *  `SearchSelection` because a Property hit can be an outcome. */
  searchReveal(selection: ReviewAt): Promise<void>;
  closeSearch(): Promise<void>;
  // Find's Property tab: every read and write of a property (ops runPropertyUsage).
  propertyUsage(query: string): Promise<PropertyUsage[]>;
  /** Several at once, answered positionally, compiling the project once. Use
   *  this wherever a screen needs counts for a whole list of properties. */
  propertyUsageMany(queries: string[]): Promise<PropertyUsage[][]>;
  // Find's Replace tab (ops runReplace). Preview is read-only; apply writes
  // through the mutation path as ONE undo step, after the editor has flushed.
  replacePreview(opts: ReplaceOptions): Promise<{ hits: ReplaceHit[]; items: number }>;
  replaceApply(opts: ReplaceOptions): Promise<{ count: number; items: number } | { error: string }>;
  /** Editor window only: main wants pending edits on disk before a project-wide
   *  write; answer with `editorFlushed` when they are. */
  onEditorFlush(handler: () => void): void;
  editorFlushed(): Promise<void>;
  /** Editor window only: a Replace was applied from the Find window; re-read. */
  onReplaceApplied(handler: (count: number) => void): void;
  /** Editor window only: a Find hit wants the editor to navigate. */
  /** Widened to `ReviewAt` for the `--at` launch jump, which can name a box or
   *  an outcome; Find itself only ever sends a `SearchSelection`. */
  onSearchNavigate(handler: (selection: ReviewAt) => void): void;
  /** Reset View's window half: Board + Find back to default size, centred,
   *  re-pinned; remembered bounds cleared (Patterpad's rescue). */
  resetWindows(): Promise<void>;
  /** Compile the (freshly re-read) project to a bundle for the Board. */
  tableBundle(): Promise<{ bundle: Bundle; name: string } | { error: string }>;
  /** The current source content hash (compare to a running bundle's
   *  content.hash to tell if the Board is out of date). Null if it won't load. */
  projectHash(): Promise<string | null>;
  /** Write a session save to a .storyletsave file (native save dialog - file
   *  pickers are the one legitimately native seam). Null = cancelled. */
  exportSave(file: SaveFile, suggestedName: string): Promise<{ path: string } | { error: string } | null>;
  /** Read a session save from a .storyletsave file (native open dialog);
   *  the name is the file's basename, ready to label a snapshot. Null = cancelled. */
  importSave(): Promise<{ file: SaveFile; name: string } | { error: string } | null>;

  // --- coverage + export (M2b) ----------------------------------------------
  /** The last run, projected for the canvas overlays. Undefined when no run has
   *  happened this session: the overlay then says so rather than drawing a map
   *  of zeroes, which would read as "nothing is covered". */
  coverageOverlay(): Promise<CoverageOverlayDto | undefined>;
  /** The problems bar's quick-fixes. Ordinary undoable mutations that return the
   *  fresh project, so the bar re-validates like any other edit. */
  /** `guess` is the type read off the value being written, where the compiler
   *  could read it; without it the declaration falls back to a number. */
  declareProperty(scope: string, name: string, owner: string, guess?: { type: PropertyType; default: ScalarValue }): Promise<OpenResult | { error: string }>;
  repointTag(holder: string, group: string, from: string, to: string): Promise<OpenResult | { error: string }>;
  /** A sweep finished anywhere (it is run from the Coverage window): the editor
   *  re-reads the overlay so it is never showing the run before last. Returns
   *  its own unsubscribe. */
  onCoverageDone(handler: () => void): () => void;
  /** Remember View ▸ Coverage Overlay. */
  setCoverageOverlay(on: boolean): Promise<void>;
  /** Open the coverage window. */
  openCoverage(): Promise<void>;
  /** The Coverage window's boot state (project, driver count, pin, cached report). */
  coverageInfo(): Promise<CoverageInfo>;
  /** Run seeded coverage over the freshly re-read project, as a cancellable
   *  job: progress arrives on onJobProgress. The result is cached in main, so
   *  reopening the window shows it again. `cancelled` marks a partial report -
   *  its `runs` is what it actually managed. */
  coverageRun(opts: { runs?: number; maxTurns?: number; seed?: number }): Promise<{ report: CoverageReport; name: string; cancelled?: boolean } | { error: string }>;
  /** Stop the running sweep. It stops between runs and keeps what it has. */
  coverageCancel(): Promise<void>;
  /** Propose coverage drivers from the conditions and add them to the project
   *  shard (undoable); returns the fresh project + a re-run report. */
  coverageAddDrivers(opts: { runs?: number; maxTurns?: number; seed?: number }): Promise<{ report: CoverageReport; added: string[]; cancelled?: boolean } | { error: string }>;
  /** Progress from a long job in main (the shared shell's kit). */
  onJobProgress(handler: (progress: JobProgress) => void): void;
  /** Propose drivers from the conditions WITHOUT writing: the settings
   *  dialog's "Propose from story", which saves with the rest of the dialog. */
  proposeDrivers(): Promise<CoverageDriverDto[]>;
  // --- the Links lens (#57) --------------------------------------------------
  /** Open the Links window. */
  /** Open the Links lens, or bring it forward if it is already open. With a card,
   *  point it at that card: the card context menus do this, so the lens can be
   *  asked about a card without first making it the editor's selection. */
  openLinks(cardId?: string): Promise<void>;
  /** The neighbourhood of a card, or of whatever the editor has selected when
   *  `cardId` is omitted. */
  linksFor(cardId?: string): Promise<LinksView>;
  /** One deck as a graph, for the node view. */
  deckGraph(deckId: string): Promise<DeckGraph>;
  /** A box's map: the zones of one spatial group, plus the hand sites. Omit the
   *  group to get the box's first one. */
  boxMap(boxId: string, groupId?: string): Promise<BoxMapDto>;
  /** Every spatial group in the project, for a surface that has to offer a
   *  choice of maps (the Board). Empty when nothing is mapped. */
  projectMaps(): Promise<ProjectMapDto[]>;
  /** Mark a tag group spatial, or stop. Geometry already traced is left alone. */
  setGroupSpatial(boxId: string, groupId: string, on: boolean): Promise<OpenResult | { error: string }>;
  /** A traced outline for a zone that does not exist yet: declares the tag and
   *  gives it the shape in one undo step. */
  createZone(
    boxId: string, groupId: string, polygon: { x: number; y: number }[],
  ): Promise<{ result: OpenResult; tagId: string; rebound: SiteRebinding[] } | { error: string }>;
  /** Set or clear a zone's outline: one undo step per shape. */
  /** Import a picture behind a map: opens a picker, copies the file into the
   *  box's assets folder, and places it by the drop rule. Null when the author
   *  cancelled. `place` is the CAMERA at the moment of the ask, so the picture
   *  arrives at a size comfortable to grab at whatever zoom is showing. */
  addBackground(
    boxId: string, groupId: string,
    place: { view: { width: number; height: number }; scale: number; at: { x: number; y: number } },
  ): Promise<{ result: OpenResult; file: string } | { error: string } | null>;
  /** Change one background: move, scale, fade, hide, lock. `coalesce` joins a
   *  continuous gesture (a drag, a scale) into one undo step; a discrete command
   *  (lock, hide) leaves it off and gets its own. */
  editBackground(
    boxId: string, groupId: string, backgroundId: string,
    edit: { x?: number; y?: number; width?: number; height?: number; opacity?: number; hidden?: boolean; locked?: boolean },
    opts?: { coalesce?: boolean },
  ): Promise<OpenResult | { error: string }>;
  /** Move a background through the stack, among the other backgrounds only. */
  restackBackground(
    boxId: string, groupId: string, backgroundId: string, move: "front" | "forward" | "backward" | "back",
  ): Promise<OpenResult | { error: string }>;
  /** Take a picture off the map. The file stays and is swept at session end. */
  removeBackground(boxId: string, groupId: string, backgroundId: string): Promise<OpenResult | { error: string }>;
  /** Move a zone through the stack. Which zone owns a pin is the frontmost one
   *  it stands in, so this can rebind hands where zones overlap. */
  restackZone(
    boxId: string, groupId: string, tagId: string, move: "front" | "forward" | "backward" | "back",
  ): Promise<{ result: OpenResult; rebound: SiteRebinding[] } | { error: string }>;
  setZonePolygon(
    boxId: string, groupId: string, tagId: string, polygon: { x: number; y: number }[] | undefined,
  ): Promise<{ result: OpenResult; rebound: SiteRebinding[] } | { error: string }>;
  /** Take hands off the map: the sites go, the hands stay. */
  removeSitesFromMap(boxId: string, handIds: string[]): Promise<OpenResult | { error: string }>;
  /** Record where hand sites now sit. `zone: null` says "in no zone", which is
   *  different from leaving the binding alone. */
  /** Sites moved: where each one now is. Which zone that is, and so which hands
   *  are rebound, is decided in main from the position over the geometry; the
   *  position and the binding are one commit, so they undo together. */
  moveSitesOnMap(
    boxId: string, groupId: string, placements: { id: string; x: number; y: number }[],
  ): Promise<{ result: OpenResult; rebound: SiteRebinding[] } | { error: string }>;
  /** The comment threads about one thing, oldest first. Resolved ones included:
   *  the caller decides whether to show them (Review ▸ Show Resolved). */
  commentsFor(anchor: string): Promise<CommentDto[]>;
  /** Post a message, creating the thread if this is its first. The author name
   *  comes from the app's identity, in main, so every message agrees.
   *
   *  `mark` places the new thread on a canvas: pass it when the thread was
   *  started by dropping a marker, and omit it for one opened from an editor. It
   *  is ignored for a thread that already exists - a marker is moved with
   *  `moveComment`, not by posting a reply from somewhere else. */
  postComment(
    anchor: string, threadId: string, body: string,
    mark?: { canvas: string; x: number; y: number },
  ): Promise<OpenResult | { error: string }>;
  /** Mark a thread complete, or reopen it. */
  setCommentResolved(threadId: string, resolved: boolean): Promise<OpenResult | { error: string }>;
  /** The markers drawn on one canvas: a deck id, or `map:<boxId>`. */
  /** Withdraw one message from a thread, by its index in that thread. The whole
   *  thread goes when nothing readable would be left. */
  deleteComment(threadId: string, index: number): Promise<OpenResult | { error: string }>;
  commentMarkers(canvas: string): Promise<CommentMarkerDto[]>;
  /**
   * Every comment thread in the project, in reading order, for the Review
   * Feedback walk.
   *
   * Gathered in MAIN and read from the loaded project, so it is whatever is on
   * disk: the renderer flushes its pending writes first, exactly as Patterpad
   * does, or a thread posted a second ago is missing from the walk that is
   * meant to visit it.
   */
  reviewFeedback(showResolved: boolean): Promise<ReviewItemDto[]>;
  /** Remember whether the walk is up, so it survives a restart. */
  setReviewWalk(on: boolean): Promise<void>;
  /**
   * Move a marker, and re-decide what it is anchored to.
   *
   * `item` names what it was dropped on, absent for empty canvas, and that is
   * what makes dragging a comment off a card detach it: the anchor is worked out
   * from where the drag ENDED rather than remembered from where it began.
   */
  moveComment(
    threadId: string, canvas: string, x: number, y: number, item?: string,
  ): Promise<OpenResult | { error: string }>;
  /** Who is commenting; absent until they say. Stored in the APP, not the project. */
  identity(): Promise<{ name: string; email?: string } | undefined>;
  /** The name the open project's VCS knows the author by, to offer when none is
   *  stored. Undefined when nothing is open or the VCS cannot say. */
  offeredIdentity(): Promise<string | undefined>;
  setIdentity(identity: { name: string; email?: string }): Promise<void>;
  setShowResolved(on: boolean): Promise<void>;
  /** Open a URL in the real browser. A renderer cannot, and must not try. */
  openExternal(url: string): Promise<void>;
  /**
   * Record a canvas's furniture: its frames, whole.
   *
   * One call for every furniture gesture rather than an add/move/edit/remove
   * family, because the renderer already holds the list to draw it and the list
   * is what gets written either way (ops/view.ts). The CALLER names the gesture
   * and decides the coalescing, since only it knows whether this was one drag or
   * a discrete command.
   */
  setCanvasFurniture(
    boxId: string, ref: CanvasRefDto, furniture: CanvasFurnitureDto,
    label: string, coalesce?: string,
  ): Promise<OpenResult | { error: string }>;
  /** Record where cards now sit on a deck's canvas. Writes the box's arrangement
   *  sidecar, never a content shard, and is one undo step per drop. */
  moveCardsOnCanvas(deckId: string, placements: { id: string; x: number; y: number }[]): Promise<OpenResult | { error: string }>;
  /** A new card on a deck's canvas, at `at`, with the deck's other cards pinned
   *  where they currently sit. One undo step, and nothing else moves. */
  createCardOnCanvas(deckId: string, at: { x: number; y: number }, pinned: { id: string; x: number; y: number }[]): Promise<{ result: OpenResult; cardId: string } | { error: string }>;
  /** Arrange cards by dependency and record it: one undo step for the whole tidy.
   *  The canvas sends what only it knows (which cards, where they are, how big a
   *  card is) because the computation lives in main, where ops already lives. */
  layoutDeck(
    deckId: string, ids: string[], current: { id: string; x: number; y: number }[],
    size: { width: number; height: number; gapX: number; gapY: number },
  ): Promise<{ result: OpenResult; positions: { id: string; x: number; y: number }[]; cycles: string[][] } | { error: string }>;
  /** Editor only: tell main which card is selected, so an open Links window
   *  follows along. Fire and forget. */
  setLinkFocus(cardId: string | undefined): Promise<void>;
  /** Links window: the focus changed under it. */
  onLinkFocus(handler: (cardId: string | undefined) => void): void;
  /** Links window: float over the editor. */
  setLinksPinned(on: boolean): Promise<void>;
  /** Links window: close itself (Esc), as Find does. */
  closeLinks(): Promise<void>;
  /** Close the Board from its own chrome (Esc, or the ✕). */
  closeBoard(): Promise<void>;
  /** Close the Coverage window from its own chrome (Esc, or the ✕). */
  closeCoverage(): Promise<void>;

  /** Coverage window: float over the editor (Board + Find's pin). */
  setCoveragePinned(on: boolean): Promise<void>;
  /** Coverage window: bring the editor forward with Project Settings open at
   *  a section ("world" for the drivers). */
  openProjectSettings(section: string): Promise<void>;
  /** Coverage window only: a different project was opened underneath it. */
  /** A DIFFERENT project was opened underneath this window: whatever it is
   *  showing describes a project that is no longer open. Every tool window
   *  that reads the project should listen (see the satellite registry in
   *  main/index.ts). */
  onProjectChanged(handler: () => void): void;
  /** Compile and write the .storyletsc bundle to its declared path. */
  exportBundle(): Promise<{ path: string } | { error: string }>;
  /** Publish Spreadsheet: the whole project as a readable .xlsx workbook,
   *  through a native Save dialog. Null = cancelled. */
  exportXlsx(): Promise<{ path: string } | { error: string } | null>;
  /** Publish Playable HTML: the project as one self-contained .html that
   *  plays in any browser, through a native Save dialog. Null = cancelled. */
  exportHtml(): Promise<{ path: string } | { error: string } | null>;

  // --- the send envelope (.storyletpack, Reboot 7.1) -------------------------
  /** Write the open project to a .storyletpack (native save dialog).
   *  Null = cancelled. */
  exportPack(): Promise<{ path: string } | { error: string } | null>;
  /** Open a .storyletpack as a project: pick a pack, pick where to explode it,
   *  then open the result. Null = cancelled at either step. */
  openPack(): Promise<OpenResult | { error: string } | null>;
  /** Fold a RETURNED pack into the open project, merging by id against the
   *  pack that was sent. Null = cancelled. */
  /** Pick the two packs and RUN the merge, without writing: the summary is what
   *  the confirmation is built from. Null when a picker was cancelled. */
  mergePackPlan(): Promise<{ summary: PackMergeSummary } | { error: string } | null>;
  /** Write the planned merge. Null when there is nothing planned (the author said
   *  no, or the plan was already committed). */
  mergePackCommit(): Promise<OpenResult | { error: string } | null>;
  /** Throw the planned merge away: the author declined it. */
  mergePackDrop(): Promise<void>;
  /** Whatever the OS handed the app at launch: a double-clicked project, or a
   *  double-clicked pack (which unpacks first). Null = nothing was passed, so
   *  boot falls back to the last project. Consumed once. */
  launchTarget(): Promise<OpenResult | { error: string } | null>;
  /** The OS asked the RUNNING app to open something (a second double-click). */
  onProjectOpened(handler: (result: OpenResult | { error: string }) => void): void;

  // --- Live Link (design/live-link.md) ---------------------------------------
  /** Start / stop the loopback server (the chip and Play > Live Link); each
   *  answers with the state it left things in. */
  liveLinkStart(): Promise<LiveLinkStatus>;
  liveLinkStop(): Promise<LiveLinkStatus>;
  liveLinkStatus(): Promise<LiveLinkStatus>;
  /** Every window that shows the link's state listens: the editor's chip and
   *  the Board's banner and switch. */
  onLiveLinkStatus(handler: (status: LiveLinkStatus) => void): void;
  /** Board only: the last snapshot and recent trace, for a Board that opens
   *  (or enters Live mode) after the game has started. */
  liveLinkSnapshot(): Promise<LiveLinkSnapshot>;
  /** Point the Board at another participant's flow (design/live-link.md). */
  liveLinkFollow(flowId: string): Promise<LiveLinkStatus>;
  /** Board only: the game's frames as they arrive. */
  onLiveLinkFrame(handler: (frame: LiveLinkFrame) => void): void;

  onMenu(handler: (command: MenuCommand) => void): void;

  // --- The auto-updater (design/shared-shell.md, sixth slice) -----------------
  // Four channels the shell's updater expects a renderer to answer. It does NOT
  // degrade to a native dialog if we stay silent: it waits 300 seconds and then
  // resolves to its own fallback, so these are required, not optional.
  /** main asks: is anything unwritten? Answer synchronously from the save controller. */
  onUpdaterCheckDirty(handler: () => boolean): void;
  /** main asks: write now, before I restart to install. */
  onUpdaterSaveBeforeInstall(handler: () => Promise<{ ok: boolean }>): void;
  /** main asks a question; answer with the chosen button INDEX (showMessageBox's contract). */
  onUpdaterPrompt(handler: (opts: UpdaterPromptOptions) => Promise<number>): void;
  /** Live download progress, for a dialog opened with `progress: true`. */
  onUpdaterDownloadProgress(handler: (p: UpdaterDownloadProgress) => void): void;
}
