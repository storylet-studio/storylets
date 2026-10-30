// ---------------------------------------------------------------------------
// The navigator and centre views. The navigator disambiguates node kinds with
// quiet group labels (Decks / Hands) under a selectable box header. A deck's
// centre defaults to its CANVAS - cards as nodes, outcomes as arrows - with
// the card grid and the table one click away and remembered; boxes, hands,
// templates and tag groups get a light list or a document.
//
// "All editing detail lives in the inspector" used to close this paragraph.
// There has been no inspector since July 2026: editing happens in the centre,
// in the document itself (design review 2026-08, A17).
// ---------------------------------------------------------------------------

import { iconNode, plural, renderStepperBar, tipWithKey, wireReorder } from "@wildwinter/app-shell";
import type { IconName } from "@wildwinter/app-shell";
import { gameIdify, PLACE_GROUP } from "@storylet-studio/model";
import { el } from "@wildwinter/app-shell";
import { vcKeys } from "./vc-view.js";
import { previewCondition } from "./expr-panels.js";
import { openContextMenu } from "@wildwinter/app-shell/context-menu";
import { currentDocTab, docTabs, documentHeading, setDocTab } from "./inspector.js";
import type { DocTabSpec } from "./inspector.js";
import { extensionTabs, knownTab } from "./extension-rows.js";
import { problemText } from "./problem-copy.js";
import { deleteLabel } from "./deletes.js";
import { placeGroupsOf } from "./where.js";
import { mapGlyph } from "./map-glyphs.js";
import { boxColour, boxPin } from "./box-tint.js";
import { boxChip, chip, listMeta, moreMenu, tableHead } from "./widgets.js";
import { rove, treeRows, wireTreeKeys } from "@wildwinter/app-shell";
import { keepCardFocus, wireRowKeys } from "./row-keys.js";
import { alsoUnder, boxEntries, groupEntries, groupOptions, resolveGroup } from "./card-groups.js";
import type { CardGroup, GroupEntry, GroupKey, GroupOption, GroupPage } from "./card-groups.js";
import type { ProblemNames } from "./problem-copy.js";
import type { BoxDto, BoxEdit, CardDto, ConditionProperty, DeckDto, Problem, ProjectDto, ReviewItemDto, ViewMode } from "../../shared/api.js";

/** What the centre shows + the nav highlight. Which tab a document is on is
 *  the document's own state (doc-tab-memory.ts), not a focus kind.
 *  Hand templates and tags are box SETUP: they live as tabs on the box's
 *  page (like the card template), never as focus kinds or nav rows. */
export type Focus =
  | { kind: "project"; box?: undefined }
  | { kind: "story"; box?: undefined }
  /** The project map's page: the project's, so it names no box. */
  | { kind: "map"; box?: undefined }
  | { kind: "box"; box: string }
  | { kind: "decks"; box: string }
  | { kind: "deck"; box: string; deck: string }
  | { kind: "hands"; box: string };

export interface ViewActions {
  /** The open project, for the tabs its Storylet extensions add to a deck's and a box's page. Absent: none. */
  project?(): ProjectDto | undefined;
  /** How many OPEN comment threads it has, for the header bubble. */
  openThreads(id: string): number;
  /** Open the comment popover, anchored to the element that was clicked. */
  showComments(id: string, subject: string, anchor: HTMLElement): void;
  focus(focus: Focus): void;
  /** Toggle a nav node's disclosure (chevron) - never navigates. */
  toggleNav(id: string): void;
  openProjectSettings(): void;
  /** Show the project's folder in Finder / the file manager. */
  revealProject(): void;
  inspectCard(box: string, deck: string, card: string): void;
  inspectTemplate(box: string, template: string): void;
  inspectTagGroup(box: string, group: string): void;
  inspectHand(box: string, hand: string): void;
  /** Open a hand on its Cards tab: the ways in that are about the place. */
  openHand(box: string, hand: string): void;
  /** Rename a deck or a box now: its title or address moves a file, so these
   *  commit on blur and write at once. */
  saveDeck(deckId: string, edit: { title?: string; gameId?: string; purpose?: string }): void;
  saveBox(boxId: string, edit: BoxEdit): void;
  /** The same edits through the save controller, as you type: a purpose. */
  saveDeckLater(deckId: string, edit: { purpose?: string }): void;
  saveBoxLater(boxId: string, edit: BoxEdit): void;
  newCard(box: string, deck: string): void;
  newDeck(box: string): void;
  newBox(): void;
  newTemplate(box: string): void;
  newTagGroup(box: string): void;
  /** Create a tag group that is already a map, for authors who came looking for one. */
  newMap(box: string): void;
  newHand(box: string): void;
  editBox(box: string): void;
  duplicateBox(box: string): void;
  deleteBox(box: string): void;
  duplicateCard(box: string, deck: string, card: string): void;
  /** Move a card to another deck of its box, one undo step; the view stays where it is. */
  moveCardToDeck(box: string, deck: string, card: string, toDeck: string): void;
  deleteCard(box: string, deck: string, card: string): void;
  /** Point the Links lens at this card and bring it forward, opening it if it is
   *  not up yet. Asks about the card under the pointer, which need not be the
   *  card the editor has open. */
  showLinks(card: string): void;
  duplicateDeck(box: string, deck: string): void;
  deleteDeck(box: string, deck: string): void;
  duplicateTemplate(box: string, template: string): void;
  deleteTemplate(box: string, template: string): void;
  duplicateHand(box: string, hand: string): void;
  deleteHand(box: string, hand: string): void;
  duplicateTagGroup(box: string, group: string): void;
  deleteTagGroup(box: string, group: string): void;
  /** Select a card in the focused deck; `extend` adds to or removes from the
   *  selection (shift or cmd click) rather than replacing it. */
  selectCard(card: string, how: SelectHow): void;
  setViewMode(mode: ViewMode): void;
  /** Fill a node-view container: fetch the deck's links, then mount the canvas.
   *  Done in deck-canvas.ts, because views.ts never touches IPC. */
  mountNodeView(host: HTMLElement, deck: DeckDto): void;
  /** Fill an opted-in box's Map tab: its own sites on the project map. */
  mountBoxSites(host: HTMLElement, box: BoxDto): void;
  /** The project map's page, optionally with one site or zone selected. */
  openMap(select?: string): void;
  /** Put a box on the project map, or take it off (refused, with a sentence,
   *  while its hands or cards still reference a zone). */
  useProjectMap(box: string, on: boolean): void;
  /** What this box's cards are grouped by on a page, as this person last chose
   *  (app state, never the project); undefined when they never have. */
  cardGroup(box: string, page: GroupPage): GroupKey | undefined;
  /** Choose it, remember it, and redraw. */
  setCardGroup(box: string, page: GroupPage, key: GroupKey): void;
  /** A deck's condition catalogue for a page showing several decks' cards (a
   *  box's Contents): what it has now, fetched and redrawn when it has none. */
  deckCatalogue(box: string, deck: string): ConditionProperty[];
  moveCard(box: string, deck: string, card: string, target: string, before: boolean): void;
  moveBox(box: string, target: string, before: boolean): void;
  moveDeck(box: string, deck: string, target: string, before: boolean): void;
  moveHand(box: string, hand: string, target: string, before: boolean): void;
}

// --- drag-reorder, and the drop settle (FLIP) -----------------------------------
//
// A drop re-renders the list, and a list that re-renders snaps every item to
// its new slot. Structural motion is the one kind the design language keeps
// ("a row settling after a drop"), so the drop records where every reorderable
// sibling sat, and the render that follows eases each one from there to where
// it now is, at --dur-settle (parity row 49). Patterpad's commitWithFlip, on
// this app's asynchronous render: the record is taken at the drop and spent by
// the next render, or dropped if no render comes.
let settleFrom: Map<string, DOMRect> | null = null;
function armSettle(list: ParentNode): void {
  const rects = new Map<string, DOMRect>();
  list.querySelectorAll<HTMLElement>("[data-reorder-id]").forEach((n) => rects.set(n.dataset["reorderId"]!, n.getBoundingClientRect()));
  settleFrom = rects;
  window.setTimeout(() => { if (settleFrom === rects) settleFrom = null; }, 1000);
}
function playSettle(host: ParentNode): void {
  const from = settleFrom;
  if (!from) return;
  settleFrom = null;
  const moved: HTMLElement[] = [];
  host.querySelectorAll<HTMLElement>("[data-reorder-id]").forEach((n) => {
    const f = from.get(n.dataset["reorderId"]!);
    if (!f) return;
    const r = n.getBoundingClientRect();
    const dx = f.left - r.left;
    const dy = f.top - r.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    // INVERT: jump back to the old slot with no transition...
    n.style.transition = "none";
    n.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
    moved.push(n);
  });
  if (moved.length === 0) return;
  void moved[0]!.offsetHeight;   // commit the inverted transforms as the start frame
  // ...and PLAY: release to the real position with the family's settle.
  for (const n of moved) { n.style.transition = "transform var(--dur-settle) var(--ease-standard)"; n.style.transform = ""; }
  const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur-settle")) || 200;
  window.setTimeout(() => { for (const n of moved) { n.style.transition = ""; n.style.transform = ""; } }, ms + 80);
}
/**
 * Make `el` reorderable among its siblings; a drop arms the settle, then moves.
 * The shell's wireReorder does the dragging (dragstart / dragover-mark / drop);
 * its marks (.dragging / .drop-before / .drop-after) are classes only, which
 * shell.css draws. Its onMove is (draggedId, before, targetId); the actions here
 * take (from, to, before), so this swaps the order.
 */
