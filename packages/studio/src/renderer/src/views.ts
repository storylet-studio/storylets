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

import { icon, renderStepperBar } from "@wildwinter/app-shell";
import { PLACE_GROUP } from "@storylet-studio/model";
import { el } from "./dom.js";
import { colourIndex } from "../../shell/colour.js";
import { previewCondition } from "./expr-panels.js";
import { openContextMenu } from "./context-menu.js";
import { currentDocTab, docTabs, documentHeading, setDocTab } from "./inspector.js";
import type { BoxDto, BoxEdit, CardDto, ConditionProperty, DeckDto, Problem, ProjectDto, ReviewItemDto, ViewMode } from "../../shared/api.js";

/** What the centre shows + the nav highlight. Which tab a document is on is
 *  the document's own state (inspector.ts docTabState), not a focus kind.
 *  Hand templates and tags are box SETUP: they live as tabs on the box's
 *  page (like the card template), never as focus kinds or nav rows. */
export type Focus =
  | { kind: "project"; box?: undefined }
  | { kind: "story"; box?: undefined }
  | { kind: "box"; box: string }
  | { kind: "decks"; box: string }
  | { kind: "deck"; box: string; deck: string }
  | { kind: "hands"; box: string };

export interface ViewActions {
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
  saveDeck(deckId: string, edit: { title?: string; gameId?: string; purpose?: string }): void;
  saveBox(boxId: string, edit: BoxEdit): void;
  newCard(box: string, deck: string): void;
  newDeck(box: string): void;
  newBox(): void;
  newTemplate(box: string): void;
  newTagGroup(box: string): void;
  newHand(box: string): void;
  editBox(box: string): void;
  duplicateBox(box: string): void;
  deleteBox(box: string): void;
  duplicateCard(box: string, deck: string, card: string): void;
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
  selectCard(card: string, extend: boolean): void;
  setViewMode(mode: ViewMode): void;
  /** Fill a node-view container: fetch the deck's links, then mount the canvas.
   *  Owned by the renderer because views.ts never touches IPC. */
  mountNodeView(host: HTMLElement, deck: DeckDto): void;
  /** Fill the box's Map tab: fetch the zones and pins, then mount the canvas. */
  mountMapView(host: HTMLElement, box: BoxDto): void;
  moveCard(box: string, deck: string, card: string, target: string, before: boolean): void;
  moveBox(box: string, target: string, before: boolean): void;
  moveDeck(box: string, deck: string, target: string, before: boolean): void;
  moveHand(box: string, hand: string, target: string, before: boolean): void;
}

// --- card drag-reorder (Patterpad's model: dragstart / dragover-mark / drop) --
let dragCardId: string | null = null;
const clearDropMarks = (host: HTMLElement): void =>
  host.querySelectorAll(".drop-before, .drop-after").forEach((e) => e.classList.remove("drop-before", "drop-after"));

/** Make an element a drag source + drop target for card reordering. `axis`
 *  picks the midpoint test: "y" for table rows, "x" for the wrapping card grid. */