function wireDrop(el: HTMLElement, id: string, axis: "x" | "y", move: (from: string, to: string, before: boolean) => void): void {
  wireReorder(el, id, axis, (from, before, to) => { armSettle(el.parentElement ?? el); move(from, to, before); });
}
const grip = (): HTMLElement => el("span", { className: "cardgrip", tip: "Drag to reorder" }, iconNode("grip"));

/** The view-mode switch, shown top-right of a centre head. Node is offered only
 *  where there is one (a deck): the mode is remembered across pages, so a page
 *  that cannot draw a canvas shows the two it has and treats node as cards,
 *  rather than lighting a button whose view is not there. */
function viewToggle(active: ViewMode, actions: ViewActions, withNode = false): HTMLElement {
  const shown: ViewMode = !withNode && active === "node" ? "cards" : active;
  const modes: ViewMode[] = withNode ? ["cards", "table", "node"] : ["cards", "table"];
  const btn = (mode: ViewMode, name: IconName, title: string): HTMLElement => {
    const b = el("button", { className: `seg-opt viewbtn${shown === mode ? " on" : ""}`, tip: title }, iconNode(name));
    b.setAttribute("aria-label", title);
    b.setAttribute("aria-pressed", String(shown === mode));
    b.addEventListener("click", () => { if (shown !== mode) actions.setViewMode(mode); });
    return b;
  };
  // From the shell's drawn vocabulary, named by what you get rather than by
  // the picture, so a second app picks the same three without copying
  // somebody's taste in symbols.
  const buttons = [btn("cards", "viewCards", "Card view"), btn("table", "viewTable", "Table view"),
    ...(withNode ? [btn("node", "viewNode", "Node view")] : [])];
  const seg = el("div", { className: "seg viewtoggle" }, ...buttons);
  segmentKeys(seg, buttons, modes.indexOf(shown), (i) => actions.setViewMode(modes[i]!), ".viewtoggle .seg-opt.on");
  return seg;
}

/**
 * A segmented strip's keys, in the tablist pattern the document tab bar uses
 * (inspector.ts docTabs): one tab stop, on the chosen option, and Left, Right,
 * Home and End choose its neighbour, wrapping. Choosing redraws the page, strip
 * and all, so the redrawn strip's chosen option, found by `again`, takes the
 * focus (the hands-on review, 2026-10, foundation 8).
 */
export function segmentKeys(seg: HTMLElement, buttons: readonly HTMLElement[], at: number, pick: (index: number) => void, again: string): void {
  buttons.forEach((b, i) => { b.tabIndex = i === Math.max(at, 0) ? 0 : -1; });
  seg.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || buttons.length === 0) return;
    const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : undefined;
    if (to === undefined) return;
    e.preventDefault();
    // The view switch sits inside the document's tab bar, whose own arrows
    // would otherwise change the tab as well.
    e.stopPropagation();
    const next = (to + buttons.length) % buttons.length;
    if (next === at) return;
    pick(next);
    document.querySelector<HTMLElement>(again)?.focus();
  });
}

/**
 * Where the author came from, when that is NOT this page's parent.
 *
 * Up and back are two moves that coincide almost always: a card opened from its
 * deck goes up and back to the same place. They diverge when you arrive SIDEWAYS -
 * a zone opened from the map, a card from Find or from Links - and going up then
 * lands you somewhere you have never been (structure rule 12, amended).
 *
 * Module state rather than a parameter threaded through every page: navigation.ts
 * owns navigation and sets this as it navigates, and the alternative was four call
 * sites and their tests carrying something none of them decide.
 */
let cameFrom: { label: string; go: () => void } | undefined;
export function setCameFrom(from: { label: string; go: () => void } | undefined): void {
  cameFrom = from;
}


/**
 * The topbar's lead: the project's name, which is also the way home.
 *
 * A13: the project name is a WAY HOME, as it is in Patterpad. The overview page
 * had exactly one route to it - the navigator's project row - so collapsing the
 * navigator made it unreachable. The tooltip says WHERE, because two projects
 * can share a name and nothing else on screen tells them apart.
 *
 * AND, for a project a server has not seen the whole of, where it stands. That
 * suffix used to live in the OS window title, where on macOS nobody could read
 * it: `titleBarStyle: "hiddenInset"` means the OS title is never drawn, so
 * "3 edits unpushed" was written to a bar that does not exist (found end to
 * end, 2026-09-07). It sits here now, in the same quiet register and the same
 * words as the Server menu's status line, and it is SILENT while the project is
 * level: a project in sync says nothing, exactly as it said nothing before.
 */
export function projectLead(
  project: { name: string; dir: string },
  remote: { status: string; edits: number } | undefined,
  go: () => void,
): HTMLElement {
  // The project's name and nothing else: no app name in its own window, and no
  // spaced hyphen. The remote status is a separate, quieter span beside it (the
  // October 2026 UI review, 3-composition.md proposal 8).
  const button = el("button", {
    className: "pname shell-topbar-title", tip: `The project overview\n${project.dir}`, onClick: go,
  }, project.name);
  if (remote !== undefined && remote.edits > 0) {
    button.append(el("span", { className: "pname-note shell-topbar-sub", text: remote.status }));
  }
  return button;
}

/**
 * The bar every centre page opens with: a BACK button naming where it goes, and
 * the page's own controls on the right (the view switch, the card stepper).
 *
 * The hierarchy TRAIL that used to live here (Box › Decks › Deck) is gone as of
 * 2026-08-04. It was duplicating the navigator, which already answers "where am
 * I" by highlighting the open document's row and every ancestor on its path, and
 * already offers every multi-level jump the segments did. What the trail could
 * not do was answer the reflex it looked like it should: a row of quiet grey
 * words reads as a statement of location, not as a way out. So one control does
 * that job and names its destination (a drawn back chevron, then "Arrival").
 *
 * Callers still pass the whole ancestor path, because the LAST segment is the
 * back target, and because keeping the path here means the trail could come back
 * as one line if the navigator is ever hidden by default.
 */
export function crumbTrail(segments: { label: string; go: () => void }[], ...right: (Node | null)[]): HTMLElement {
  const bar = el("div", { className: "crumbs" });
  const up = segments[segments.length - 1];
  if (up) {
    bar.append(el("button", {
      className: "btn crumb-back",
      tip: tipWithKey(`Back to ${up.label}`, "Esc"), onClick: up.go,
    }, iconNode("back"), up.label));
  }
  // The way back to where you actually came from, when that is somewhere else. It
  // reads differently from the parent on purpose: two left chevrons side by side
  // would be one control wearing two labels. No keyboard shortcut until somebody
  // wants one - Esc keeps meaning "up", which is the move with four routes to it.
  if (cameFrom) {
    const back = cameFrom;
    bar.append(el("button", {
      className: "btn crumb-return", text: `↩ ${back.label}`,
      tip: `Back to ${back.label}`, onClick: back.go,
    }));
  }
  bar.append(el("span", { className: "crumb-spacer" }));
  for (const r of right) if (r) bar.append(r);
  return bar;
}

// The pills and dots live in widgets.ts, beside the other small pieces the
// documents share; re-exported for the views' callers.
export { boxChip, chip, chipDot } from "./widgets.js";
/** Colour an element (a glyph drawn in currentColor) and hand it back. */
const tinted = (node: HTMLElement, colour: string): HTMLElement => { node.style.color = colour; return node; };

// --- navigator ----------------------------------------------------------------

// The shard keys a row carries as `data-vc` live with the rest of the
// version-control surface (vc-view.ts); re-exported for the views' callers.
export { vcKeys } from "./vc-view.js";

/** Stable ids for the nav's expandable nodes (persisted per user). */
export const navId = {
  box: (boxId: string): string => `b:${boxId}`,
  collection: (boxId: string, kind: "decks" | "hands"): string => `c:${boxId}:${kind}`,
};

export function renderNav(host: HTMLElement, project: ProjectDto, focus: Focus | undefined, expanded: ReadonlySet<string>, actions: ViewActions): void {
  // One row grammar for the whole tree: [chevron | spacer] label [count].
  // Disclosure belongs to the user (the chevron, remembered); clicking a label
  // navigates and only ever expands. The open document's row is `sel`; when
  // the open document has no row (an item: card, query, hand, dimension),
  // its nearest ancestor carries `sel` instead - the Mail model, "which deck
  // am I in" answered at full strength. True ancestors above that are
  // `on-path` (rules 8-9).
  //
  // The keyboard's tree (app-shell's tree keys): one tab stop, the arrows between rows.
  // The tree is redrawn whole on every navigation and every disclosure, so the
  // row that had the focus is found again by its key afterwards (the hands-on
  // review, 2026-10, foundation 8: focus fell to the top of the window).
  const active = document.activeElement;
  const hadKey = active instanceof HTMLElement && host.contains(active) ? active.closest<HTMLElement>("[data-nav-key]")?.dataset["navKey"] : undefined;
  host.setAttribute("role", "tree");
  host.setAttribute("aria-label", "Project");
  wireTreeKeys(host, (r) => r.querySelector<HTMLElement>(".nav-chev")?.click());
  /** A row's place in the tree, for the keys and for finding it again. */
  const treeItem = <E extends HTMLElement>(b: E, key: string, level: number): E => {
    b.dataset["navKey"] = key;
    b.setAttribute("role", "treeitem");
    b.setAttribute("aria-level", String(level));
    b.tabIndex = -1;
    return b;
  };
  const row = (opts: {
    key: string;
    depth: 0 | 1 | 2 | 3;
    label: string;
    onClick: () => void;
    node?: string;             // expandable: chevron + this id
    count?: number;
    sel?: boolean;
    path?: boolean;
    cls?: string;
    vc?: string;               // shard key(s) this row's badge folds (see vcKeys)
    /** A first-contact rollover. The audit's sharpest orientation finding:
     *  every wrong belief it formed, it formed HERE, where nothing taught. */
    tip?: string;
    /** A small glyph: before the label (`lead`), or after it (`mark`). */
    lead?: HTMLElement;
    mark?: HTMLElement;
  }): HTMLElement => {
    // `shell-nav-row`: the family's navigator row (app-shell 0.65), which draws the open document's row
    // from `aria-current` as well as announcing it.
    const b = treeItem(el("button", { className: `nav-row shell-nav-row nav-d${opts.depth}${opts.sel ? " sel" : ""}${opts.path ? " on-path" : ""}${opts.cls ? ` ${opts.cls}` : ""}`, onClick: opts.onClick, ...(opts.tip !== undefined ? { tip: opts.tip } : {}) }), opts.key, opts.depth + 1);
    if (opts.sel) b.setAttribute("aria-current", "page");
    if (opts.vc) b.dataset["vc"] = opts.vc;
    if (opts.node) {
      const id = opts.node;
      const chev = el("span", { className: `nav-chev${expanded.has(id) ? " open" : ""}` }, iconNode("collapsed", 12));
      chev.addEventListener("click", (e) => { e.stopPropagation(); actions.toggleNav(id); });
      b.setAttribute("aria-expanded", String(expanded.has(id)));
      b.append(chev);
    } else {
      b.append(el("span", { className: "nav-chev-space" }));
    }
    if (opts.lead) b.append(opts.lead);
    b.append(el("span", { className: "nav-label", text: opts.label }));
    if (opts.mark) b.append(opts.mark);
    if (opts.count !== undefined) b.append(el("span", { className: "nav-n shell-nav-count", text: String(opts.count) }));
    return b;
  };
  // The project's own row opens its page (the boxes master); Settings
  // lives on that page's menu and under Cmd+, as before.
  const projectRow = treeItem(el("button", { className: `nav-project${focus?.kind === "project" ? " sel" : ""}`, text: project.name, onClick: () => actions.focus({ kind: "project" }) }), "project", 1);
  if (focus?.kind === "project") projectRow.setAttribute("aria-current", "page");
  projectRow.dataset["vc"] = vcKeys.projectRow;
  host.replaceChildren(projectRow);

  // The story's own state, first-class in the navigator (the author's ruling,
  // 2026-08-26). @story is the designers' working vocabulary, touched daily and
  // grown with content; hiding its one editing home in a modal dialog treated
  // it like configuration. @world STAYS in Project Settings, because it is the
  // other thing: a contract with the game, set by the principal designer.
  host.append(row({
    key: "story", depth: 0, label: "Story", cls: "nav-storyrow", vc: vcKeys.project,
    tip: "The story's own memory. Cards read and write it as @story.",
    count: project.storyPropertyCount,
    sel: focus?.kind === "story",
    onClick: () => actions.focus({ kind: "story" }),
  }));

  // The PROJECT MAP, one row at project level between Story and the boxes,
  // present only when the project has a map. An amendment to structure rule 8
  // (design/studio-editing-structure.md), ruled in the surfacing review
  // (design/surfacing-review-2026-10/README.md, "Direction: back to basics",
  // plan item 2): the map is above the boxes, so it gets a row of its own; it
  // stays a SINGLE row, a page like Story's, never a tree of zones or sites,
  // which live on the map's own side panel.
  if (project.map !== undefined) {
    host.append(row({
      key: "map", depth: 0, label: "Map", cls: "nav-maprow",
      lead: mapGlyph("map", 13, "map-glyph nav-glyph"),
      tip: "The project map: zones drawn once, and every box that uses it a layer of its own hands.",
      count: project.map.zones,
      sel: focus?.kind === "map",
      onClick: () => actions.focus({ kind: "map" }),
    }));
  }

  for (const box of project.boxes) {
    const inBox = focus?.box === box.id;
    const boxNode = navId.box(box.id);
    const boxRow = row({
      key: boxNode, depth: 0, label: box.title ?? box.gameId, node: boxNode, cls: "nav-boxrow", vc: vcKeys.box(box.id),
      // A small map glyph on a box that uses the map: which boxes are on it,
      // readable from the tree without opening anything. In the box's colour,
      // so the tree says which layer on the map is this box's.
      ...(box.usesMap === true ? { mark: tinted(mapGlyph("map", 12, "map-glyph nav-mark"), boxColour(box.id)) } : {}),
      tip: "A box is a self-contained set of decks, hands, and tags.",
      sel: inBox && focus.kind === "box",
      path: inBox && focus.kind !== "box",
      onClick: () => actions.focus({ kind: "box", box: box.id }),
    });
    boxRow.addEventListener("contextmenu", itemMenu("box", () => actions.duplicateBox(box.id), () => actions.deleteBox(box.id)));
    host.append(boxRow);
    if (!expanded.has(boxNode)) continue;

    // The nav stops at containers and collections, and carries CONTENT only:
    // Decks and Hands. Setup (hand templates, tags) lives behind the box's
    // own page as tabs, exactly like the card template (structure rule 8).
    type CKind = "decks" | "hands";
    const collection = (label: string, kind: CKind, count: number, fill?: () => void): void => {
      const node = navId.collection(box.id, kind);
      host.append(row({
        key: node, depth: 1, label, ...(fill ? { node } : {}), count,
        // The same sentence the Hands master and the box page use (B3): the
        // one line that unlocks the model, at the point of first contact.
        ...(kind === "hands" ? { tip: "Where cards are dealt on the board. Each hand holds the cards it's dealt." } : {}),
        // Hands all live in one shard, so the collection carries its badge;
        // decks are a shard each and badge on their own rows below.
        ...(kind === "hands" ? { vc: vcKeys.hands(box.id) } : {}),
        // An open item editor has no row of its own, so its collection is
        // the nearest ancestor and carries sel (a deck-focused centre makes
        // Decks merely on-path: the deck row below carries sel).
        sel: inBox && focus.kind === kind,
        path: inBox && kind === "decks" && focus.kind === "deck",
        onClick: () => actions.focus({ kind, box: box.id }),
      }));
      if (fill && expanded.has(node)) fill();
    };

    collection("Decks", "decks", box.decks.length, () => {
      for (const deck of box.decks) {
        const here = inBox && focus.kind === "deck" && focus.deck === deck.id;
        const deckRow = row({
          key: `d:${deck.id}`, depth: 2, label: deck.title ?? deck.gameId, count: deck.cards.length, vc: vcKeys.deck(deck.id),
          sel: here,
          onClick: () => actions.focus({ kind: "deck", box: box.id, deck: deck.id }),
        });
        deckRow.addEventListener("contextmenu", itemMenu("deck", () => actions.duplicateDeck(box.id, deck.id), () => actions.deleteDeck(box.id, deck.id)));
        host.append(deckRow);
      }
      host.append(treeItem(el("button", { className: "nav-add shell-nav-row shell-nav-add nav-d2", onClick: () => actions.newDeck(box.id) }, iconNode("add", 12), "New deck"), `+d:${box.id}`, 3));
    });

    collection("Hands", "hands", box.hands.length);

  }

  host.append(treeItem(el("button", { className: "nav-add shell-nav-row shell-nav-add nav-add-box nav-d0", onClick: () => actions.newBox() }, iconNode("add", 12), "New box"), "+b", 1));
  // The one tab stop: the row that had the focus, else the open document's.
  const rows = treeRows(host);
  const back = hadKey === undefined ? undefined : rows.find((r) => r.dataset["navKey"] === hadKey);
  rove(host, back ?? rows.find((r) => r.getAttribute("aria-current") === "page") ?? rows[0], back !== undefined);
}

// The delete guard's evidence for a card lives with the other deletes
// (deletes.ts); re-exported for the callers that have always read it here.

// --- one gesture grammar, all three views of a deck ---------------------------
//
// Click SELECTS, double-click OPENS, shift or cmd click extends the selection.
// The Finder rule, and the one interaction model every Mac user already has:
// click to point at a thing, double-click to commit to it.
//
// Single-click used to open, inherited from a list-plus-inspector world where
// clicking cost nothing because the detail appeared beside the list. Once the
// inspector pane was retired and a card became a full centre document, that click
// became a trapdoor: a navigation with no weight to it, no way to select two
// cards, and an author reaching for a way back. The canvas already worked this
// way, so this brings the other two into line rather than inventing anything.
//
// Recorded in design/studio-editing-structure.md; it revises a decision that
// predates the canvas.

/** How a click changes the selection: the OS's three gestures. A plain click
 *  replaces, shift fills the contiguous run from the anchor, cmd/ctrl toggles
 *  the one card (parity row 46). */
export type SelectHow = "replace" | "range" | "toggle";

export interface CardGestures {
  /** Change the selection by one of the three gestures. */
  select(cardId: string, how: SelectHow): void;
  /** Commit: open the card. */
  open(cardId: string): void;
}

/**
 * The quiet Open affordance: revealed on rollover, one word, same in every view.
 *
 * It exists because double-click is now the only pointer route into a card, and a
 * gesture with no affordance is a rule you have to be told. Deliberately NOT a
 * focus stop: tabbing through a deck should not stop twice per card, and the
 * keyboard already has Enter.
 *
 * A span rather than a button because on a card face it lives inside one, and
 * nesting buttons is invalid HTML with genuinely odd click behaviour.
 */
function openChip(cardId: string, gestures: CardGestures): HTMLElement {
  const chip = el("span", { className: "cardopen", text: "Open", tip: "Open this card (double-click)" });
  chip.addEventListener("click", (e) => {
    e.stopPropagation();   // not a selection click as well
    gestures.open(cardId);
  });
  chip.addEventListener("dblclick", (e) => e.stopPropagation());
  return chip;
}