function wireCardDrag(el: HTMLElement, cardId: string, axis: "x" | "y", onMove: (from: string, to: string, before: boolean) => void): void {
  el.draggable = true;
  el.dataset["card"] = cardId;
  const host = (): HTMLElement => el.parentElement as HTMLElement;
  el.addEventListener("dragstart", (e) => {
    dragCardId = cardId; el.classList.add("dragging");
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", cardId); }
  });
  el.addEventListener("dragend", () => { dragCardId = null; el.classList.remove("dragging"); clearDropMarks(host()); });
  el.addEventListener("dragover", (e) => {
    if (!dragCardId || dragCardId === cardId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const r = el.getBoundingClientRect();
    const before = axis === "y" ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2;
    clearDropMarks(host());
    el.classList.add(before ? "drop-before" : "drop-after");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    const before = el.classList.contains("drop-before");
    clearDropMarks(host());
    if (dragCardId && dragCardId !== cardId) onMove(dragCardId, cardId, before);
  });
}
const grip = (): HTMLElement => el("span", { className: "cardgrip", text: icon.grip, tip: "Drag to reorder" });

/** The view-mode switch, shown top-right of a centre head. Node is offered only
 *  where there is one (a deck): the mode is remembered across pages, so a page
 *  that cannot draw a canvas shows the two it has and treats node as cards,
 *  rather than lighting a button whose view is not there. */
function viewToggle(active: ViewMode, actions: ViewActions, withNode = false): HTMLElement {
  const shown: ViewMode = !withNode && active === "node" ? "cards" : active;
  const btn = (mode: ViewMode, glyph: string, title: string): HTMLElement => {
    const b = el("button", { className: `viewbtn${shown === mode ? " on" : ""}`, text: glyph, tip: title });
    b.addEventListener("click", () => { if (shown !== mode) actions.setViewMode(mode); });
    return b;
  };
  return el("div", { className: "viewtoggle" },
    // From the icon table (app-shell 0.17.0), named by what you get rather than
    // by the glyph, so a second app picks the same three without copying
    // somebody's taste in symbols.
    btn("cards", icon.viewCards, "Card view"),
    btn("table", icon.viewTable, "Table view"),
    withNode ? btn("node", icon.viewNode, "Node view") : null);
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
 * that job and names its destination ("‹ Arrival").
 *
 * Callers still pass the whole ancestor path, because the LAST segment is the
 * back target, and because keeping the path here means the trail could come back
 * as one line if the navigator is ever hidden by default.
 */
/**
 * Where the author came from, when that is NOT this page's parent.
 *
 * Up and back are two moves that coincide almost always: a card opened from its
 * deck goes up and back to the same place. They diverge when you arrive SIDEWAYS -
 * a zone opened from the map, a card from Find or from Links - and going up then
 * lands you somewhere you have never been (structure rule 12, amended).
 *
 * Module state rather than a parameter threaded through every page: the renderer
 * owns navigation and sets this as it navigates, and the alternative was four call
 * sites and their tests carrying something none of them decide.
 */
let cameFrom: { label: string; go: () => void } | undefined;
export function setCameFrom(from: { label: string; go: () => void } | undefined): void {
  cameFrom = from;
}


export function crumbTrail(segments: { label: string; go: () => void }[], ...right: (Node | null)[]): HTMLElement {
  const bar = el("div", { className: "crumbs" });
  const up = segments[segments.length - 1];
  if (up) {
    bar.append(el("button", {
      className: "crumb-back", text: `‹ ${up.label}`,
      tip: `Back to ${up.label} (Esc)`, onClick: up.go,
    }));
  }
  // The way back to where you actually came from, when that is somewhere else. It
  // reads differently from the parent on purpose: two left chevrons side by side
  // would be one control wearing two labels. No keyboard shortcut until somebody
  // wants one - Esc keeps meaning "up", which is the move with four routes to it.
  if (cameFrom) {
    const back = cameFrom;
    bar.append(el("button", {
      className: "crumb-return", text: `↩ ${back.label}`,
      tip: `Back to ${back.label}`, onClick: back.go,
    }));
  }
  bar.append(el("span", { className: "crumb-spacer" }));
  for (const r of right) if (r) bar.append(r);
  return bar;
}

/** The container page's [Content | Settings] tab bar (title sits above it). */

export function chipDot(name: string): HTMLElement {
  const dot = el("i");
  dot.style.background = `var(--char-${colourIndex(name)})`;
  return dot;
}
export const chip = (name: string): HTMLElement => el("span", { className: "chip" }, chipDot(name), name);

// --- navigator ----------------------------------------------------------------

/** The shard key(s) whose version-control state an item shows (see
 *  ShardVcDto in shared/api.ts). Space-separated when an item spans shards:
 *  a box row stands for its box + tags + hands shards, so its badge folds all
 *  three. Rows carry them as `data-vc`; the renderer paints the badges by
 *  walking that attribute, so a poll can re-badge without re-rendering (and
 *  without disturbing a document mid-edit). */
export const vcKeys = {
  project: "project",
  /** A box row: everything the box itself owns (its decks badge separately). */
  box: (boxId: string): string => `box:${boxId} tags:${boxId} hands:${boxId}`,
  boxShard: (boxId: string): string => `box:${boxId}`,
  tags: (boxId: string): string => `tags:${boxId}`,
  hands: (boxId: string): string => `hands:${boxId}`,
  deck: (deckId: string): string => `deck:${deckId}`,
};

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
  const row = (opts: {
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
  }): HTMLElement => {
    const b = el("button", { className: `nav-row nav-d${opts.depth}${opts.sel ? " sel" : ""}${opts.path ? " on-path" : ""}${opts.cls ? ` ${opts.cls}` : ""}`, onClick: opts.onClick, ...(opts.tip !== undefined ? { tip: opts.tip } : {}) });
    if (opts.vc) b.dataset["vc"] = opts.vc;
    if (opts.node) {
      const id = opts.node;
      const chev = el("span", { className: `nav-chev${expanded.has(id) ? " open" : ""}` });
      chev.addEventListener("click", (e) => { e.stopPropagation(); actions.toggleNav(id); });
      b.append(chev);
    } else {
      b.append(el("span", { className: "nav-chev-space" }));
    }
    b.append(el("span", { className: "nav-label", text: opts.label }));
    if (opts.count !== undefined) b.append(el("span", { className: "nav-n", text: String(opts.count) }));
    return b;
  };
  // The project's own row: no page, so it opens the Settings dialog directly.
  // The project's own row opens its page (the boxes master); Settings
  // lives on that page's menu and under Cmd+, as before.
  const projectRow = el("button", { className: `nav-project${focus?.kind === "project" ? " sel" : ""}`, text: project.name, onClick: () => actions.focus({ kind: "project" }) });
  projectRow.dataset["vc"] = vcKeys.project;
  host.replaceChildren(projectRow);

  // The story's own state, first-class in the navigator (the author's ruling,
  // 2026-08-26). @story is the designers' working vocabulary, touched daily and
  // grown with content; hiding its one editing home in a modal dialog treated
  // it like configuration. @world STAYS in Project Settings, because it is the
  // other thing: a contract with the game, set by the principal designer.
  host.append(row({
    depth: 0, label: "Story", cls: "nav-storyrow", vc: vcKeys.project,
    tip: "The story's own memory: state the cards read and write (@story).",
    count: project.storyPropertyCount,
    sel: focus?.kind === "story",
    onClick: () => actions.focus({ kind: "story" }),
  }));

  for (const box of project.boxes) {
    const inBox = focus?.box === box.id;
    const boxNode = navId.box(box.id);
    const boxRow = row({
      depth: 0, label: box.title ?? box.gameId, node: boxNode, cls: "nav-boxrow", vc: vcKeys.box(box.id),
      tip: "A box: a self-contained set of decks, hands and tags.",
      sel: inBox && focus.kind === "box",
      path: inBox && focus.kind !== "box",
      onClick: () => actions.focus({ kind: "box", box: box.id }),
    });
    boxRow.addEventListener("contextmenu", itemMenu(() => actions.duplicateBox(box.id), () => actions.deleteBox(box.id)));
    host.append(boxRow);
    if (!expanded.has(boxNode)) continue;

    // The nav stops at containers and collections, and carries CONTENT only:
    // Decks and Hands. Setup (hand templates, tags) lives behind the box's
    // own page as tabs, exactly like the card template (structure rule 8).
    type CKind = "decks" | "hands";
    const collection = (label: string, kind: CKind, count: number, fill?: () => void): void => {
      const node = navId.collection(box.id, kind);
      host.append(row({
        depth: 1, label, ...(fill ? { node } : {}), count,
        // The same sentence the Hands master and the box page use (B3): the
        // one line that unlocks the model, at the point of first contact.
        ...(kind === "hands" ? { tip: "Hands: the places on the board; each holds the cards it is dealt." } : {}),
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
          depth: 2, label: deck.title ?? deck.gameId, count: deck.cards.length, vc: vcKeys.deck(deck.id),
          sel: here,
          onClick: () => actions.focus({ kind: "deck", box: box.id, deck: deck.id }),
        });
        deckRow.addEventListener("contextmenu", itemMenu(() => actions.duplicateDeck(box.id, deck.id), () => actions.deleteDeck(box.id, deck.id)));
        host.append(deckRow);
      }
      host.append(el("button", { className: "nav-add nav-d2", text: "+ deck", onClick: () => actions.newDeck(box.id) }));
    });

    collection("Hands", "hands", box.hands.length);

  }

  host.append(el("button", { className: "nav-add nav-add-box nav-d0", text: "+ New box", onClick: () => actions.newBox() }));
}