/** Wire an element to the grammar: shift is a range, cmd/ctrl a toggle. */
function wireCardGestures(el: HTMLElement, cardId: string, gestures: CardGestures): void {
  el.addEventListener("click", (e) => {
    // A double-click also fires two clicks; selecting on the way in is harmless
    // and keeps the card highlighted as it opens.
    gestures.select(cardId, e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "replace");
  });
  el.addEventListener("dblclick", (e) => {
    e.preventDefault();
    gestures.open(cardId);
  });
}

// --- centre: deck of cards ----------------------------------------------------

/** What a grouped view adds to a face: the other headings it is also under,
 *  the deck it lives in (a box's Contents mixes decks), and whether it can be
 *  dragged (only an ungrouped deck, whose order IS the deck's). */
/** `deck` names the card's deck on the face, in `deckColour` when the deck
 *  has one stored (a renamed deck keeps its colour). */
interface FaceExtras { also?: string[]; deck?: string; deckColour?: number; drag?: boolean }

function cardFace(card: CardDto, catalogue: ConditionProperty[], selected: boolean, gestures: CardGestures, onContext: (e: MouseEvent) => void, extras: FaceExtras = {}): HTMLElement {
  // Title, then the eligibility condition (when this card fires), then the
  // purpose. The ranking machinery is recessive (on the card's own page). The
  // condition is a restrained, Patterpad-style "if" preview - a quiet prefix
  // with toned-down pills (check_flags etc. render compactly via the dialect),
  // not a loud chip strip (the vivid pills live in the card's When editor).
  const face = el("button", { className: `scard${selected ? " sel" : ""}` },
    el("h3", { text: card.title ?? card.gameId }),
  );
  face.dataset["card"] = card.id;   // the keyboard's place, kept across a redraw (row-keys.ts)
  wireCardGestures(face, card.id, gestures);
  face.addEventListener("contextmenu", onContext);
  if (card.condition) {
    face.append(el("div", { className: "cardwhen" }, el("span", { className: "cardwhen-if", text: "if" }), previewCondition(card.condition, catalogue)));
  }
  // "no purpose yet", not "no beat yet" (B1 point 3). A beat is a thing that
  // HAPPENS - the one word left in the app that reads as story content - and
  // this field is documentation on all seven types that carry it. The class name
  // stays `.beat` for now: it is the typographic role (reading face, on the card
  // face) rather than the field, and renaming it reaches the stylesheet and both
  // canvases for no gain a reader can see.
  face.append(card.purpose
    ? el("p", { className: "beat", text: card.purpose })
    : el("p", { className: "beat muted", text: "No purpose yet." }));
  if (extras.also !== undefined && extras.also.length > 0) {
    face.append(el("p", { className: "card-also", text: `also under ${extras.also.join(", ")}` }));
  }
  // No outcome indicator here. Pips were tried and removed in July (b2ce77b);
  // a plain numeral was tried and removed on 2026-08-04, on both this face and
  // the node canvas, for the same reason: a number in a corner with nothing to
  // anchor it says nothing. The card page shows the outcomes themselves.
  if (card.tags.length > 0 || extras.deck !== undefined) {
    const chips = el("div", { className: "chips" });
    if (extras.deck !== undefined) chips.append(chip(extras.deck, extras.deckColour));
    for (const m of card.tags) for (const v of m.values) chips.append(chip(v));
    face.append(chips);
  }
  face.append(openChip(card.id, gestures), ...(extras.drag === false ? [] : [grip()]));
  return face;
}

const cardMenu = (box: BoxDto, deck: string, card: CardDto, actions: ViewActions) =>
  (e: MouseEvent): void => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, [
    // "What else touches this?" is a question you ask ABOUT a card you can see,
    // so it belongs on the card, not only in a menu bar that first requires the
    // card to become the editor's selection.
    { label: "Links\u2026", onClick: () => actions.showLinks(card.id) },
    { label: "Duplicate", onClick: () => actions.duplicateCard(box.id, deck, card.id) },
    // One item per other deck of the box: a box is one kind of card, so a card
    // moves only among its own box's decks (the hands-on review, 2026-10).
    ...box.decks.filter((d) => d.id !== deck).map((d) => ({
      label: `Move to ${d.title ?? d.gameId}`, onClick: () => actions.moveCardToDeck(box.id, deck, card.id, d.id),
    })),
    // The object, and the ellipsis only when a question follows (deletes.ts).
    { label: deleteLabel("card"), danger: true, onClick: () => actions.deleteCard(box.id, deck, card.id) },
  ]); };

export function renderDeckCentre(
  host: HTMLElement, box: BoxDto, deck: DeckDto, catalogue: ConditionProperty[],
  /** Every selected card, not just one: a selection made on the node canvas has
   *  to be visible in the card and table views of the same deck, or the three
   *  views stop being views OF one thing. */
  selectedCards: ReadonlySet<string>, mode: ViewMode,
  tabBody: (bodyHost: HTMLElement, tab: string) => void, actions: ViewActions,
): void {
  // The container page: trail, identity heading (title + gameId + purpose,
  // above the bar so no tab hides it), then Dealing | Cards | Fields.
  const restoreCardFocus = keepCardFocus(host);
  const tabKey = `deck:${deck.id}`;
  const tab = knownTab(actions.project?.(), "deck", currentDocTab(tabKey, "cards"), "cards");
  const trail = crumbTrail([
    { label: box.title ?? box.gameId, go: () => actions.focus({ kind: "box", box: box.id }) },
    { label: "Decks", go: () => actions.focus({ kind: "decks", box: box.id }) },
  ]);
  let titled = deck.title ?? "";
  let purpose = deck.purpose ?? "";
  let pinned = deck.gameIdPinned ?? "";
  const heading = documentHeading("Deck", {
    title: { get: () => titled, set: (v) => { titled = v; }, placeholder: deck.gameId, commitOn: "blur", commit: () => actions.saveDeck(deck.id, { title: titled }) },
    gameId: { get: () => pinned, set: (v) => { pinned = v; }, fallback: deck.gameId, deriveFrom: () => titled, commit: () => actions.saveDeck(deck.id, { gameId: pinned }) },
    // The purpose is not a rename, so it commits as you type like every other
    // field (ruling N); only the title waits for the blur.
    purpose: { get: () => purpose, set: (v) => { purpose = v; }, placeholder: "What these cards are for", commit: () => actions.saveDeckLater(deck.id, { purpose }) },
    menu: [{ label: deleteLabel("deck"), danger: true, onClick: () => actions.deleteDeck(box.id, deck.id) }],
    comments: { on: deck.id, count: actions.openThreads(deck.id), open: (a) => actions.showComments(deck.id, titled || deck.gameId, a) },
  });
  // Cards first: a deck IS its cards, and that is the tab an author opens the page
  // for. Dealing is the deck's own machinery and comes after the contents, which
  // is also the order the box page uses (Contents, then Dealing).
  // Worked out again from the project as it is now when a save lands while the
  // page is being edited (recountDocTabs), so a count never waits for a redraw.
  const deckSpecs = (): DocTabSpec[] => {
    const now = actions.project?.()?.boxes.find((b) => b.id === box.id)?.decks.find((d) => d.id === deck.id) ?? deck;
    return [
      { key: "cards", label: "Cards", count: now.cards.length },
      { key: "dealing", label: "Dealing" },
      { key: "properties", label: "Properties", count: now.properties.length },
      ...extensionTabs(actions.project?.(), "deck", deck.id),
    ];
  };
  const tabs = docTabs(deckSpecs(), tab, (next) => { setDocTab(tabKey, next); actions.focus({ kind: "deck", box: box.id, deck: deck.id }); }, deckSpecs);
  // The card / table / node switch is a view of the Cards tab, so it sits at the
  // tab bar's right end while that tab is open, not in the back row above.
  if (tab === "cards") tabs.append(viewToggle(mode, actions, true));

  let body: HTMLElement;
  let bar: HTMLElement | null = null;
  if (tab === "cards") {
    const move = (from: string, to: string, before: boolean): void => actions.moveCard(box.id, deck.id, from, to, before);
    const gestures: CardGestures = {
      select: (card, how) => actions.selectCard(card, how),
      open: (card) => actions.inspectCard(box.id, deck.id, card),
    };
    // Group by, on the grid and the table alike; the canvas lays cards out by
    // their links, and a heading has nowhere to go there. Offered only when
    // there is something to group by: a box with no tags and no places keeps
    // the deck page exactly as it was.
    const options = groupOptions(box, "deck");
    const by = resolveGroup(box, "deck", actions.cardGroup(box.id, "deck"));
    if (mode !== "node" && options.length > 1) bar = groupBar(options, by, (key) => actions.setCardGroup(box.id, "deck", key));
    const groups = groupEntries(box, deck.cards.map((card) => ({ card, deck })), by);
    // Only the ungrouped deck reorders: its order IS the deck's, and a drop
    // between two headings would say something the deck does not.
    const drag = by === "none";
    const newCard = (): void => actions.newCard(box.id, deck.id);
    body = mode === "node"
      // The canvas needs the deck's links, which only main can work out, so the
      // container is handed over and filled when they arrive.
      ? nodeHost(deck, actions)
      : mode === "table"
      ? deckTable(box, deck, catalogue, selectedCards, gestures, drag ? move : undefined, actions, groups)
      : el("div", { className: "gb-body" }, ...groupedCards(box, groups, {
          page: "deck", catalogue: () => catalogue, selectedCards, actions,
          gestures: () => gestures,
          menu: (e) => cardMenu(box, deck.id, e.card, actions),
          ...(drag ? { move } : {}),
          ghost: () => el("button", { className: "scard ghost", text: "+ New card", onClick: newCard }),
        }));
  } else {
    body = el("div", { className: "centre-editor" });
    tabBody(body, tab);
  }
  // A tabbed page is measured only on the tabs that hold a DOCUMENT. Its card
  // grid and its map are surfaces to fill, and a canvas stopping short of its own
  // pane would read as a bug rather than as typography.
  host.classList.toggle("measured", body.classList.contains("centre-editor"));
  host.replaceChildren(trail, heading, tabs, ...(bar ? [bar] : []), body);
  playSettle(host);
  refocusGroupBar(host);
  restoreCardFocus(selectedCards);
}