/**
 * Has an author actually put anything in this card?
 *
 * A freshly made card is a placeholder: the title the app chose, one empty
 * "Continue" outcome, nothing else. Deleting one of those needs no ceremony.
 * Anything beyond that is work, and work gets a confirmation (Patter's pattern:
 * guard the destructive act, but only when there is something to lose).
 */
export function cardHasContent(card: CardDto): boolean {
  const placeholderTitle = card.title === undefined || /^New card( \d+)?$/.test(card.title);
  const wrote = card.purpose !== undefined && card.purpose.trim() !== "";
  const gated = card.condition !== undefined && card.condition.trim() !== "";
  const tagged = card.tags.some((g) => g.values.length > 0);
  const filled = card.fields.some((f) => f.value.trim() !== "");
  // One outcome with no changes and the default title is what a new card ships
  // with; anything more is authored.
  const authoredOutcomes = card.outcomes.length > 1
    || card.outcomes.some((o) => o.changes.length > 0 || o.gate !== undefined || (o.purpose ?? "") !== "");
  return !placeholderTitle || wrote || gated || tagged || filled || authoredOutcomes;
}

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

export interface CardGestures {
  /** Replace or extend the selection. */
  select(cardId: string, extend: boolean): void;
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

/** Wire an element to the grammar. `extend` is shift or cmd/ctrl. */
function wireCardGestures(el: HTMLElement, cardId: string, gestures: CardGestures): void {
  el.addEventListener("click", (e) => {
    // A double-click also fires two clicks; selecting on the way in is harmless
    // and keeps the card highlighted as it opens.
    gestures.select(cardId, e.shiftKey || e.metaKey || e.ctrlKey);
  });
  el.addEventListener("dblclick", (e) => {
    e.preventDefault();
    gestures.open(cardId);
  });
}

// --- centre: deck of cards ----------------------------------------------------

function cardFace(card: CardDto, catalogue: ConditionProperty[], selected: boolean, gestures: CardGestures, onContext: (e: MouseEvent) => void): HTMLElement {
  // Title, then the eligibility condition (when this card fires), then the
  // beat. The ranking machinery is recessive (in the inspector). The condition
  // is a restrained, Patterpad-style "if" preview - a quiet prefix with
  // toned-down pills (check_flags etc. render compactly via the dialect), not
  // a loud chip strip (the vivid pills live in the inspector editor).
  const face = el("button", { className: `scard${selected ? " sel" : ""}` },
    el("h3", { text: card.title ?? card.gameId }),
  );
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
    : el("p", { className: "beat muted", text: "no purpose yet" }));
  // No outcome indicator here. Pips were tried and removed in July (b2ce77b);
  // a plain numeral was tried and removed on 2026-08-04, on both this face and
  // the node canvas, for the same reason: a number in a corner with nothing to
  // anchor it says nothing. The card page shows the outcomes themselves.
  if (card.tags.length > 0) {
    const chips = el("div", { className: "chips" });
    for (const m of card.tags) for (const v of m.values) chips.append(chip(v));
    face.append(chips);
  }
  face.append(openChip(card.id, gestures), grip());
  return face;
}