// --- Group by (the surfacing review's plan item 3) ----------------------------
//
// One segmented control above a card view, in the shape Patterpad's Coverage
// gives its one ordering control (a `.seg` of `.seg-opt` tabs, left-aligned
// above the list it orders; Storyletter's Coverage copies it). One departure,
// argued: a "Group by" label in front. Coverage's options are sentences that
// say what they do ("Least reached first"); these are bare names (Deck, Place,
// npc), and a row of names with no verb reads as a filter, which it is not.
//
// What it groups by is the person's, per box and per page (StudioState
// cardGroups), never the project's. The grouping itself is card-groups.ts.

/** A click on an option redraws the page, which throws the clicked button
 *  away: put the focus back on its successor, so the keyboard carries on from
 *  where it was, as it does on Coverage's control (which repaints in place). */
let groupBarFocus = false;

function groupBar(options: GroupOption[], current: GroupKey, pick: (key: GroupKey) => void): HTMLElement {
  const seg = el("div", { className: "seg groupby-seg" });
  seg.setAttribute("role", "tablist");
  seg.setAttribute("aria-label", "Group by");
  for (const o of options) {
    const on = o.key === current;
    const b = el("button", { className: `seg-opt${on ? " on" : ""}`, text: o.label });
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(on));
    b.dataset["group"] = o.key;
    b.addEventListener("click", () => {
      if (on) return;
      groupBarFocus = b.matches(":focus-visible");
      pick(o.key);
    });
    seg.append(b);
  }
  segmentKeys(seg, [...seg.children] as HTMLElement[], options.findIndex((o) => o.key === current),
    (i) => pick(options[i]!.key), ".groupby .seg-opt.on");
  return el("div", { className: "groupby" }, el("span", { className: "groupby-label", text: "Group by" }), seg);
}

function refocusGroupBar(host: HTMLElement): void {
  if (!groupBarFocus) return;
  groupBarFocus = false;
  host.querySelector<HTMLElement>(".groupby .seg-opt.on")?.focus();
}

interface GroupedOptions {
  page: GroupPage;
  /** The properties a card's condition is checked against, by deck. */
  catalogue: (deck: string) => ConditionProperty[];
  selectedCards: ReadonlySet<string>;
  actions: ViewActions;
  gestures: (e: GroupEntry) => CardGestures;
  menu: (e: GroupEntry) => (ev: MouseEvent) => void;
  /** Reorder within the deck; absent when the view is grouped. */
  move?: (from: string, to: string, before: boolean) => void;
  /** Name each card's deck on its face: a box's Contents mixes decks. */
  showDeck?: boolean;
  /** The "+ New card" ghost, at the end of the last group. */
  ghost?: () => HTMLElement;
}

/** The headings and their grids. A `none` grouping is one grid, no heading. */
function groupedCards(box: BoxDto, groups: CardGroup[], o: GroupedOptions): HTMLElement[] {
  const also = alsoUnder(groups);
  const out: HTMLElement[] = [];
  if (groups.length === 0 && o.ghost) out.push(el("div", { className: "cards" }, o.ghost()));
  groups.forEach((g, i) => {
    if (g.label !== "") out.push(groupHead(box, g, o.actions, o.page));
    const grid = el("div", { className: "cards" });
    for (const e of g.entries) {
      const others = also(e.card.id, g.key);
      const face = cardFace(e.card, o.catalogue(e.deck.id), o.selectedCards.has(e.card.id), o.gestures(e), o.menu(e), {
        ...(others.length > 0 ? { also: others } : {}),
        ...(o.showDeck === true ? { deck: e.deck.title ?? e.deck.gameId, ...(e.deck.colour !== undefined ? { deckColour: e.deck.colour } : {}) } : {}),
        drag: o.move !== undefined,
      });
      if (o.move) wireDrop(face, e.card.id, "x", o.move);
      grid.append(face);
    }
    if (o.ghost && i === groups.length - 1) grid.append(o.ghost());
    out.push(grid);
  });
  return out;
}

/** One heading: its name (a way to the deck or the place, when it is one), a
 *  quiet word after it, and how many cards are under it. */
function groupHead(box: BoxDto, g: CardGroup, actions: ViewActions, page: GroupPage): HTMLElement {
  const go = g.go;
  const name = go === undefined
    ? el("span", { className: "gb-name", text: g.label })
    : el("button", {
        className: "linkbtn gb-name",
        text: g.label,
        tip: go.kind === "deck" ? "Open this deck" : go.kind === "hand" ? "Open this hand" : "Group by it instead",
        onClick: () => {
          if (go.kind === "deck") actions.focus({ kind: "deck", box: box.id, deck: go.deck });
          else if (go.kind === "hand") actions.openHand(box.id, go.hand);
          else actions.setCardGroup(box.id, page, go.key);
        },
      });
  return el("div", { className: `gb-head${g.rest ? " rest" : ""}` },
    // A site's heading wears its pin, in its box's colour, on a box on the map.
    ...(go?.kind === "hand" && box.usesMap === true ? [boxPin(box.id)] : []),
    name, ...groupTail(g));
}

/** What follows a group's name, on the grid and in the table alike: its quiet
 *  word, and how many cards are under it. */
const groupTail = (g: CardGroup): HTMLElement[] => [
  ...(g.sub !== undefined ? [el("span", { className: "gb-sub", text: g.sub })] : []),
  el("span", { className: "gb-n", text: String(g.entries.length) }),
];

/** The node view's container. views.ts draws DOM and never talks to main, so the
 *  canvas is mounted by the action once the deck's links have been fetched. */
function nodeHost(deck: DeckDto, actions: ViewActions): HTMLElement {
  const host = el("div", { className: "nodeview" });
  actions.mountNodeView(host, deck);
  return host;
}

function deckTable(
  box: BoxDto, deck: DeckDto, catalogue: ConditionProperty[], selectedCards: ReadonlySet<string>, gestures: CardGestures,
  /** Absent when grouped: only the deck's own order reorders. */
  move: ((from: string, to: string, before: boolean) => void) | undefined,
  actions: ViewActions,
  groups: CardGroup[] = [{ key: "all", label: "", entries: deck.cards.map((card) => ({ card, deck })) }],
): HTMLElement {
  const table = el("table", { className: "ctable" });
  // The card's own data (mirrors the card face), not the recessive ranking
  // machinery (priority / redraw / outcomes live on the card's own page).
  // Where and Tags are DIFFERENT answers and shared one column: the audit
  // read a card's home hand under "TAGS" and learned a false model (that
  // placement is a tag). Where = the home group plus every place axis of the
  // box (ops place-axis.ts), the same rule the card's own Where sentence uses
  // (where.ts).
  const cols = ["", "Title", "Game ID", "When", "Where", "Tags", ""];
  table.append(tableHead(cols));
  const axes = placeGroupsOf(box);
  const isPlace = (group: string): boolean => group === PLACE_GROUP || axes.has(group);
  const body = el("tbody");
  const also = alsoUnder(groups);
  const rows: HTMLElement[] = [];
  for (const g of groups) {
    // A heading row per group, spanning the table: the table's version of the
    // grid's headings, so the two views of a deck group the same way.
    if (g.label !== "") {
      const th = el("th", {}, el("span", { className: "gb-name", text: g.label }), ...groupTail(g));
      th.colSpan = cols.length;
      body.append(el("tr", { className: `ct-group${g.rest ? " rest" : ""}` }, th));
    }
    for (const { card: c } of g.entries) {
      const others = also(c.id, g.key);
      const where = c.tags.filter((m) => isPlace(m.group)).flatMap((m) => m.values).join(", ");
      const tags = c.tags.filter((m) => !isPlace(m.group)).flatMap((m) => m.values).join(", ");
      const row = el("tr", { className: selectedCards.has(c.id) ? "sel" : "" },
        el("td", { className: "ct-grip" }, ...(move ? [grip()] : [])),
        el("td", { className: "ct-title" }, c.title ?? c.gameId,
          ...(others.length > 0 ? [el("span", { className: "ct-also", text: `also under ${others.join(", ")}` })] : [])),
        el("td", { className: "ct-mono", text: c.gameId }),
        c.condition
          ? el("td", { className: "ct-when" }, el("span", { className: "cardwhen-if", text: "if" }), previewCondition(c.condition, catalogue))
          : el("td", { className: "ct-when ct-dim", text: "always" }),
        el("td", { className: where ? "" : "ct-dim", text: where || "anywhere" }),
        el("td", { className: tags ? "" : "ct-dim", text: tags || "any" }),
        el("td", { className: "ct-open" }, openChip(c.id, gestures)),
      );
      row.dataset["card"] = c.id;
      wireCardGestures(row, c.id, gestures);
      row.addEventListener("contextmenu", cardMenu(box, deck.id, c, actions));
      if (move) wireDrop(row, c.id, "y", move);
      body.append(row);
      rows.push(row);
    }
  }
  // One tab stop; the arrows move the selection with the focus, Enter opens.
  wireRowKeys(rows, {
    open: (r) => gestures.open(r.dataset["card"]!),
    move: (r, how) => gestures.select(r.dataset["card"]!, how),
  });
  table.append(body);
  const wrap = el("div", { className: "ctable-wrap" }, table,
    el("button", { className: "ctable-new", text: "+ New card", onClick: () => actions.newCard(box.id, deck.id) }));
  return wrap;
}