const cardMenu = (box: string, deck: string, card: string, actions: ViewActions) =>
  (e: MouseEvent): void => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, [
    // "What else touches this?" is a question you ask ABOUT a card you can see,
    // so it belongs on the card, not only in a menu bar that first requires the
    // card to become the editor's selection.
    { label: "Links...", onClick: () => actions.showLinks(card) },
    { label: "Duplicate", onClick: () => actions.duplicateCard(box, deck, card) },
    { label: "Delete", danger: true, onClick: () => actions.deleteCard(box, deck, card) },
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
  const tabKey = `deck:${deck.id}`;
  const tab = currentDocTab(tabKey, "cards");
  const trail = crumbTrail([
    { label: box.title ?? box.gameId, go: () => actions.focus({ kind: "box", box: box.id }) },
    { label: "Decks", go: () => actions.focus({ kind: "decks", box: box.id }) },
  ], tab === "cards" ? viewToggle(mode, actions, true) : null);
  let titled = deck.title ?? "";
  let purpose = deck.purpose ?? "";
  let pinned = deck.gameIdPinned ?? "";
  const heading = documentHeading("Deck", {
    title: { get: () => titled, set: (v) => { titled = v; }, placeholder: deck.gameId, commitOn: "blur", commit: () => actions.saveDeck(deck.id, { title: titled }) },
    gameId: { get: () => pinned, set: (v) => { pinned = v; }, fallback: deck.gameId, deriveFrom: () => titled, commit: () => actions.saveDeck(deck.id, { gameId: pinned }) },
    purpose: { get: () => purpose, set: (v) => { purpose = v; }, placeholder: "<what these cards are for>", commitOn: "blur", commit: () => actions.saveDeck(deck.id, { purpose }) },
    menu: [{ label: "Delete deck", danger: true, onClick: () => actions.deleteDeck(box.id, deck.id) }],
    comments: { on: deck.id, count: actions.openThreads(deck.id), open: (a) => actions.showComments(deck.id, titled || deck.gameId, a) },
  });
  // Cards first: a deck IS its cards, and that is the tab an author opens the page
  // for. Dealing is the deck's own machinery and comes after the contents, which
  // is also the order the box page uses (Contents, then Dealing).
  const tabs = docTabs([
    { key: "cards", label: "Cards", count: deck.cards.length },
    { key: "dealing", label: "Dealing" },
    { key: "properties", label: "Properties", count: deck.properties.length },
  ], tab, (next) => { setDocTab(tabKey, next); actions.focus({ kind: "deck", box: box.id, deck: deck.id }); });

  let body: HTMLElement;
  if (tab === "cards") {
    const move = (from: string, to: string, before: boolean): void => actions.moveCard(box.id, deck.id, from, to, before);
    const gestures: CardGestures = {
      select: (card, extend) => actions.selectCard(card, extend),
      open: (card) => actions.inspectCard(box.id, deck.id, card),
    };
    body = mode === "node"
      // The canvas needs the deck's links, which only main can work out, so the
      // container is handed over and filled when they arrive.
      ? nodeHost(deck, actions)
      : mode === "table"
      ? deckTable(box, deck, catalogue, selectedCards, gestures, move, actions)
      : el("div", { className: "cards" },
          ...deck.cards.map((c) => {
            const face = cardFace(c, catalogue, selectedCards.has(c.id),
              gestures, cardMenu(box.id, deck.id, c.id, actions));
            wireCardDrag(face, c.id, "x", move);
            return face;
          }),
          el("button", { className: "scard ghost", text: "+ New card", onClick: () => actions.newCard(box.id, deck.id) }),
        );
  } else {
    body = el("div", { className: "centre-editor" });
    tabBody(body, tab);
  }
  // A tabbed page is measured only on the tabs that hold a DOCUMENT. Its card
  // grid and its map are surfaces to fill, and a canvas stopping short of its own
  // pane would read as a bug rather than as typography.
  host.classList.toggle("measured", body.classList.contains("centre-editor"));
  host.replaceChildren(trail, heading, tabs, body);
}