export function renderBoxCentre(
  host: HTMLElement, box: BoxDto,
  tabBody: (bodyHost: HTMLElement, tab: string) => void, actions: ViewActions,
  projectMap?: { users: BoxDto[] },
  /** The selected cards, for the Contents tab's grid. */
  selectedCards: ReadonlySet<string> = new Set(),
): void {
  // The box page: identity heading (title + gameId + purpose) above
  // [Map] | Contents | Dealing | Card template | Hand templates | Tags |
  // Properties. Contents is the box's CONTENT (decks, hands); the rest is its
  // setup, behind this one page (structure rule 10). The box is the trail's root.
  //
  // A box ON THE PROJECT MAP leads with its Map tab, and lands on it: its sites
  // are what that box IS. The tab is this box's sites on the map and a door to
  // the map itself, which is the project's (the surfacing review's plan item
  // 2); the canvas lives on the Map page, once. A box NOT on the map has no Map
  // tab at all, only one quiet line under its purpose: "Use the project map"
  // when there is one, "Make a map" when there is none. One visit to another
  // tab is remembered, so this decides the FIRST answer rather than overriding
  // anybody; a remembered Map tab on a box that has since left the map falls
  // back to Contents rather than to an empty page.
  const restoreCardFocus = keepCardFocus(host);
  const tabKey = `box:${box.id}`;
  const onMap = box.usesMap === true;
  const remembered = currentDocTab(tabKey, onMap ? "map" : "contents");
  const tab = knownTab(actions.project?.(), "box", remembered === "map" && !onMap ? "contents" : remembered, "contents");
  let titled = box.title ?? "";
  let purpose = box.purpose ?? "";
  let pinned = box.gameIdPinned ?? "";
  const heading = documentHeading("Box", {
    title: { get: () => titled, set: (v) => { titled = v; }, placeholder: box.gameId, commitOn: "blur", commit: () => actions.saveBox(box.id, { title: titled }) },
    gameId: { get: () => pinned, set: (v) => { pinned = v; }, fallback: box.gameId, deriveFrom: () => titled, commit: () => actions.saveBox(box.id, { gameId: pinned }) },
    purpose: { get: () => purpose, set: (v) => { purpose = v; }, placeholder: "What this box is for", commit: () => actions.saveBoxLater(box.id, { purpose }) },
    comments: { on: box.id, count: actions.openThreads(box.id), open: (a) => actions.showComments(box.id, titled || box.gameId, a) },
    menu: [
      { label: "Duplicate box", onClick: () => actions.duplicateBox(box.id) },
      // Leaving the map is quiet and rare, so it lives in the menu rather than on
      // the page; main refuses it, with a sentence, while anything still names
      // a zone.
      ...(onMap ? [{ label: "Leave the project map", onClick: () => actions.useProjectMap(box.id, false) }] : []),
      { label: deleteLabel("box"), danger: true, onClick: () => actions.deleteBox(box.id) },
    ],
    // The venue's claim is on the NAME it bound: renaming the box in place lets
    // it go, and the line and the chip's mark go with it rather than standing
    // until the page is re-entered (the hand's fault of 2026-09-07, which this
    // page shares because it shares the heading).
    ...(box.contract !== undefined
      ? {
          contract: box.contract,
          contractHolds: () => (pinned.trim() || gameIdify(titled) || box.gameId) === box.gameId,
        }
      : {}),
  });
  // The opt-in: one quiet line under the purpose, for a box off the map. The
  // map is never advertised more loudly than this, and a box that has no use
  // for one sees nothing else about it.
  const optIn = onMap ? null : el("p", { className: "box-mapline" },
    mapGlyph("map", 12, "map-glyph"),
    projectMap !== undefined
      ? el("button", { className: "linkbtn", text: "Use the project map", tip: "Put this box's hands on the project's zones", onClick: () => actions.useProjectMap(box.id, true) })
      : el("button", { className: "linkbtn", text: "Make a map", tip: "Draw zones for the project, and put this box's hands on them", onClick: () => actions.newMap(box.id) }));
  // Worked out again from the project as it is now when a save lands while the
  // page is being edited (recountDocTabs), so a count never waits for a redraw.
  const boxSpecs = (): DocTabSpec[] => {
    const now = actions.project?.()?.boxes.find((b) => b.id === box.id) ?? box;
    return [
      ...(onMap ? [{ key: "map", label: "Map" }] : []),
      { key: "contents", label: "Contents" },
      { key: "dealing", label: "Dealing" },
      // Both halves of the template count (2026-09-13). The tab holds two lists
      // now - card fields and outcome fields - and a count of only the first
      // would draw a dimmed "0", which docTabs teaches as EMPTY, on a tab that
      // has content. A number that answers "is there anything in here" is worth
      // more here than one that answers "how many card fields".
      { key: "template", label: "Card template", count: now.fields.length + now.outcomeFields.length },
      { key: "templates", label: "Hand templates", count: now.templates.length },
      { key: "tags", label: "Tags", count: now.tagGroups.length },
      { key: "properties", label: "Properties", count: now.properties.length },
      ...extensionTabs(actions.project?.(), "box", box.id),
    ];
  };
  const tabs = docTabs(boxSpecs(), tab, (next) => { setDocTab(tabKey, next); actions.focus({ kind: "box", box: box.id }); }, boxSpecs);

  let body: HTMLElement;
  if (tab === "templates") {
    body = boxTemplatesBody(box, actions);
  } else if (tab === "tags") {
    body = boxTagsBody(box, actions, projectMap === undefined);
  } else if (tab === "map") {
    // This box's sites on the project map, and the door to it. The sites are
    // filled by map-page.ts (they need IPC, which views.ts never touches).
    const others = (projectMap?.users ?? []).filter((b) => b.id !== box.id);
    const intro = el("p", { className: "doc-tab-note" }, "The zones are the project's, drawn once",
      ...(others.length > 0 ? [", and shared with ", ...others.flatMap((b, i) => [...(i > 0 ? [" "] : []), boxChip(b)])] : []),
      ". Where this box's hands lie on them is its own.");
    const sites = el("div", { className: "rowlist boxsites" });
    actions.mountBoxSites(sites, box);
    body = el("div", { className: "doc-sect" },
      el("div", { className: "doc-panel boxsites-head" },
        el("div", { className: "boxsites-title" },
          el("span", { className: "insp-label", text: "This box's hands on the project map" }),
          el("span", { className: "crumb-spacer" }),
          el("button", { className: "btn primary", onClick: () => actions.openMap() }, mapGlyph("map", 13, "map-glyph"), "Open map")),
        intro),
      sites);
  } else if (tab !== "contents") {
    body = el("div", { className: "centre-editor" });
    tabBody(body, tab);
  } else {
    const list = el("div", { className: "rowlist" });
    const row = (label: string, count: number, sub: string, kind: "decks" | "hands"): void => {
      list.append(el("button", { className: "listrow", onClick: () => actions.focus({ kind, box: box.id }) },
        el("span", { className: "listname", text: label }),
        listMeta([String(count), sub])));
    };
    row("Decks", box.decks.length, "The box's cards, deck by deck.", "decks");
    // B3: the SAME sentence the Hands master uses, and the accurate one. This
    // row used to say hands "own cards", which is the misconception the model
    // most needs to avoid: a deck owns cards, a hand owns what it was DEALT.
    // Two definitions forty lines apart, and the wrong one came first.
    row("Hands", box.hands.length, "Where cards are dealt on the board. Each hand holds the cards it's dealt.", "hands");
    // Named here so a box says what it HAS. Only when it is on the map: a box
    // off it is offered the map once, under its purpose, and a contents list
    // that advertises what is absent is a different job.
    if (onMap) {
      list.append(el("button", { className: "listrow", onClick: () => { setDocTab(tabKey, "map"); actions.focus({ kind: "box", box: box.id }); } },
        el("span", { className: "listname", text: "Map" }),
        listMeta(["This box's hands on the project map"])));
    }
    // Then the box's cards themselves, grouped (plan item 3): by deck until the
    // author chooses otherwise, or by place, or by any of the box's tag groups.
    const entries = boxEntries(box);
    if (entries.length === 0) {
      body = list;
    } else {
      const by = resolveGroup(box, "contents", actions.cardGroup(box.id, "contents"));
      const groups = groupEntries(box, entries, by);
      body = el("div", { className: "doc-sect box-contents" }, list,
        groupBar(groupOptions(box, "contents"), by, (key) => actions.setCardGroup(box.id, "contents", key)),
        el("div", { className: "gb-body" }, ...groupedCards(box, groups, {
          page: "contents", catalogue: (d) => actions.deckCatalogue(box.id, d), selectedCards, actions,
          gestures: (e) => ({
            select: (card, how) => actions.selectCard(card, how),
            open: (card) => actions.inspectCard(box.id, e.deck.id, card),
          }),
          menu: (e) => cardMenu(box, e.deck.id, e.card, actions),
          // Under Deck the heading names it; under anything else the card does.
          showDeck: by !== "deck",
        })));
    }
  }
  host.replaceChildren(heading, ...(optIn ? [optIn] : []), tabs, body);
  refocusGroupBar(host);
  restoreCardFocus(selectedCards);
}

// The box's setup tabs: hand templates and tags list here (behind the box
// page, like the card template); each item opens its own centre document.