/** The node view's container. views.ts draws DOM and never talks to main, so the
 *  canvas is mounted by the action once the deck's links have been fetched. */
function nodeHost(deck: DeckDto, actions: ViewActions): HTMLElement {
  const host = el("div", { className: "nodeview" });
  actions.mountNodeView(host, deck);
  return host;
}

function deckTable(box: BoxDto, deck: DeckDto, catalogue: ConditionProperty[], selectedCards: ReadonlySet<string>, gestures: CardGestures, move: (from: string, to: string, before: boolean) => void, actions: ViewActions): HTMLElement {
  const table = el("table", { className: "ctable" });
  // The card's own data (mirrors the card face), not the recessive ranking
  // machinery (priority / redraw / outcomes live in the inspector).
  // Where and Tags are DIFFERENT answers and shared one column: the audit
  // read a card's home hand under "TAGS" and learned a false model (that
  // placement is a tag). Where = the home group plus every spatial group,
  // the same rule the card's own Where sentence uses (where.ts).
  const cols = ["", "Title", "gameId", "When", "Where", "Tags", ""];
  table.append(el("thead", {}, el("tr", {}, ...cols.map((c) => el("th", { text: c })))));
  const spatial = new Set(box.tagGroups.filter((g) => g.spatial).map((g) => g.gameId));
  const isPlace = (group: string): boolean => group === PLACE_GROUP || spatial.has(group);
  const body = el("tbody");
  for (const c of deck.cards) {
    const where = c.tags.filter((m) => isPlace(m.group)).flatMap((m) => m.values).join(", ");
    const tags = c.tags.filter((m) => !isPlace(m.group)).flatMap((m) => m.values).join(", ");
    const row = el("tr", { className: selectedCards.has(c.id) ? "sel" : "" },
      el("td", { className: "ct-grip" }, grip()),
      el("td", { className: "ct-title", text: c.title ?? c.gameId }),
      el("td", { className: "ct-mono", text: c.gameId }),
      c.condition
        ? el("td", { className: "ct-when" }, el("span", { className: "cardwhen-if", text: "if" }), previewCondition(c.condition, catalogue))
        : el("td", { className: "ct-when ct-dim", text: "always" }),
      el("td", { className: where ? "" : "ct-dim", text: where || "anywhere" }),
      el("td", { className: tags ? "" : "ct-dim", text: tags || "any" }),
      el("td", { className: "ct-open" }, openChip(c.id, gestures)),
    );
    wireCardGestures(row, c.id, gestures);
    row.addEventListener("contextmenu", cardMenu(box.id, deck.id, c.id, actions));
    wireCardDrag(row, c.id, "y", move);
    body.append(row);
  }
  table.append(body);
  const wrap = el("div", { className: "ctable-wrap" }, table,
    el("button", { className: "ctable-new", text: "+ New card", onClick: () => actions.newCard(box.id, deck.id) }));
  return wrap;
}

export function renderBoxCentre(
  host: HTMLElement, box: BoxDto,
  tabBody: (bodyHost: HTMLElement, tab: string) => void, actions: ViewActions,
): void {
  // The box page: identity heading (title + gameId + purpose) above
  // [Map] | Contents | Dealing | Card template | Hand templates | Tags |
  // Properties. Contents is the box's CONTENT (decks, hands); the rest is its
  // setup, behind this one page (structure rule 10). The box is the trail's root.
  //
  // A box with a MAP leads with it, and lands on it. A place that has been drawn
  // is what that box IS: opening it to a list of two rows saying "Decks" and
  // "Hands" and making the author go and find the map treats the drawing as an
  // extra, when it is the most informative thing the box has to show. A box
  // without a spatial tag group is unchanged, and one visit to another tab is
  // remembered, so this decides the FIRST answer rather than overriding anybody.
  const tabKey = `box:${box.id}`;
  const mapped = box.tagGroups.filter((g) => g.spatial);
  const chosen = currentDocTab(tabKey, mapped.length > 0 ? "map" : "contents");
  // A group can stop being spatial while its map is the remembered tab, and a
  // page remembering its way to somewhere that no longer exists is how a stale
  // memory turns into an empty screen.
  const tab = chosen === "map" && mapped.length === 0 ? "contents" : chosen;
  let titled = box.title ?? "";
  let purpose = box.purpose ?? "";
  let pinned = box.gameIdPinned ?? "";
  const heading = documentHeading("Box", {
    title: { get: () => titled, set: (v) => { titled = v; }, placeholder: box.gameId, commitOn: "blur", commit: () => actions.saveBox(box.id, { title: titled }) },
    gameId: { get: () => pinned, set: (v) => { pinned = v; }, fallback: box.gameId, deriveFrom: () => titled, commit: () => actions.saveBox(box.id, { gameId: pinned }) },
    purpose: { get: () => purpose, set: (v) => { purpose = v; }, placeholder: "<what this box is for>", commitOn: "blur", commit: () => actions.saveBox(box.id, { purpose }) },
    comments: { on: box.id, count: actions.openThreads(box.id), open: (a) => actions.showComments(box.id, titled || box.gameId, a) },
    menu: [
      { label: "Duplicate box", onClick: () => actions.duplicateBox(box.id) },
      { label: "Delete box", danger: true, onClick: () => actions.deleteBox(box.id) },
    ],
  });
  // The MAP is offered by a box that has one, which means a tag group marked
  // spatial. A tab rather than a setting of a view switch, because a box page is
  // tabbed: its concerns sit side by side (Contents, Dealing, Tags...) rather than
  // being three ways of looking at one list, which is what the deck's switch is for.
  // FIRST when it exists, because the tab order is a claim about what the page is
  // mostly for.
  const tabs = docTabs([
    ...(mapped.length > 0 ? [{ key: "map", label: "Maps", count: mapped.length }] : []),
    { key: "contents", label: "Contents" },
    { key: "dealing", label: "Dealing" },
    { key: "template", label: "Card template", count: box.fields.length },
    { key: "templates", label: "Hand templates", count: box.templates.length },
    { key: "tags", label: "Tags", count: box.tagGroups.length },
    { key: "properties", label: "Properties", count: box.properties.length },
  ], tab, (next) => { setDocTab(tabKey, next); actions.focus({ kind: "box", box: box.id }); });

  let body: HTMLElement;
  if (tab === "templates") {
    body = boxTemplatesBody(box, actions);
  } else if (tab === "tags") {
    body = boxTagsBody(box, actions);
  } else if (tab === "map" && mapped.length > 0) {
    // The canvas is mounted by the renderer (it needs IPC, which views.ts never
    // touches), into a host this tab owns. Same arrangement as the node view.
    body = el("div", { className: "nodeview" });
    actions.mountMapView(body, box);
  } else if (tab !== "contents") {
    body = el("div", { className: "centre-editor" });
    tabBody(body, tab);
  } else {
    const list = el("div", { className: "rowlist" });
    const row = (label: string, count: number, sub: string, kind: "decks" | "hands"): void => {
      list.append(el("button", { className: "listrow", onClick: () => actions.focus({ kind, box: box.id }) },
        el("span", { className: "listname", text: label }),
        el("span", { className: "listmeta", text: `${count} · ${sub}` })));
    };
    row("Decks", box.decks.length, "The box's cards, deck by deck.", "decks");
    // B3: the SAME sentence the Hands master uses, and the accurate one. This
    // row used to say hands "own cards", which is the misconception the model
    // most needs to avoid: a deck owns cards, a hand owns what it was DEALT.
    // Two definitions forty lines apart, and the wrong one came first.
    row("Hands", box.hands.length, "The places on the board; each holds the cards it is dealt.", "hands");
    body = list;
  }
  host.replaceChildren(heading, tabs, body);
}

// The box's setup tabs: hand templates and tags list here (behind the box
// page, like the card template); each item opens its own centre document.

function boxTemplatesBody(box: BoxDto, actions: ViewActions): HTMLElement {
  const list = el("div", { className: "rowlist" });
  for (const t of box.templates) {
    const row = el("button", { className: "listrow", onClick: () => actions.inspectTemplate(box.id, t.id) },
      el("span", { className: "listname", text: t.gameId }),
      el("span", { className: "listmeta", text: `${t.bindings.join(", ") || "pulls the whole stock"} · ${t.slots} slot${t.slots === "1" ? "" : "s"}` }),
      el("span", { className: "listmeta", text: `${t.instances} instance${t.instances === 1 ? "" : "s"}` }));
    row.dataset["vc"] = vcKeys.hands(box.id);
    row.addEventListener("contextmenu", itemMenu(() => actions.duplicateTemplate(box.id, t.id), () => actions.deleteTemplate(box.id, t.id)));
    list.append(row);
  }
  list.append(el("button", { className: "listrow ghost", text: "+ New hand template", onClick: () => actions.newTemplate(box.id) }));
  const body = el("div", { className: "doc-sect" },
    // B4: was "Declared kinds of hand: shared bindings and logic, instanced by
    // hands" - six format terms in the one document a narrative designer has no
    // prior model for. The Copies row is the voice to match: a rule and a reason,
    // no jargon.
    el("p", { className: "doc-tab-note", text: "A kind of place: write the rule once, and every hand of this kind follows it, filling in its own choices." }),
    list);
  // This tab of the box page writes the HANDS shard, not the box shard, so it
  // takes its read-only state from there (see applyVc in renderer.ts).
  body.dataset["vcScope"] = vcKeys.hands(box.id);
  return body;
}