function boxTemplatesBody(box: BoxDto, actions: ViewActions): HTMLElement {
  const list = el("div", { className: "rowlist" });
  for (const t of box.templates) {
    const row = el("button", { className: "listrow", onClick: () => actions.inspectTemplate(box.id, t.id) },
      el("span", { className: "listname", text: t.gameId }),
      listMeta([t.bindings.join(", ") || "pulls the whole stock", /^\d+$/.test(t.slots) ? plural(Number(t.slots), "slot") : `${t.slots} slots`]),
      el("span", { className: "listmeta", text: `${plural(t.instances, "instance")}` }));
    row.dataset["vc"] = vcKeys.hands(box.id);
    row.addEventListener("contextmenu", itemMenu("hand template", () => actions.duplicateTemplate(box.id, t.id), () => actions.deleteTemplate(box.id, t.id)));
    list.append(row);
  }
  list.append(el("button", { className: "listrow ghost", text: "+ New hand template", onClick: () => actions.newTemplate(box.id) }));
  const body = el("div", { className: "doc-sect" },
    // B4: was "Declared kinds of hand: shared bindings and logic, instanced by
    // hands" - six format terms in the one document a narrative designer has no
    // prior model for. The Copies row is the voice to match: a rule and a reason,
    // no jargon.
    el("p", { className: "doc-tab-note", text: "A kind of hand. Write the rule once and every hand of this kind follows it, filling in its own choices." }),
    list);
  // This tab of the box page writes the HANDS shard, not the box shard, so it
  // takes its read-only state from there (see applyDoc in vc-view.ts).
  body.dataset["vcScope"] = vcKeys.hands(box.id);
  return body;
}

function boxTagsBody(box: BoxDto, actions: ViewActions, canMakeMap: boolean): HTMLElement {
  const list = el("div", { className: "rowlist" });
  for (const group of box.tagGroups) {
    const row = el("button", { className: "listrow", onClick: () => actions.inspectTagGroup(box.id, group.id) },
      el("span", { className: "listname", text: group.gameId }),
      // Quiet, and only when it is true: a group that is a map is worth saying so
      // where the groups are listed, since the Map tab is the consequence.
      group.spatial ? el("span", { className: "listmeta", text: "map" }) : null,
      el("div", { className: "chips" }, ...group.values.map(chip)));
    row.dataset["vc"] = vcKeys.tags(box.id);
    row.addEventListener("contextmenu", itemMenu("tag group", () => actions.duplicateTagGroup(box.id, group.id), () => actions.deleteTagGroup(box.id, group.id)));
    list.append(row);
  }
  list.append(el("button", { className: "listrow ghost", text: "+ New tag group", onClick: () => actions.newTagGroup(box.id) }));
  // A second door to the same room. A map IS a tag group, and an author who wants
  // one should not have to know that before they can make one: until this, the
  // word "map" appeared nowhere in the editor until after you had made one
  // (design/maps-discoverability.md). It sits here, next to the thing it makes,
  // so the relationship is visible in the act rather than hidden by it. Only
  // while the project has no map: a project has one, and a box joins it from
  // the line under its purpose instead.
  if (canMakeMap) list.append(el("button", { className: "listrow ghost", text: "+ New map", onClick: () => actions.newMap(box.id) }));
  const body = el("div", { className: "doc-sect" },
    // B5: one sentence, used on all three tag surfaces, naming both jobs. "Peeks"
    // was engine vocabulary that appears nowhere else an author can see.
    el("p", { className: "doc-tab-note", text: "Tags file a card. Hands deal by them, and each tag keeps its own colour so you can scan a deck." }),
    list);
  body.dataset["vcScope"] = vcKeys.tags(box.id);   // this tab writes the TAGS shard
  return body;
}

/** Right-click Duplicate / Delete, the same pair every item row offers (F5).
 *  The delete names its object, and reports with Undo rather than asking
 *  first (deletes.ts), so it has no ellipsis. */
const itemMenu = (noun: string, duplicate: () => void, remove: () => void) => (e: MouseEvent): void => {
  e.preventDefault();
  openContextMenu(e.clientX, e.clientY, [
    { label: "Duplicate", onClick: duplicate },
    { label: deleteLabel(noun), danger: true, onClick: remove },
  ]);
};

/** The master pages' shared heading: overline = the box (masters have no
 *  crumb, so this is their context), title = the node name, optional subtitle
 *  and a right-hand slot for the view toggle (F3). */
function masterHeading(boxRef: { id: string; label: string }, title: string, actions: ViewActions, sub?: string, right?: HTMLElement): HTMLElement {
  const wrap = el("div", { className: "master-head" });
  wrap.append(crumbTrail([{ label: boxRef.label, go: () => actions.focus({ kind: "box", box: boxRef.id }) }], right ?? null));
  const head = el("div", { className: "doc-head" },
    el("h2", { className: "collection-title", text: title }),
    sub ? el("p", { className: "master-sub", text: sub }) : null);
  wrap.append(head);
  return wrap;
}

/** The decks master: the grid / table of the box's decks, with the add row. */
export function renderDecksCentre(host: HTMLElement, box: BoxDto, mode: ViewMode, actions: ViewActions): void {
  // B2: the deck-versus-hand pair lives on the box's Contents tab, and a box
  // with places on it opens on its Map instead (rule 12a) and never shows it.
  // The two masters have subtitle slots, so the distinction survives wherever
  // the box lands.
  const head = masterHeading({ id: box.id, label: box.title ?? box.gameId }, "Decks", actions, "The box's cards, deck by deck.", viewToggle(mode, actions));
  // Reorder here, not in the nav: the master owns arrangement, like cards.
  const move = (from: string, to: string, before: boolean): void => actions.moveDeck(box.id, from, to, before);
  let body: HTMLElement;
  if (mode === "table") {
    const table = el("table", { className: "ctable" });
    table.append(tableHead(["", "Deck", "Game ID", "Cards", "Design note"]));
    const tbody = el("tbody");
    for (const deck of box.decks) {
      const nameCell = el("td", { className: "ct-title", text: deck.title ?? deck.gameId });
      nameCell.dataset["vc"] = vcKeys.deck(deck.id);   // the badge rides the cell, not the <tr>
      const row = el("tr", {},
        el("td", { className: "ct-grip" }, grip()),
        nameCell,
        el("td", { className: "ct-mono", text: deck.gameId }),
        el("td", { className: "ct-mono", text: String(deck.cards.length) }),
        el("td", { text: deck.purpose ?? "" }),
      );
      row.dataset["deck"] = deck.id;
      row.addEventListener("click", () => actions.focus({ kind: "deck", box: box.id, deck: deck.id }));
      row.addEventListener("contextmenu", itemMenu("deck", () => actions.duplicateDeck(box.id, deck.id), () => actions.deleteDeck(box.id, deck.id)));
      wireDrop(row, deck.id, "y", move);
      tbody.append(row);
    }
    // One tab stop, the arrows between rows, Enter opens the deck as a click does.
    wireRowKeys([...tbody.querySelectorAll<HTMLElement>("tr")], { open: (r) => actions.focus({ kind: "deck", box: box.id, deck: r.dataset["deck"]! }) });
    table.append(tbody);
    body = el("div", { className: "ctable-wrap" }, table,
      el("button", { className: "ctable-new", text: "+ New deck", onClick: () => actions.newDeck(box.id) }));
  } else {
    body = el("div", { className: "deck-grid" });
    for (const deck of box.decks) {
      const face = el("button", { className: "deck-card", onClick: () => actions.focus({ kind: "deck", box: box.id, deck: deck.id }) },
        el("h3", { text: deck.title ?? deck.gameId }),
        el("span", { className: "sub", text: plural(deck.cards.length, "card") }),
        deck.purpose ? el("p", { className: "beat", text: deck.purpose }) : null);
      face.dataset["vc"] = vcKeys.deck(deck.id);
      face.addEventListener("contextmenu", itemMenu("deck", () => actions.duplicateDeck(box.id, deck.id), () => actions.deleteDeck(box.id, deck.id)));
      face.append(grip());
      wireDrop(face, deck.id, "x", move);
      body.append(face);
    }
    body.append(el("button", { className: "deck-card ghost", text: "+ New deck", onClick: () => actions.newDeck(box.id) }));
  }
  host.replaceChildren(head, body);
  playSettle(host);
}

/** What the file manager is CALLED here, since "Show in Finder" on Windows
 *  names something the reader has never seen (Patterpad's wording, both ways). */
export const revealTip = (): string =>
  (navigator.platform.toUpperCase().includes("MAC") ? "Show in Finder" : "Show in file manager");

/** The project's own page: the boxes, listed and arranged like any master
 *  (and the home for box add / duplicate / delete). */
export function renderProjectCentre(host: HTMLElement, project: ProjectDto, actions: ViewActions): void {
  const head = el("div", { className: "master-head" },
    el("div", { className: "doc-head" },
      el("div", { className: "doc-topline" },
        el("span", { className: "insp-label", text: "Project" }),
        // A More button opens a menu, as it does on every other document: it
        // used to open Project settings directly, under a native tooltip that
        // said so and a themed one that said "More".
        moreMenu([
          { label: "Project settings\u2026", onClick: () => actions.openProjectSettings() },
          { label: revealTip(), onClick: () => actions.revealProject() },
        ])),
      el("h2", { className: "collection-title", text: project.name }),
      // WHERE this project is, which is the only thing that tells two copies of
      // the same name apart. Patterpad's overview carries the same line, in the
      // same place and with the same click-to-reveal; the topbar name's tooltip
      // is the other half, so the answer is one hover away from any page.
      el("button", { className: "pdir", text: project.dir, tip: revealTip(), onClick: () => actions.revealProject() }),
      el("p", { className: "master-sub", text: "Each box is a self-contained set of decks, hands, and tags." })));
  const list = el("div", { className: "rowlist" });
  const move = (from: string, to: string, before: boolean): void => actions.moveBox(from, to, before);
  for (const box of project.boxes) {
    const cards = box.decks.reduce((n, d) => n + d.cards.length, 0);
    const row = el("button", { className: "listrow draggable", onClick: () => actions.focus({ kind: "box", box: box.id }) },
      el("span", { className: "listname listtitle", text: box.title ?? box.gameId }),
      listMeta([plural(box.decks.length, "deck"), plural(cards, "card"), plural(box.hands.length, "hand")]));
    row.dataset["vc"] = vcKeys.box(box.id);
    row.addEventListener("contextmenu", itemMenu("box", () => actions.duplicateBox(box.id), () => actions.deleteBox(box.id)));
    row.append(grip());
    wireDrop(row, box.id, "y", move);
    list.append(row);
  }
  list.append(el("button", { className: "listrow ghost", text: "+ New box", onClick: () => actions.newBox() }));
  host.replaceChildren(head, list);
  playSettle(host);
}