function boxTagsBody(box: BoxDto, actions: ViewActions): HTMLElement {
  const list = el("div", { className: "rowlist" });
  for (const group of box.tagGroups) {
    const row = el("button", { className: "listrow", onClick: () => actions.inspectTagGroup(box.id, group.id) },
      el("span", { className: "listname", text: group.gameId }),
      // Quiet, and only when it is true: a group that is a map is worth saying so
      // where the groups are listed, since the Map tab is the consequence.
      group.spatial ? el("span", { className: "listmeta", text: "map" }) : null,
      el("div", { className: "chips" }, ...group.values.map(chip)));
    row.dataset["vc"] = vcKeys.tags(box.id);
    row.addEventListener("contextmenu", itemMenu(() => actions.duplicateTagGroup(box.id, group.id), () => actions.deleteTagGroup(box.id, group.id)));
    list.append(row);
  }
  list.append(el("button", { className: "listrow ghost", text: "+ New tag group", onClick: () => actions.newTagGroup(box.id) }));
  const body = el("div", { className: "doc-sect" },
    // B5: one sentence, used on all three tag surfaces, naming both jobs. "Peeks"
    // was engine vocabulary that appears nowhere else an author can see.
    el("p", { className: "doc-tab-note", text: "Tags file a card. Hands deal by them, and each tag keeps its own colour so you can scan a deck." }),
    list);
  body.dataset["vcScope"] = vcKeys.tags(box.id);   // this tab writes the TAGS shard
  return body;
}

/** Right-click Duplicate / Delete, the same pair every item row offers (F5). */
const itemMenu = (duplicate: () => void, remove: () => void) => (e: MouseEvent): void => {
  e.preventDefault();
  openContextMenu(e.clientX, e.clientY, [
    { label: "Duplicate", onClick: duplicate },
    { label: "Delete", danger: true, onClick: remove },
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
    table.append(el("thead", {}, el("tr", {}, ...["", "Deck", "gameId", "Cards", "Purpose"].map((c) => el("th", { text: c })))));
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
      row.addEventListener("click", () => actions.focus({ kind: "deck", box: box.id, deck: deck.id }));
      row.addEventListener("contextmenu", itemMenu(() => actions.duplicateDeck(box.id, deck.id), () => actions.deleteDeck(box.id, deck.id)));
      wireCardDrag(row, deck.id, "y", move);
      tbody.append(row);
    }
    table.append(tbody);
    body = el("div", { className: "ctable-wrap" }, table,
      el("button", { className: "ctable-new", text: "+ New deck", onClick: () => actions.newDeck(box.id) }));
  } else {
    body = el("div", { className: "deck-grid" });
    for (const deck of box.decks) {
      const face = el("button", { className: "deck-card", onClick: () => actions.focus({ kind: "deck", box: box.id, deck: deck.id }) },
        el("h3", { text: deck.title ?? deck.gameId }),
        el("span", { className: "sub", text: `${deck.cards.length} card(s)` }),
        deck.purpose ? el("p", { className: "beat", text: deck.purpose }) : null);
      face.dataset["vc"] = vcKeys.deck(deck.id);
      face.addEventListener("contextmenu", itemMenu(() => actions.duplicateDeck(box.id, deck.id), () => actions.deleteDeck(box.id, deck.id)));
      face.append(grip());
      wireCardDrag(face, deck.id, "x", move);
      body.append(face);
    }
    body.append(el("button", { className: "deck-card ghost", text: "+ New deck", onClick: () => actions.newDeck(box.id) }));
  }
  host.replaceChildren(head, body);
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
        (() => {
          const more = el("button", { className: "doc-menu", text: "\u22ef", tip: "More" });
          more.addEventListener("click", (e) => { e.preventDefault(); actions.openProjectSettings(); });
          more.title = "Project Settings\u2026";
          return more;
        })()),
      el("h2", { className: "collection-title", text: project.name }),
      // WHERE this project is, which is the only thing that tells two copies of
      // the same name apart. Patterpad's overview carries the same line, in the
      // same place and with the same click-to-reveal; the topbar name's tooltip
      // is the other half, so the answer is one hover away from any page.
      el("button", { className: "pdir", text: project.dir, tip: revealTip(), onClick: () => actions.revealProject() }),
      el("p", { className: "master-sub", text: "The boxes: each a self-contained set of decks, hands and tags." })));
  const list = el("div", { className: "rowlist" });
  const move = (from: string, to: string, before: boolean): void => actions.moveBox(from, to, before);
  for (const box of project.boxes) {
    const cards = box.decks.reduce((n, d) => n + d.cards.length, 0);
    const row = el("button", { className: "listrow draggable", onClick: () => actions.focus({ kind: "box", box: box.id }) },
      el("span", { className: "listname listtitle", text: box.title ?? box.gameId }),
      el("span", { className: "listmeta", text: `${box.decks.length} deck${box.decks.length === 1 ? "" : "s"} \u00b7 ${cards} card${cards === 1 ? "" : "s"} \u00b7 ${box.hands.length} hand${box.hands.length === 1 ? "" : "s"}` }));
    row.dataset["vc"] = vcKeys.box(box.id);
    row.addEventListener("contextmenu", itemMenu(() => actions.duplicateBox(box.id), () => actions.deleteBox(box.id)));
    row.append(grip());
    wireCardDrag(row, box.id, "y", move);
    list.append(row);
  }
  list.append(el("button", { className: "listrow ghost", text: "+ New box", onClick: () => actions.newBox() }));
  host.replaceChildren(head, list);
}