/** Hands: the places on the board; each holds the cards it is dealt. */
export function renderHandsCentre(host: HTMLElement, box: BoxDto, actions: ViewActions): void {
  const head = masterHeading({ id: box.id, label: box.title ?? box.gameId }, "Hands", actions, "Where cards are dealt on the board. Each hand holds the cards it's dealt.");
  const list = el("div", { className: "rowlist" });
  for (const hand of box.hands) {
    // "standalone": the one name for a hand with its own rule, as the hand's
    // own Template choice and Find say it.
    const kind = hand.template !== undefined ? hand.template : "standalone";
    // A titled hand reads as a title; only a bare gameId reads as a name.
    const row = el("button", { className: "listrow draggable", onClick: () => actions.openHand(box.id, hand.id) },
      el("span", { className: `listname${hand.title !== undefined ? " listtitle" : ""}`, text: hand.title ?? hand.gameId }),
      listMeta([kind, hand.slots !== undefined ? plural(hand.slots, "slot") : undefined]));
    // Every hand lives in the one hands shard, so they badge together.
    row.dataset["vc"] = vcKeys.hands(box.id);
    // A hand's evidence is its pin, which only the map knows: actions.ts asks
    // it, so the label promises a question wherever there could be one.
    row.addEventListener("contextmenu", itemMenu("hand", () => actions.duplicateHand(box.id, hand.id), () => actions.deleteHand(box.id, hand.id)));
    row.append(grip());
    wireDrop(row, hand.id, "y", (from, to, before) => actions.moveHand(box.id, from, to, before));
    list.append(row);
  }
  list.append(el("button", { className: "listrow ghost", text: "+ New hand", onClick: () => actions.newHand(box.id) }));
  host.replaceChildren(head, list);
  playSettle(host);
}

// --- problems bar -------------------------------------------------------------

export function renderProblems(
  host: HTMLElement,
  problems: Problem[],
  at: number,
  onStep: (next: number) => void,
  onJump: (p: Problem) => void,
  onFix: (p: Problem, fix: NonNullable<Problem["fix"]>, anchor: HTMLElement) => void,
  /** The names the caller can resolve for a problem: the `title` of the thing
   *  it is about (the sentence names it) and the `where` it sits in (the bar's
   *  mono segment): the audit read storage paths where a person thinks in
   *  names. Undefined falls back to the compiler's own `where`, then the path. */
  namesFor?: (p: Problem) => ProblemNames | undefined,
): void {
  // On demand only (ux-changes v3): no bar when the project is clean.
  //
  // ONE problem at a time, with the count and a pair of steppers, which is
  // Patterpad's problems bar exactly (its index.html: count, prev, next, the
  // current problem as a button, a quick-fix slot). It used to be a header that
  // expanded into a list, and the list was a Storyletter invention that read
  // badly at the size problems usually come in: with one problem, "details"
  // opened a second bar saying the same sentence again. A stepper says how many
  // there are and shows you them one at a time, which is what somebody working
  // through a list of things to fix actually does.
  //
  // STEPPING NAVIGATES, as it does in Patterpad. This comment used to describe
  // the opposite as a deliberate departure - stepping changed only what the bar
  // said, because a jump here swaps the open document where Patterpad merely
  // moves a caret. That was true and still wrong: identical chrome must not mean
  // different things, and a family user pressing the arrow got nothing at all.
  //
  // What made it safe was already in the app twice over. The Board marks without
  // navigating and never steals focus; the review walk navigates because it is a
  // mode you entered. The rule that settles both, and this: an ambient surface
  // moves the VIEW, never the focus, and never over an uncommitted edit. The
  // caller owns that guard (save-queue.ts, `mayStepAway`), because only it knows
  // what is unsaved. See design-language.md and design review 2026-08, A2.
  //
  // THE BAR ITSELF IS THE SHELL'S (app-shell 0.18.0, `renderStepperBar`). Four
  // bars across the two apps are this one shape, and Patterpad drew its two with
  // parallel class sets for one idea. What stays here is what the shell must not
  // know: what a problem is, which of them are errors, and what a quick fix does.
  // The bar clamps `at` itself; the quick fix has to be built from the same
  // entry the bar is about to show, so it clamps to the same place.
  const current = problems[Math.min(Math.max(at, 0), problems.length - 1)];
  // THE SENTENCE IS THE TABLE'S (problem-copy.ts): the compiler's message is
  // written for the shard, and the bar speaks for the author, naming the thing
  // by its title and saying what to do next.
  renderStepperBar(host, {
    items: problems.map((p) => {
      const names = namesFor?.(p);
      return {
        // Capitalised, as Patterpad's category tag is ("Error", not "error").
        kind: p.severity === "error" ? "Error" : "Warning", kindClass: `sev-${p.severity}`,
        where: names?.where ?? p.where ?? p.path,
        text: problemText(p, names),
      };
    }),
    at,
    // The tone follows the CURRENT problem, not the worst one, as Patterpad's
    // does: a warning reads softer than an error while you are standing on it,
    // and an error is in the danger colour in both apps (ruling R, 2026-10).
    tone: current?.severity === "warning" ? "warn" : "danger",
    tips: { prev: "Previous problem", next: "Next problem", go: "Go to issue" },
    onStep,
    onGo: (i) => onJump(problems[i]!),
    actions: [current?.fix ? fixButton(current, current.fix, onFix) : null],
  });
}

/**
 * A human label for a quick-fix: WRITER-SPEAK, no engine jargon.
 *
 * Patterpad's rule and very nearly its words (`fixLabel`, its renderer). A
 * trailing ellipsis is a promise that something will ask before it acts, so it
 * appears on the tag repair and never on the declaration, which just happens.
 */
export function fixLabel(fix: NonNullable<Problem["fix"]>): string {
  if (fix.kind === "declare-property") return `Set up “@${fix.scope}.${fix.name}”`;
  if (fix.kind === "repoint-tag") return "Choose a tag…";
  if (fix.kind === "pick-stage" || fix.kind === "pick-tag-stage") return "Choose a stage…";
  if (fix.kind === "add-outcome") return `Add outcome “${fix.gameId}”`;
  if (fix.kind === "create-scene") return "Create the scene in Patter";
  if (fix.kind === "upgrade-project") return "Upgrade the project";
  return "Fix";
}

function fixButton(
  problem: Problem, fix: NonNullable<Problem["fix"]>,
  onFix: (p: Problem, fix: NonNullable<Problem["fix"]>, anchor: HTMLElement) => void,
): HTMLElement {
  // The shell's chip (stepper.css `.stepbar-action`): Patterpad's `.problem-fix`
  // and this bar's `.problembar-fix` were one rule twice.
  const button = el("button", {
    className: "stepbar-action", text: fixLabel(fix),
    tip: fix.kind === "declare-property" ? "Declare it, then take me to it"
      : fix.kind === "add-outcome" ? "Give this card the outcome its Patter scene names, then open it"
      : fix.kind === "create-scene" ? "Write a stub scene for this card into the Patter project, one option per outcome, then open it in Patterpad"
      : fix.kind === "upgrade-project" ? "Move this project onto the project map, as one step you can undo"
      : "Point this at a tag that exists",
  });
  button.addEventListener("click", () => onFix(problem, fix, button));
  return button;
}


/**
 * The Review Feedback bar: the same bar as the problems bar, carrying comments.
 *
 * Patterpad's walk (its Review menu, F8 / Shift+F8, a looping bottom bar with a
 * count) drawn from the shell's stepper, because this app already had a bottom
 * bar and two that looked different would be two grammars for one idea. That
 * reasoning is what sent the bar to the shell in the end (design review 2026-08,
 * section 5 item 2): Patterpad maintains a parallel `.reviewbar-*` class set for
 * the shape its problems bar already has, and now need not.
 *
 * THE ONE DIFFERENCE from the problems bar beside it is no longer in the
 * drawing, since they share it: it is that this bar is a MODE. It stays up when
 * the walk finds nothing, where the ambient bar hides itself, and it carries a
 * way out. Both step and both navigate; what an ambient surface may not do is
 * take the FOCUS, which is the caller's guard either way.
 */
export function renderReviewBar(
  host: HTMLElement,
  items: ReviewItemDto[],
  at: number,
  on: boolean,
  onStep: (next: number) => void,
  onGo: (item: ReviewItemDto) => void,
  onClose: () => void,
): void {
  if (!on) { host.hidden = true; host.replaceChildren(); return; }
  renderStepperBar(host, {
    items: items.map((item) => ({
      kind: item.resolved === true ? "Resolved" : (item.canvas !== undefined ? "Marker" : "Comment"),
      kindClass: item.resolved === true ? "done" : undefined,
      where: item.where,
      text: `${item.author}: ${item.text}`,
    })),
    at,
    tone: "accent",
    tips: { prev: tipWithKey("Previous feedback", "Shift+F8"), next: tipWithKey("Next feedback", "F8"), go: "Go to this feedback" },
    onStep,
    onGo: (i) => onGo(items[i]!),
    // An EMPTY walk still shows its bar. Entering the mode and seeing nothing at
    // all would read as a broken command rather than as "there is no feedback",
    // which is exactly the difference `empty` encodes in the shell's bar.
    empty: "No open comments.",
    onClose,
    closeTip: "Exit review feedback",
  });
}