/** Hands: the places on the board; each holds the cards it is dealt. */
export function renderHandsCentre(host: HTMLElement, box: BoxDto, actions: ViewActions): void {
  const head = masterHeading({ id: box.id, label: box.title ?? box.gameId }, "Hands", actions, "The places on the board; each holds the cards it is dealt.");
  const list = el("div", { className: "rowlist" });
  for (const hand of box.hands) {
    const kind = hand.template !== undefined ? hand.template : "standalone rule";
    // A titled hand reads as a title; only a bare gameId reads as a name.
    const row = el("button", { className: "listrow draggable", onClick: () => actions.inspectHand(box.id, hand.id) },
      el("span", { className: `listname${hand.title !== undefined ? " listtitle" : ""}`, text: hand.title ?? hand.gameId }),
      el("span", { className: "listmeta", text: `${kind}${hand.slots !== undefined ? ` · ${hand.slots} slot${hand.slots === 1 ? "" : "s"}` : ""}` }));
    // Every hand lives in the one hands shard, so they badge together.
    row.dataset["vc"] = vcKeys.hands(box.id);
    row.addEventListener("contextmenu", itemMenu(() => actions.duplicateHand(box.id, hand.id), () => actions.deleteHand(box.id, hand.id)));
    row.append(grip());
    wireCardDrag(row, hand.id, "y", (from, to, before) => actions.moveHand(box.id, from, to, before));
    list.append(row);
  }
  list.append(el("button", { className: "listrow ghost", text: "+ New hand", onClick: () => actions.newHand(box.id) }));
  host.replaceChildren(head, list);
}

// --- problems bar -------------------------------------------------------------

export function renderProblems(
  host: HTMLElement,
  problems: Problem[],
  at: number,
  onStep: (next: number) => void,
  onJump: (p: Problem) => void,
  onFix: (p: Problem, fix: NonNullable<Problem["fix"]>, anchor: HTMLElement) => void,
  /** Titles for the where segment ("Burner Rig › Continue"), when the caller
   *  can resolve them: the audit read storage paths where a person thinks in
   *  names. Undefined falls back to the path form. */
  labelFor?: (p: Problem) => string | undefined,
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
  // caller owns that guard (renderer.ts, `mayStepAway`), because only it knows
  // what is unsaved. See design-language.md and design review 2026-08, A2.
  //
  // THE BAR ITSELF IS THE SHELL'S (app-shell 0.18.0, `renderStepperBar`). Four
  // bars across the two apps are this one shape, and Patterpad drew its two with
  // parallel class sets for one idea. What stays here is what the shell must not
  // know: what a problem is, which of them are errors, and what a quick fix does.
  const errors = problems.filter((p) => p.severity === "error").length;
  // The bar clamps `at` itself; the quick fix has to be built from the same
  // entry the bar is about to show, so it clamps to the same place.
  const current = problems[Math.min(Math.max(at, 0), problems.length - 1)];
  renderStepperBar(host, {
    items: problems.map((p) => ({
      kind: p.severity, kindClass: `sev-${p.severity}`,
      where: labelFor?.(p) ?? `${p.path}${p.where ? ` [${p.where}]` : ""}`,
      text: p.message,
    })),
    at,
    tone: errors > 0 ? "danger" : "warn",
    tips: { prev: "Previous problem", next: "Next problem", go: "Go to what this is about" },
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
  return "Fix";
}

function fixButton(
  problem: Problem, fix: NonNullable<Problem["fix"]>,
  onFix: (p: Problem, fix: NonNullable<Problem["fix"]>, anchor: HTMLElement) => void,
): HTMLElement {
  const button = el("button", {
    className: "problembar-fix", text: fixLabel(fix),
    tip: fix.kind === "declare-property"
      ? "Declare it, then take me to it"
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
      kind: item.resolved === true ? "resolved" : (item.canvas !== undefined ? "marker" : "comment"),
      kindClass: item.resolved === true ? "done" : undefined,
      where: item.where,
      text: `${item.author}: ${item.text}`,
    })),
    at,
    tone: "accent",
    tips: { prev: "Previous comment (Shift+F8)", next: "Next comment (F8)", go: "Go to this comment" },
    onStep,
    onGo: (i) => onGo(items[i]!),
    // An EMPTY walk still shows its bar. Entering the mode and seeing nothing at
    // all would read as a broken command rather than as "there is no feedback",
    // which is exactly the difference `empty` encodes in the shell's bar.
    empty: "No open comments.",
    onClose,
    closeTip: "Leave the feedback walk",
  });
}
