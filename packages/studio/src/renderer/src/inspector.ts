// ---------------------------------------------------------------------------
// The centre document workspaces (inspector-free model + tab grammar,
// 2026-07-28): every entity edits in ONE place - a centre document headed by
// its identity (type label + overflow menu, title / name, gameId auto/pin
// chip, purpose) ABOVE a bar of machinery tabs named for their contents
// (Dealing / Outcomes / Fields / Properties / Values / Contents / Card
// template / ...), with counts and one silhouette per document. Fields means
// card fields (declared by the box's Card template, filled on cards);
// Properties means @scope state declarations. Every condition is "When"
// plus a hint saying whose. Derived usage is a recessive footer.
//
// Edits flow through the debounced saves the renderer owns; structural edits
// (add/remove outcome, params, values) redraw the document in place.
// ---------------------------------------------------------------------------

import { iconNode, metaLine, openAnchoredPanel, openGameIdEditor, plural } from "@wildwinter/app-shell";
import { currentDocTab, setDocTab } from "./doc-tab-memory.js";
import { isAnywhere, placeGroupsOf, whereModel, whereWarning } from "./where.js";
import { NEVER_LABEL, anywhereLine, gateLabel, movingNote, tierCount, tierLabel } from "./hand-tiers.js";
import { soloSharePointer } from "./solo-pointer.js";
import type { ShareScope } from "./zone-share.js";
// The DERIVED address, computed for placeholders and previews. From the model
// rather than the shell: this is the same rule the compiler and the CLI use, and
// model/test/id-parity.test.ts holds the two copies to each other.
import { gameIdify, isHoleRef, turnSpan, PLACE_GROUP } from "@storylet-studio/model";
import { el } from "./dom.js";

import { openContextMenu, openPopover } from "@wildwinter/app-shell/context-menu";
import { chipDot } from "./views.js";
import { boxColour } from "./box-tint.js";
import { mountChanges, mountCondition, previewCondition } from "./expr-panels.js";
import { mountPropertyList, valueControl } from "./prop-list.js";
import { shows } from "./play-ladder.js";
import { hoistableProperties, hoistProperty } from "./tag-hoist.js";
import type {
  BindingDto, BoxDto, BoxEdit, CardDto, CardEdit, ConditionProperty, DeckDto, DeckEdit,
  FieldDeclDto, HandCardGate, HandCardRef, HandCardsDto, HandDetail, HandEdit, OutcomeDto, OutcomeEdit, PropertyDeclDto,
  TagGroupDetail, TagGroupEdit, TemplateDetail, TemplateEdit, ValueDetail,
} from "../../shared/api.js";

/** Detail fetched for the template / hand / tag-group levels (box uses its
 *  enriched DTO). */
export type Detail =
  | { kind: "template"; template: TemplateDetail }
  | { kind: "hand"; hand: HandDetail }
  | { kind: "tagGroup"; group: TagGroupDetail };

export type Inspected =
  | { kind: "card"; box: string; deck: string; card: string }
  | { kind: "deck"; box: string; deck: string }
  | { kind: "box"; box: string }
  | { kind: "template"; box: string; template: string }
  | { kind: "hand"; box: string; hand: string }
  | { kind: "tagGroup"; box: string; group: string };

export interface InspectorHost {
  /** Has this thing any documentation notes of its own? For the header icon. */
  /** How many OPEN comment threads it has, for the header bubble. */
  openThreads(id: string): number;
  /** Open the comment popover, anchored to the element that was clicked. */
  showComments(id: string, subject: string, anchor: HTMLElement): void;
  /** Open the notes modal for it. `subject` is what to call it in the title. */
  /** Persist a card edit (debounced). */
  saveCard(deckId: string, cardId: string, edit: CardEdit): void;
  /** Rename/edit a deck (immediate: identity fields, blur-committed). */
  saveDeck(deckId: string, edit: DeckEdit): void;
  /** The deck's Settings document (gate + @deck state), debounced. */
  saveDeckConfig(deckId: string, edit: DeckEdit): void;
  /** Delete this card / deck (returns to the deck / box). */
  deleteCard(deckId: string, cardId: string): void;
  deleteDeck(box: string, deckId: string): void;
  /** Persist a box / template / tag-group edit (background; refreshes the problem bar). */
  saveBox(boxId: string, edit: BoxEdit): void;
  /** Immediate identity save for the box overview (title/gameId/purpose). */
  saveBoxIdentity(boxId: string, edit: BoxEdit): void;
  saveTemplate(boxId: string, templateId: string, edit: TemplateEdit): void;
  saveTagGroup(boxId: string, groupId: string, edit: TagGroupEdit): void;
  saveHand(boxId: string, handId: string, edit: HandEdit): void;
  /** Create / delete a template or tag group (structural; re-selects). */
  createTemplate(boxId: string): void;
  deleteTemplate(boxId: string, templateId: string): void;
  createTagGroup(boxId: string): void;
  /** Create a tag group that is already a map. */
  createMap(boxId: string): void;
  deleteTagGroup(boxId: string, groupId: string): void;
  /** Make this tag group a map, or stop. Traced outlines are kept either way. */
  setGroupSpatial(boxId: string, groupId: string, on: boolean): void;
  createHand(boxId: string): void;
  deleteHand(boxId: string, handId: string): void;
  /** What could come up at a hand, tiered (main asks ops `placeTiers`). */
  handCards(boxId: string, handId: string): Promise<HandCardsDto | null>;
  /** A deck's condition catalogue: what its cards' `if` lines are read
   *  against, @deck included, which the box's own catalogue cannot know. */
  deckCatalogue(deckId: string): Promise<ConditionProperty[]>;
  /** Open a card from a hand's Cards tab: a sideways arrival, so the card page
   *  offers the way back to the hand as well as the way up to its deck. */
  openCardFromHand(boxId: string, deckId: string, cardId: string, hand: { id: string; title: string }): void;
  /** Make a card in `deckId` whose place is this hand, and open it. */
  newCardAtHand(boxId: string, deckId: string, hand: { id: string; title: string }): void;
  /** Open a hand's page on its Cards tab: the place chip in a card's sentence. */
  openHand(boxId: string, handId: string): void;
}

/**
 * Cards made in a deck this session (its "+ New card", on the grid, the table
 * or the canvas), for the one-time "comes up anywhere" note on the card page
 * (plan item 0, mock-up 4b). A deck has no place, so a card made there is a
 * card for every hand in the box until somebody says otherwise, and in a box on
 * the map that is rarely what was meant. Session memory, like the tab memory:
 * the note is about the moment of making, and a card answered (a place chosen,
 * or "Anywhere is right") leaves the set for good.
 */
const madeInDeck = new Set<string>();
export function noteMadeInDeck(cardId: string): void { madeInDeck.add(cardId); }

/** The deck "+ New card here" last filed into, per box: the picker's default.
 *  Still ASKED every time (the antagonist review, ladder step 2: a silent
 *  default files an Inn card into whichever storyline you touched last). */
const lastDeckFor = new Map<string, string>();

/**
 * One card that could come up at a hand: its title, its `if` line in the card
 * face's quiet styling, its deck, and where else it is placed. The hand page's
 * Cards tab and the project map's site panel draw the same row, so a place
 * reads the same wherever it is asked about. `here` is the hand's gameId, left
 * out of "also at"; `catalogue` is the card's OWN deck's (it reads @deck).
 */
export function handCardRow(
  box: BoxDto, ref: HandCardRef, catalogue: ConditionProperty[], here: string | undefined,
  open: (deck: string, card: string) => void,
  /** A `boundBy` gate's badges, and why a card placed here can never come up. */
  extra: { gates?: HandCardGate[]; why?: string } = {},
): HTMLElement | null {
  const deck = box.decks.find((d) => d.id === ref.deck);
  const card = deck?.cards.find((c) => c.id === ref.card);
  if (!deck || !card) return null;
  const also = (card.tags.find((t) => t.group === PLACE_GROUP)?.values ?? [])
    .filter((g) => g !== here)
    .map((g) => box.hands.find((x) => x.gameId === g)?.title ?? g);
  const meta = metaLine([deck.title ?? deck.gameId, also.length > 0 ? `also at ${also.join(", ")}` : undefined]);
  meta.classList.add("listmeta");
  return el("button", { className: `listrow handcard${extra.why !== undefined ? " never" : ""}`, onClick: () => open(deck.id, card.id) },
    el("span", { className: "handcard-head" }, el("span", { className: "listname listtitle", text: card.title ?? card.gameId }), meta,
      ...(extra.gates ?? []).map((g) => el("span", { className: "chip handcard-gate", text: gateLabel(g) }))),
    card.condition
      ? el("div", { className: "cardwhen" }, el("span", { className: "cardwhen-if", text: "if" }), previewCondition(card.condition, catalogue))
      : null,
    extra.why !== undefined ? el("p", { className: "where-warn", text: extra.why }) : null);
}

/**
 * Which deck a card made at a place goes into: ASKED, every time, with the last
 * deck used marked and focused so Return takes it. Patterpad's jump picker
 * (its jump-picker.ts) is the shape, since it is the family's anchored list of
 * one choice: the shell's anchored panel, a title, a row per option, the
 * current one marked. Shared by the hand page and the project map's site panel,
 * with one memory per box, so the mark is the same from either.
 */
export function openDeckPickerFor(anchor: HTMLElement, box: BoxDto, pick: (deckId: string) => void): void {
  const panel = openAnchoredPanel({ anchor, className: "deckpick", title: "Which deck", width: 240, prefer: "below" });
  if (!panel) return;
  panel.body.classList.add("deckpick-list");
  if (box.decks.length === 0) {
    panel.body.append(el("p", { className: "doc-tab-note", text: "This box has no decks yet. Make one first, from the navigator's + deck." }));
    return;
  }
  const last = lastDeckFor.get(box.id);
  let focus: HTMLElement | undefined;
  for (const deck of box.decks) {
    const opt = el("button", { className: `deckpick-opt${deck.id === last ? " sel" : ""}`, text: deck.title ?? deck.gameId,
      onClick: () => {
        panel.close();
        lastDeckFor.set(box.id, deck.id);
        pick(deck.id);
      } });
    if (focus === undefined || deck.id === last) focus = opt;
    panel.body.append(opt);
  }
  focus?.focus();
}

/**
 * "Which deck" across several boxes: the zone panel's "+ New card here", where
 * every box on the map can file a card to the zone. One box is the ordinary
 * picker; several list their decks under each box's name, the same one-choice
 * list with a caption per box, rather than a box step and then a deck step.
 */
export function openDeckPickerAcross(anchor: HTMLElement, boxes: BoxDto[], pick: (boxId: string, deckId: string) => void): void {
  const withDecks = boxes.filter((b) => b.decks.length > 0);
  if (boxes.length === 1 || withDecks.length === 1) {
    const only = withDecks[0] ?? boxes[0]!;
    openDeckPickerFor(anchor, only, (deck) => pick(only.id, deck));
    return;
  }
  const panel = openAnchoredPanel({ anchor, className: "deckpick", title: "Which deck", width: 260, prefer: "below" });
  if (!panel) return;
  panel.body.classList.add("deckpick-list");
  if (withDecks.length === 0) {
    panel.body.append(el("p", { className: "doc-tab-note", text: "No box on the map has a deck yet. Make one first, from the navigator's + deck." }));
    return;
  }
  let focus: HTMLElement | undefined;
  for (const box of withDecks) {
    // The box's own map colour, as its pins wear it.
    const dot = el("i");
    dot.style.background = boxColour(box.id);
    panel.body.append(el("div", { className: "deckpick-box" }, dot, box.title ?? box.gameId));
    const last = lastDeckFor.get(box.id);
    for (const deck of box.decks) {
      const opt = el("button", { className: `deckpick-opt indent${deck.id === last ? " sel" : ""}`, text: deck.title ?? deck.gameId,
        onClick: () => {
          panel.close();
          lastDeckFor.set(box.id, deck.id);
          pick(box.id, deck.id);
        } });
      if (focus === undefined) focus = opt;
      panel.body.append(opt);
    }
  }
  focus?.focus();
}

// A section caption: sentence-case words in the UI face, weight 600, never a
// tracked overline ("Captions are words, not overlines", 2026-09-16).
const caption = (text: string): HTMLElement => el("span", { className: "insp-label", text });

// One section grammar (centre-clarity 3): caption OUTSIDE the panel,
// an optional muted hint on the same line, then the panel - one material for
// every machinery cluster. The panel contains only content, never its label.
const sectHead = (label: string, hint?: string): HTMLElement =>
  el("div", { className: "doc-sect-head" }, caption(label),
    hint ? el("span", { className: "doc-sect-hint", text: hint }) : null);
const sectParts = (label: string, hint: string | undefined, ...body: (Node | null)[]): Node[] =>
  [sectHead(label, hint), el("div", { className: "doc-panel" }, ...body)];
const section = (label: string, hint: string | undefined, ...body: (Node | null)[]): HTMLElement =>
  el("div", { className: "doc-sect" }, ...sectParts(label, hint, ...body));
// The rare unpanelled cluster (inside an already-lifted panel, e.g. an open
// outcome's gate/changes): same head, content bare.
const bare = (label: string, hint: string | undefined, ...body: (Node | null)[]): HTMLElement =>
  el("div", { className: "doc-sect" }, sectHead(label, hint), ...body);

// An empty section costs one line, not a panel (centre-clarity 8): caption +
// quiet summary, with a ghost + that swaps in the real panel when there is
// one to expand. A commit-driven redraw re-collapses it only while it is
// still empty, which is the correct resting state.
function emptySection(label: string, summary: string, expandTo?: () => Node[]): HTMLElement {
  const wrap = el("div", { className: "doc-sect" });
  const row = el(expandTo ? "button" : "div", { className: "doc-collapsed" },
    caption(label), el("span", { className: "doc-collapsed-sum", text: summary }),
    expandTo ? el("span", { className: "doc-collapsed-plus" }, iconNode("add", 12)) : null);
  if (expandTo) row.addEventListener("click", () => wrap.replaceChildren(...expandTo()));
  wrap.append(row);
  return wrap;
}

// Tabs are groups of machinery, named for their contents (tab-grammar 3):
// one fixed vocabulary (Dealing / Outcomes / Fields / Properties / Values /
// Contents / Cards / Parameters / Bindings / Slots / Card template), counts
// where a count is meaningful, and a zero-count tab stays visible (muted,
// clickable, the explanation inside) so every document keeps the same
// silhouette. Never "Settings". Fields is card data (the box's Card template,
// filled on cards); Properties is @scope state - the two are not the same
// concept and never share a name. The identity header lives ABOVE the bar
// (tab-grammar 2), so no tab switch ever hides it.
export interface DocTabSpec { key: string; label: string; count?: number }
export function docTabs(specs: DocTabSpec[], active: string, onPick: (key: string) => void): HTMLElement {
  const bar = el("div", { className: "doc-tabs" });
  for (const s of specs) {
    const b = el("button", { className: `doc-tab${active === s.key ? " on" : ""}${s.count === 0 ? " zero" : ""}`, text: s.label });
    // The 0 shows: a dimmed tab with no number read as DISABLED to the audit,
    // which avoided clicking it. Dim-with-a-zero is learnable as "empty".
    if (s.count !== undefined) b.append(el("span", { className: "doc-tab-n", text: String(s.count) }));
    b.addEventListener("click", () => { if (active !== s.key) onPick(s.key); });
    bar.append(b);
  }
  return bar;
}
// The tab memory lives in its own module (doc-tab-memory.ts), remembered at
// PAGE TYPE level: an author moving card-to-card with Outcomes up is
// comparing outcomes, so the choice follows them. Re-exported here so the
// document builders keep one import for the tab machinery.
export { currentDocTab, docTabFor, resetDocTabMemory, setDocTab } from "./doc-tab-memory.js";

// A Settings row (centre-clarity 7, the System Settings shape): caption +
// small description on the left, the control on the right. Settings reads
// as configuration; Content reads as a document.
function cfgRow(caption: string, desc: string, ...controls: (Node | null)[]): HTMLElement {
  return el("div", { className: "cfg-row" },
    el("span", { className: "cfg-cap" }, el("span", { text: caption }), el("small", { text: desc })),
    el("div", { className: "cfg-ctl" }, ...controls));
}
function cfgCheck(checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const cb = el("input", { className: "toggle-cb" });
  cb.type = "checkbox"; cb.checked = checked;
  cb.addEventListener("change", () => onChange(cb.checked));
  return cb;
}

// Commit on input (autosave is continuous, and the save indicator responds to
// the first keystroke), with a final commit on change/blur. Callers that must
// only act on blur (a deck rename that moves the file) pass a no-op onChange
// and attach their own change listener.
function textField(value: string, className: string, onInput: (v: string) => void, onChange: () => void): HTMLInputElement {
  const input = el("input", { className });
  input.value = value;
  // An identifier is not prose: no red squiggle under a gameId or a mono name
  // (parity row 52). Prose fields keep the platform's check.
  if (/\binsp-mono\b|\bdoc-name\b/.test(className)) input.spellcheck = false;
  input.addEventListener("input", () => { onInput(input.value); onChange(); });
  input.addEventListener("change", onChange);
  return input;
}

/**
 * The one thing a click-to-edit title owes: Esc puts back what it held when it
 * got focus (parity row 50). The value goes back and `restore` re-takes it, so
 * a title that commits as it is typed is committed back too; the window's own
 * Esc handler then blurs the field, and with the value where it started no
 * change event follows.
 */
function escapeRestores(input: HTMLInputElement, restore: (value: string) => void): void {
  let atFocus = input.value;
  input.addEventListener("focus", () => { atFocus = input.value; });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || input.value === atFocus) return;
    input.value = atFocus;
    restore(atFocus);
  });
}

// --- the card level (the big editor) ------------------------------------------

let seq = 0;
const freshOutcomeId = (): string => `o_new_${Date.now().toString(36)}_${seq++}`;

// A card edits across two panes (the centre authoring document + the inspector's
// settings), so there is one shared edit object mutated by both and saved as a
// whole. gameId keys seed from the *pinned* value (empty when the address is
// derived), so the editor can show the computed name as a placeholder. The array
// keys are always present so the editor can push/splice without undefined guards.
function editFromCard(card: CardDto): Required<CardEdit> {
  return {
    gameId: card.gameIdPinned ?? "",
    priority: String(card.priority),
    redraw: card.redraw,
    copies: card.copies,
    // null is the third state: inherit the deck's flag rather than override it.
    shared: card.shared === undefined ? null : card.shared,
    sharedCopies: card.sharedCopies,
    durable: card.durable === undefined ? null : card.durable,
    title: card.title ?? "",
    purpose: card.purpose ?? "",
    condition: card.condition ?? "",
    tags: card.tags.map((m) => ({ group: m.group, values: [...m.values] })),
    fields: card.fields.map((f) => ({ name: f.name, value: f.value })),
    outcomes: card.outcomes.map((o): OutcomeEdit => ({
      id: o.id, gameId: o.gameIdPinned ?? "",
      ...(o.title !== undefined ? { title: o.title } : {}),
      ...(o.purpose !== undefined ? { purpose: o.purpose } : {}),
      ...(o.gate !== undefined ? { gate: o.gate } : {}),
      changes: o.changes.map(parseChange),
      // Always present, as the card's `fields` is: the Fields block pushes into
      // it, and a key that appears only once something is set would have to be
      // guarded at every touch.
      fields: o.fields.map((f) => ({ name: f.name, value: f.value })),
    })),
  };
}
/** The nudge that repaints an address chip in place. Its own event so the chip
 *  keeps its own paint function, rather than the caller reaching in to rewrite
 *  a tooltip it would then have to keep in step. */
const GID_REPAINT = "gid:repaint";

/**
 * Repaint every address chip under `host`.
 *
 * For the pass that DISABLES them: the read-only rule (an author's key over a
 * shape shard) and a held shard both arrive after the document is drawn, and a
 * chip painted before them was still saying "click to edit" over a control
 * nothing would open (2026-09-07).
 */
export function refreshGameIds(host: ParentNode): void {
  host.querySelectorAll(".gid").forEach((chip) => chip.dispatchEvent(new Event(GID_REPAINT)));
}

// A gameId field (Patterpad's model): the address is *derived from the title*
// until the author sites one, so it reads as a quiet auto value rather than a
// typed-in literal. Click it for a small popover to override, or to hand it
// back to auto. `refresh` repaints it when the title it derives from changes.
function gameIdField(
  get: () => string, set: (v: string) => void, derived: () => string, commit: () => void,
  /** What a venue depends on this address being (design/engine-server.md 4.11).
   *  It reads as the field's HINT and not as a refusal: the refusal is the
   *  server's, on push (9.1), and a rename field that simply would not type
   *  would leave a designer with no way to see why.
   *
   *  ASKED at every paint, not read once: the claim is on the NAME the venue
   *  bound, so it lets go the moment this address stops being that name. It
   *  used to be a fixed list, and a rename in place left the mark and the hint
   *  standing until the page was re-entered (2026-09-07). */
  contract?: () => string[] | undefined,
): { root: HTMLElement; refresh: () => void } {
  const root = el("button", { className: "gid" });
  const paint = (): void => {
    const pinned = get().trim();
    const bound = contract?.();
    // Toggled rather than assigned: a repaint must not sweep away a class
    // somebody else put here, and the read-only pass marks this button with one
    // (`vc-off`) that is how it is opened up again.
    root.classList.add("gid");
    root.classList.toggle("gid-auto", pinned === "");
    root.classList.toggle("gid-bound", (bound?.length ?? 0) > 0);
    // The click hint goes when the chip cannot be clicked: under an author's
    // key the shape is read-only and this button is disabled, and an invitation
    // to click a dead control is worse than no hint at all. What shut it is
    // said above the document, by the notice that shut it.
    const shut = (root as HTMLButtonElement).disabled;
    // Pinned by hand or by the first Publish (design/pin-on-publish.md): either
    // way a title edit no longer moves it, and that is what the author needs.
    const usual = pinned
      ? `Game id, pinned: editing the title no longer changes it${shut ? "" : " (click to edit)"}`
      : `Game id, following the title until the bundle is first published${shut ? "" : " (click to override)"}`;
    root.title = bound?.length ? [...bound, usual].join("\n") : usual;
    // No "Pinned"/"Auto" word: Patterpad's manner, where a derived id reads muted
    // (`.gid-auto`) and a pinned one plainly, and the tooltip says which.
    root.replaceChildren(el("span", { className: "gid-value", text: pinned || derived() || "(unnamed)" }));
  };
  // Repainted from outside by `refreshGameIds`, which is how a chip learns it
  // has been disabled: the read-only pass runs after the document is drawn.
  root.addEventListener(GID_REPAINT, () => paint());
  root.addEventListener("click", () => {
    // THE SHELL'S editor (app-shell `id-editor.ts`), which is Patterpad's lifted
    // into the kit: an address is a family-wide idea, not a storylets one, and
    // the two apps had grown different manners for the same job. What is left
    // here is where the chip lives and what it does with the answer.
    openGameIdEditor({
      anchor: root,
      value: get(),
      derived: derived(),
      onCommit: (gameId) => { set(gameId); paint(); commit(); },
    });
  });
  paint();
  return { root, refresh: paint };
}
const parseChange = (line: string): { target: string; value: string } => {
  const at = line.indexOf(" ← ");
  return at < 0 ? { target: line, value: "" } : { target: line.slice(0, at), value: line.slice(at + 3) };
};

// A card edits across two panes that share one edit object: the wide centre is
// the authoring document (title, when, beat, tags, fields, outcomes) and
// the inspector holds the mechanical settings (gameId, priority, redraw). A
// single shared edit means both panes mutate and save the same object.
//
// Outcomes are document-class too (their gate + changes are wide expression
// editors), so they live in the centre as an accordion: a light row per outcome
// that expands in place to its full editor - see renderCardWorkspace.
let cardEditKey: string | undefined;
let expandedOutcome: string | undefined;

/** Open one outcome, from outside: the Review Feedback walk arriving at a thread
 *  anchored to it. The card editor draws on the next render, so this only sets
 *  where it should land. */
/**
 * Open this card's editor with one outcome already expanded: the feedback walk
 * arriving at a comment filed on an outcome.
 *
 * `cardEditKey` is claimed here as well, and has to be. Rendering a card the
 * editor was not already on collapses the open outcome (a fresh card should not
 * inherit the last one's accordion), which would undo this the moment the walk
 * navigated.
 */
export function expandOutcome(deck: string, card: string, outcome: string): void {
  cardEditKey = `${deck}/${card}`;
  expandedOutcome = outcome;
}

export function renderCardWorkspace(centre: HTMLElement, box: BoxDto, deck: DeckDto, card: CardDto, catalogue: ConditionProperty[], h: InspectorHost): void {
  // A fresh edit per workspace render (navigation / undo bring a fresh DTO;
  // keystrokes commit + debounce-save and never re-enter here). Selecting a
  // different card collapses the open outcome.
  const key = `${deck.id}/${card.id}`;
  if (cardEditKey !== key) { expandedOutcome = undefined; cardEditKey = key; }
  const edit = editFromCard(card);
  if (expandedOutcome && !edit.outcomes.some((o) => o.id === expandedOutcome)) expandedOutcome = undefined;
  const commit = (): void => h.saveCard(deck.id, card.id, edit);
  const setExpanded = (id: string | undefined): void => { expandedOutcome = id; drawCentre(); };

  function drawCentre(): void {
    const tabKey = `card:${key}`;
    const tab = currentDocTab(tabKey, "dealing");
    const view = el("div", { className: "insp-card cardedit" });
    view.append(documentHeading("Card", {
      title: { get: () => edit.title ?? "", set: (v) => { edit.title = v; }, placeholder: "Card title", commit },
      gameId: { get: () => edit.gameId ?? "", set: (v) => { edit.gameId = v; }, fallback: card.gameId, deriveFrom: () => edit.title ?? "", commit },
      purpose: { get: () => edit.purpose ?? "", set: (v) => { edit.purpose = v; }, placeholder: "What happens when this card plays", commit },
      menu: [{ label: "Delete card", danger: true, onClick: () => h.deleteCard(deck.id, card.id) }],
      comments: { on: card.id, count: h.openThreads(card.id), open: (a) => h.showComments(card.id, edit.title ?? card.gameId, a) },
    }));
    const setN = edit.fields.filter((f) => f.value.trim() !== "").length;
    view.append(docTabs([
      { key: "dealing", label: "Dealing" },
      { key: "outcomes", label: "Outcomes", count: edit.outcomes.length },
      { key: "fields", label: "Fields", count: setN },
    ], tab, (next) => { setDocTab(tabKey, next); drawCentre(); }));

    if (tab === "outcomes") {
      view.append(el("div", { className: "doc-panel" }, outcomeAccordion(edit, box.outcomeFields, catalogue, commit, setExpanded, h,
        new Map(card.outcomes.flatMap((o) => (o.patter ? [[o.id, o.patter] as const] : []))))));
      centre.replaceChildren(view);
      return;
    }

    if (tab === "fields") {
      view.append(...cardFieldsBody());
      centre.replaceChildren(view);
      return;
    }

    // Dealing: how this card gets dealt - its condition, its rank, and the
    // tags hands pull by. One coherent page (tab-grammar 3).
    //
    // WHERE LEADS in any box with a PLACE AXIS (ops place-axis.ts, through
    // TagGroupDto.placeAxis: the map's zones for a box on it, or any group a hand
    // in the box binds, an npc or an area), as one sentence ("Comes up at the Inn
    // when..."), because where is the coarser filter and the first thing the
    // designer of such a box asks (design/where-and-selectors.md, which put Where
    // above When from the start; plan item 0 restores it). It used to lead only on
    // the map, which left a conversation box, the case round 2 named first,
    // leading with When. In a box with no place axis When leads as it always
    // has, and Where keeps its row at the foot: a sentence about where a card
    // comes up, in a box where nothing decides that, would teach a model the box
    // does not use.
    const leadsWithWhere = box.tagGroups.some((g) => g.placeAxis === true);
    const lead = leadsWithWhere ? whereLead() : undefined;
    if (lead) view.append(lead.root);
    const condHost = el("div", { className: "insp-exed" });
    mountCondition(condHost, { src: edit.condition ?? "", properties: catalogue, onChange: (src) => { edit.condition = src; commit(); lead?.paintWhen(); } });
    view.append(section("When", "the condition to be dealt", condHost));

    const priority = textField(edit.priority ?? "", "insp-input insp-mono insp-short", (v) => { edit.priority = v; }, commit);
    priority.placeholder = "0";
    const seg = el("div", { className: "seg insp-seg" });
    const isNumber = /^\d+$/.test(edit.redraw ?? "");
    for (const [label, value] of [["always", "always"], ["never", "never"], ["turns", "5"]] as [string, string][]) {
      const on = label === "turns" ? isNumber : edit.redraw === value;
      const b = el("button", { className: `seg-opt${on ? " on" : ""}`, text: label });
      b.addEventListener("click", () => { edit.redraw = label === "turns" ? (isNumber ? edit.redraw : "5") : value; commit(); drawCentre(); });
      seg.append(b);
    }
    const turns = el("input", { className: "insp-input insp-mono insp-short" });
    turns.value = isNumber ? (edit.redraw ?? "") : ""; turns.placeholder = "3"; turns.disabled = !isNumber;
    // In a TIMED box the number here is a length of time, not a count of plays
    // (design/engine-server.md 4.8), so the field says what it comes to as the
    // designer types rather than leaving the arithmetic to them. Nothing is
    // added in an ordinary box, where a turn is a play and there is nothing to
    // convert.
    const unit = box.turn?.seconds;
    const asTime = el("span", { className: "insp-note" });
    const sayTime = (): void => {
      asTime.textContent = unit !== undefined && /^\d+$/.test(turns.value)
        ? `${turns.value} turns (${turnSpan(Number(turns.value), unit, true)})` : "";
    };
    sayTime();
    turns.addEventListener("input", () => { if (/^\d+$/.test(turns.value)) edit.redraw = turns.value; sayTime(); });
    turns.addEventListener("change", commit);
    const copies = textField(edit.copies ?? "", "insp-input insp-mono insp-short", (v) => { edit.copies = v; }, commit);
    copies.placeholder = "1";

    /** Scarcity across playthroughs (design/shared-scarcity.md), as THREE
     *  states, because two would lie: a card that says nothing takes its
     *  deck's flag, and "inherit" has to be visibly different from "not
     *  shared" or an author cannot tell why a card in a shared pile is
     *  scarce. The default choice names what the deck actually says, so the
     *  answer is on the card page rather than one click away. */
    /** The three-state control the two axes share: not set / on / off, with
     *  the "not set" choice naming what the DECK actually says, so the answer
     *  is on the card page rather than one click away. */
    const threeState = (
      value: boolean | null, deckSays: boolean, word: string,
      set: (v: boolean | null) => void,
    ): HTMLElement => {
      const seg = el("div", { className: "seg insp-seg" });
      const states: [string, boolean | null][] = [
        [deckSays ? `deck (${word})` : `deck (not ${word})`, null],
        [word, true],
        [`not ${word}`, false],
      ];
      for (const [label, v] of states) {
        const b = el("button", { className: `seg-opt${value === v ? " on" : ""}`, text: label });
        b.addEventListener("click", () => { set(v); commit(); drawCentre(); });
        seg.append(b);
      }
      return seg;
    };

    const sharedRows = (): HTMLElement[] => {
      const rows: HTMLElement[] = [];
      const effective = edit.shared === null ? deck.shared === true : edit.shared === true;
      // Below the shared rung the project has no second playthrough to share
      // with, so none of this is drawn at all (design/engine-server.md 4.10).
      if (shows("sharing")) {
        rows.push(cfgRow("Shared across playthroughs",
          "One in the world rather than one each. Dealt to one participant, it can't be dealt to another, "
          + "and a Redraw of never spends it for everyone. A single-player game is unaffected.",
          threeState(edit.shared, deck.shared === true, "shared", (v) => { edit.shared = v; })));
        // Only when it can do something: sharedCopies on an unshared card is a
        // dead setting, and the compiler says so. Better not to offer it.
        if (effective) {
          const world = textField(edit.sharedCopies ?? "", "insp-input insp-mono insp-short",
            (v) => { edit.sharedCopies = v; }, commit);
          world.placeholder = edit.copies.trim() || "1";
          rows.push(cfgRow("In the world",
            "How many hands may hold it anywhere, across every playthrough. Blank means the same as Copies, "
            + "which is right for one-in-the-world. Set both for five in the world and one to a customer.",
            world));
        }
      }
      // Durability across the RUN (design/engine-server.md 4.2). Only where
      // there is a spend to carry: on any redraw but "never" the flag means
      // nothing past the run and the compiler says so, so the card page does
      // not offer it rather than offering a setting that earns a warning.
      //
      // A card that ALREADY says durable keeps the control at every rung: the
      // way out the compiler names for a flag above its rung is "remove the
      // flag", venue being the server's to set, so the control an author
      // removes it with cannot be one the rung takes away.
      if ((shows("durable") || edit.durable === true) && edit.redraw === "never") {
        rows.push(cfgRow("Durable",
          "The card stays played after the run ends. Tomorrow it's still gone for whoever played it, "
          + "or for everyone if it is also shared. Only a Redraw of never can be durable.",
          threeState(edit.durable, deck.durable === true, "durable", (v) => { edit.durable = v; })));
      }
      return rows;
    };
    view.append(el("div", { className: "doc-panel cfg-panel" },
      // Both halves now say WHICH WAY the number runs, which neither did: ranking is
      // `b.priority - a.priority`, so higher goes first, and an author had no way to
      // learn that from the app. The specificity branch names the box's own toggle
      // ("Rank by specificity") rather than the bare noun, so the two surfaces still
      // point at each other.
      cfgRow("Priority", box.ranking.specificity
        ? "Higher goes first. Rank by specificity is on, so this only breaks ties between equally specific cards."
        : "Higher goes first, and decides the order outright.", priority),
      cfgRow("Redraw", unit === undefined
        ? "Whether a played card can be dealt again."
        : `Whether a played card can be dealt again. A turn in this box is ${turnSpan(1, unit, true)} (its Turns setting), so the number here is a length of time.`,
        el("div", { className: "insp-segrow" }, seg, turns, asTime)),
      cfgRow("Copies", "How many hands may hold this card at once, in one playthrough. One copy is the rule. More is for interchangeable filler.", copies),
      ...sharedRows(),
    ));

    // WHERE, in a box with no place axis: answered as a sentence rather than
    // left to be assembled from a hand row and a region row
    // (design/where-and-selectors.md Part A); everything else stays in Tags.
    if (!leadsWithWhere) view.append(whereRow());

    // Tags: the groups this card is filed under, minus the place axes the Where
    // row (or sentence) now owns. The reserved home group is a place axis by
    // definition, so it never appears here any more.
    const placeGroups = placeGroupsOf(box);
    const groups: { name: string; values: string[] }[] =
      box.tagGroups.filter((g) => !placeGroups.has(g.gameId)).map((g) => ({ name: g.gameId, values: g.values }));
    if (groups.length > 0) {
      const tagBody: HTMLElement[] = [];
      for (const group of groups) {
        const row = el("div", { className: "insp-chips" });
        for (const value of group.values) {
          const on = edit.tags.find((m) => m.group === group.name)?.values.includes(value) ?? false;
          const chip = el("button", { className: `chip${on ? " on" : ""}` }, chipDot(value), value);
          chip.addEventListener("click", () => {
            let m = edit.tags.find((x) => x.group === group.name);
            if (!m) { m = { group: group.name, values: [] }; edit.tags.push(m); }
            m.values = m.values.includes(value) ? m.values.filter((v) => v !== value) : [...m.values, value];
            edit.tags = edit.tags.filter((x) => x.values.length > 0);
            commit(); drawCentre();
          });
          row.append(chip);
        }
        tagBody.push(el("div", { className: "doc-row doc-row-top" }, el("span", { className: "doc-row-label", text: group.name }), row));
      }
      view.append(edit.tags.length > 0
        // B5: the tagging surface was the one that said nothing about what
        // tagging DOES, and "what this card is about" invites a free-form topic
        // one document away from "declared, not freeform".
        ? section("Tags", "the labels hands can deal by", ...tagBody)
        : emptySection("Tags", "untagged", () => sectParts("Tags", "the labels hands can deal by", ...tagBody)));
    }

    centre.replaceChildren(view);
  }

  /**
   * The Where row: one place answer, editable through one picker.
   *
   * Chips rather than prose alone, because a chip is how every other selected
   * tag reads in this app and the colours are already meaningful; the sentence
   * sits beside them for the empty and the regional cases, which chips alone
   * say badly ("forest" does not read as "anywhere in the forest").
   */
  function whereRow(): HTMLElement {
    const m = whereModel(box, edit.tags);
    const line = el("div", { className: "where-line" });
    if (isAnywhere(m)) {
      line.append(el("span", { className: "where-any", text: "Anywhere" }));
    } else {
      for (const p of m.places) line.append(el("span", { className: "chip on where-place" }, iconNode("pin", 11), p.title));
      for (const r of m.regions) {
        for (const v of r.values) line.append(el("span", { className: "chip on where-region" }, chipDot(v), `anywhere in ${v}`));
      }
      // Any other place axis (an npc): who or what, by the group's own name.
      for (const c of m.chosen) {
        for (const v of c.values) line.append(el("span", { className: "chip on" }, chipDot(v), `${c.group}: ${v}`));
      }
    }
    const open = el("button", { className: "btn where-edit", text: "Change", tip: "Choose the hands and regions this card comes up at" });
    open.addEventListener("click", () => openWherePicker(open));
    const warning = whereWarning(m);
    const body = el("div", { className: "where-body" }, el("div", { className: "where-head" }, line, open));
    if (warning !== undefined) body.append(el("p", { className: "where-warn", text: warning }));
    return section("Where", "where this card can come up", body);
  }

  /**
   * The Where sentence: Dealing's lead in a box on the project map (mock-up
   * screen 6). "Comes up at [the Inn] when [condition]", the hand a chip that
   * opens the hand, Change opening the same picker the foot row uses.
   *
   * The condition is a READING of the When editor below, in the card face's
   * quiet "if" styling, and is repainted as that editor changes rather than on
   * the next redraw: a sentence that disagreed with the panel under it would be
   * worse than no sentence.
   */
  function whereLead(): { root: HTMLElement; paintWhen: () => void } {
    const m = whereModel(box, edit.tags);
    const anywhere = isAnywhere(m);
    if (!anywhere) madeInDeck.delete(card.id);   // answered: where was chosen
    const line = el("p", { className: "where-sentence" }, el("span", { text: "Comes up" }));
    const joiner = (text: string): HTMLElement => el("span", { className: "where-join", text });
    if (anywhere) {
      // The word in amber: "anywhere" is a real answer, but in a box with a
      // place axis it is usually the answer nobody chose.
      line.append(el("span", { className: "where-anyword", text: "anywhere" }));
    } else {
      const parts: HTMLElement[][] = [];
      if (m.places.length > 0) {
        const chips: HTMLElement[] = [joiner("at")];
        m.places.forEach((p, i) => {
          if (i > 0) chips.push(joiner("or"));
          const hand = box.hands.find((x) => x.gameId === p.gameId);
          const chip = el("button", { className: "chip on where-place where-chip", tip: `Open ${p.title}` }, iconNode("pin", 11), p.title);
          if (hand) chip.addEventListener("click", () => h.openHand(box.id, hand.id));
          chips.push(chip);
        });
        parts.push(chips);
      }
      for (const r of m.regions) {
        parts.push([joiner("anywhere in"), ...r.values.flatMap((v, i) => [
          ...(i > 0 ? [joiner("or")] : []),
          el("span", { className: "chip on where-region where-chip" }, chipDot(v), v),
        ])]);
      }
      // Any other place axis reads as the hand page's tier does (hand-tiers.ts
      // `tierLabel`): "wherever npc is gareth or mira", one clause per group,
      // the values kept as chips.
      for (const c of m.chosen) {
        parts.push([joiner(`wherever ${c.group} is`), ...c.values.flatMap((v, i) => [
          ...(i > 0 ? [joiner("or")] : []),
          el("span", { className: "chip on where-chip" }, chipDot(v), v),
        ])]);
      }
      parts.forEach((p, i) => { if (i > 0) line.append(joiner("and")); line.append(...p); });
    }
    const when = el("span", { className: "where-when" });
    const paintWhen = (): void => {
      const src = (edit.condition ?? "").trim();
      when.replaceChildren(...(src
        ? [joiner("when"), el("span", { className: "cardwhen where-cond" }, previewCondition(src, catalogue))]
        : [el("span", { className: "where-join where-always", text: ", always." })]));
    };
    paintWhen();
    line.append(when);

    const root = el("div", { className: "doc-panel where-lead" }, line);
    const warning = whereWarning(m);
    if (warning !== undefined) root.append(el("p", { className: "where-warn", text: warning }));
    // The one-time note (mock-up 4b), for a card made in a deck: it names no
    // hand because a deck has none to give it, not because anybody decided.
    if (anywhere && madeInDeck.has(card.id)) {
      const ends = box.hands.length >= 2
        ? `, from ${box.hands[0]!.title ?? box.hands[0]!.gameId} to ${box.hands[box.hands.length - 1]!.title ?? box.hands[box.hands.length - 1]!.gameId}` : "";
      const choose = el("button", { className: "btn", text: "Choose where" });
      choose.addEventListener("click", () => openWherePicker(choose));
      root.append(el("div", { className: "where-note" },
        el("span", { className: "where-note-glyph" }, iconNode("warning", 13)),
        el("div", {},
          el("p", { text: `A card made in a deck comes up anywhere: at every hand in ${box.title ?? box.gameId}${ends}. Choose where it comes up to keep it to one.` }),
          el("div", { className: "where-note-acts" }, choose,
            el("button", { className: "btn", text: "Anywhere is right", onClick: () => { madeInDeck.delete(card.id); drawCentre(); } })))));
    }
    const change = el("button", { className: "btn where-edit", text: "Change", tip: "Choose the hands and regions this card comes up at" });
    change.addEventListener("click", () => openWherePicker(change));
    root.append(el("div", { className: "where-foot" },
      el("span", { text: `In ${deck.title ?? deck.gameId}, ${box.title ?? box.gameId}` }),
      el("span", { className: "crumb-spacer" }), change));
    return { root, paintWhen };
  }

  /** The picker: hands and regions in separate sections, because a hand plus
   *  a region is an AND and a single flat list invites the union reading. */
  function openWherePicker(anchor: HTMLElement): void {
    const toggle = (group: string, value: string): void => {
      let m = edit.tags.find((x) => x.group === group);
      if (!m) { m = { group, values: [] }; edit.tags.push(m); }
      m.values = m.values.includes(value) ? m.values.filter((v) => v !== value) : [...m.values, value];
      edit.tags = edit.tags.filter((x) => x.values.length > 0);
      commit(); drawCentre();
    };
    openPopover(anchor, () => {
      const wrap = el("div", { className: "where-pick" });
      const homes = edit.tags.find((t) => t.group === PLACE_GROUP)?.values ?? [];
      wrap.append(el("span", { className: "insp-label", text: "Hands" }));
      const placeRow = el("div", { className: "insp-chips" });
      for (const hd of box.hands) {
        const on = homes.includes(hd.gameId);
        const zone = Object.values(hd.tags)[0];
        const chip = el("button", { className: `chip where-place${on ? " on" : ""}` }, iconNode("pin", 11), hd.title ?? hd.gameId,
          zone !== undefined ? el("span", { className: "where-in", text: zone }) : null);
        chip.addEventListener("click", () => toggle(PLACE_GROUP, hd.gameId));
        placeRow.append(chip);
      }
      wrap.append(placeRow);
      // Every place axis (ops place-axis.ts, via where.ts): the zone group, then
      // every group a hand binds, which a card answers "where" with as surely
      // as a zone.
      for (const g of box.tagGroups.filter((x) => x.placeAxis === true)) {
        // The group's own name, not a sentence: "Anywhere in area" reads badly for
        // a group called "area", and the chips below already say "anywhere in X".
        wrap.append(el("span", { className: "insp-label", text: `${g.gameId.charAt(0).toUpperCase()}${g.gameId.slice(1)}` }));
        const row = el("div", { className: "insp-chips" });
        const on = edit.tags.find((t) => t.group === g.gameId)?.values ?? [];
        for (const v of g.values) {
          const chip = el("button", { className: `chip${on.includes(v) ? " on" : ""}` }, chipDot(v), v);
          chip.addEventListener("click", () => toggle(g.gameId, v));
          row.append(chip);
        }
        wrap.append(row);
      }
      wrap.append(el("p", { className: "where-hint", text: "A card that names no hand comes up anywhere. Choosing a hand AND a region means both must match, which is usually not what you want." }));
      return wrap;
    });
  }

  // The Fields tab body: the box-declared card fields as label/control rows.
  // The tab is the label, so the panel carries no section head of its own.
  function cardFieldsBody(): Node[] {
    if (box.fields.length === 0) {
      // Both halves of the orientation the audit found missing: where fields
      // come from, AND what a card with none IS - the cold-start question a
      // narrative designer brings to every card page.
      return [el("p", { className: "doc-tab-note", text: "No card fields declared. Define what every card can carry on the box's Card template tab. A card with no fields is a key. Your game looks it up by game id and supplies the text." })];
    }
    const setField = (name: string, value: string): void => {
      let f = edit.fields.find((x) => x.name === name);
      if (!f) { f = { name, value: "" }; edit.fields.push(f); }
      f.value = value;
    };
    const fieldBody = box.fields.map((decl) =>
      fieldRow(decl, edit.fields.find((f) => f.name === decl.name)?.value ?? "",
        (v) => setField(decl.name, v), commit));
    return [el("div", { className: "doc-panel" }, ...fieldBody)];
  }

  drawCentre();
}

/**
 * One declared field as a label + control row, the control chosen by the
 * declared type (rule 7: a declared type is a contract, so offer its values
 * rather than asking for typing).
 *
 * Shared by the card's Fields tab and an outcome's Fields block, which is why
 * it is out here: the two lists are the same question asked of two entities
 * (design/outcome-fields-brief.md), and a copy of this would have drifted the
 * first time a type gained a control.
 */
function fieldRow(decl: FieldDeclDto, current: string, set: (value: string) => void, commit: () => void): HTMLElement {
  let control: HTMLElement;
  if (decl.type === "boolean" || (decl.type === "enum" && (decl.values?.length ?? 0) > 0)) {
    const sel = el("select", { className: "insp-input insp-mono" });
    const none = el("option", { text: "(unset)" }); none.value = ""; sel.append(none);
    const opts = decl.type === "boolean" ? ["true", "false"] : decl.values!;
    for (const v of opts) { const o = el("option", { text: v }); o.value = v; if (v === current) o.selected = true; sel.append(o); }
    sel.addEventListener("change", () => { set(sel.value); commit(); });
    control = sel;
  } else {
    // string / number / flags: text, coerced on save.
    const input = el("input", { className: "insp-input insp-mono" });
    input.value = current; input.placeholder = `<${decl.type}>`;
    input.addEventListener("input", () => set(input.value));
    input.addEventListener("change", commit);
    control = input;
  }
  return el("div", { className: "doc-row" }, el("span", { className: "doc-row-label", text: decl.name }), control);
}

// The identity panel every entity's inspector opens with: Title (where the type
// has one) + gameId, in the shared subpanel chrome, then any type-specific
// extras. When a title is present the gameId is the auto/pinned field that
// derives from it (and refreshes as the title is typed, both being in this one
// pane); without a title (query, dimension) the gameId is a plain field. A title
// commits per-keystroke by default; deck passes "blur" since its save moves the
// shard file.
/** The shared declaration list (rule 6), wrapped for centre editors: mounts
 *  into a fresh host and feeds every change to the caller's autosave. */
function propList(
  decls: PropertyDeclDto[], onChange: () => void, addLabel: string,
  /** A card TEMPLATE's fields, which are data for the host and carry no state:
   *  neither sharing axis applies to them. `rowExtras` hangs a line's worth at
   *  each row's end (prop-list.ts). */
  opts: { sharingSwitches?: boolean; rowExtras?: (decl: PropertyDeclDto) => HTMLElement | null; shareScope?: ShareScope } = {},
): HTMLElement {
  const host = el("div", { className: "prop-list" });
  mountPropertyList(host, decls, { onChange, addLabel, ...opts });
  return host;
}

interface IdentityField { get: () => string; set: (v: string) => void; }

// The document heading every centre editor opens with (beneath any back
// crumb): a quiet type label with an overflow menu (Delete lives there), the
// editable Title (or, for name-only entities, the gameId as the name), the
// gameId auto/pin chip, and the Purpose - identity all in one place, quietly
// editable (inspector-free model, ux-changes v3).
export function documentHeading(label: string, opts: {
  title?: IdentityField & { placeholder?: string; commit: () => void; commitOn?: "input" | "blur" };
  /** Name-only entities (query, dimension): the gameId IS the name. */
  name?: IdentityField & { placeholder?: string; commit: () => void };
  /** The gameId auto/pin chip, in the header for every titled entity
   *  (tab-grammar 2): identity is never hidden by a tab switch. */
  gameId?: IdentityField & { fallback: string; deriveFrom: () => string; commit: () => void };
  /** One line per installation that depends on this entity
   *  (design/engine-server.md 4.11), in the density grammar: quiet, and only
   *  when there IS a venue, which is almost never. */
  contract?: string[];
  /** Does the claim still hold? Asked again whenever the address is edited: a
   *  venue's claim is on the NAME it bound, so renaming the entity in place
   *  lets it go, and the line and the chip's mark go with it. Absent means it
   *  always holds, which is what everything but a rename field wants. */
  contractHolds?: () => boolean;
  purpose?: IdentityField & { placeholder?: string; commit: () => void; commitOn?: "input" | "blur" };
  /** A quiet line under the title saying what KIND of thing this is, in the
   *  author's own words: a hand's template title ("Places in the village"). */
  kind?: string;
  menu?: { label: string; danger?: boolean; onClick: () => void }[];
  /** The comment-thread opener, in the TOPLINE beside the More menu: the row that
   *  means "about this whole document". Patterpad puts it in the inspector
   *  level's action row; we have no inspector, so this is the equivalent. */
  /** `on` is the id the thread is filed against. It is stamped on the bubble so a
   *  caller holding only an id can FIND this anchor once the document renders,
   *  which is how the feedback walk arrives at a comment it navigated to. */
  comments?: { on: string; count: number; open: (anchor: HTMLElement) => void };
  afterEdit?: () => void;
}): HTMLElement {
  const head = el("div", { className: "doc-head" });
  const topline = el("div", { className: "doc-topline" }, caption(label));
  if (opts.comments) {
    const c = opts.comments;
    const bubble = el("button", {
      className: `btn ghost doc-thread${c.count > 0 ? " has" : ""}`,
      tip: c.count > 0 ? `${plural(c.count, "open comment")}` : "Comment on this",
    }, iconNode("comment", 12), c.count > 0 ? String(c.count) : null);
    bubble.dataset.threadFor = c.on;
    bubble.dataset.tipNone = "Comment on this";
    bubble.addEventListener("click", (e) => { e.preventDefault(); c.open(bubble); });
    topline.append(bubble);
  }
  if (opts.menu?.length) {
    const items = opts.menu;
    const more = el("button", { className: "btn ghost icon doc-menu", tip: "More" }, iconNode("more"));
    more.addEventListener("click", (e) => {
      const r = more.getBoundingClientRect();
      e.preventDefault();
      openContextMenu(r.left, r.bottom + 4, items);
    });
    topline.append(more);
  }
  head.append(topline);
  // The venue's claim, built once and shown while it holds. One line per
  // installation and nothing at all otherwise, which is the density rule: a
  // project with no server has no venue to be told about.
  const claim = (): string[] | undefined =>
    ((opts.contractHolds?.() ?? true) ? opts.contract : undefined);
  const claimLines = (opts.contract ?? []).map((line) => el("p", { className: "doc-contract", text: line }));
  const paintClaim = (): void => {
    const held = claim() !== undefined;
    for (const line of claimLines) line.hidden = !held;
  };
  let gid: { root: HTMLElement; refresh: () => void } | undefined;
  if (opts.gameId) {
    const g = opts.gameId;
    gid = gameIdField(g.get, g.set, () => gameIdify(g.deriveFrom()) || g.fallback,
      // The rename is what can let the claim go, so the lines are asked again
      // on the same beat the chip is.
      () => { g.commit(); paintClaim(); }, claim);
  }
  // The title and the address share ONE ROW, the address right-aligned. It used
  // to have a row of its own under the title, which cost a line of vertical space
  // on every document in the app for a chip that is usually just confirming what
  // the title already said.
  const titleRow = el("div", { className: "doc-titlerow" });
  if (opts.title) {
    const t = opts.title;
    const input = el("input", { className: "insp-input insp-title doc-title" });
    input.value = t.get(); input.placeholder = t.placeholder ?? "Title";
    const took = (v: string): void => { t.set(v); gid?.refresh(); paintClaim(); if ((t.commitOn ?? "input") === "input") { t.commit(); opts.afterEdit?.(); } };
    input.addEventListener("input", () => took(input.value));
    input.addEventListener("change", () => { t.commit(); opts.afterEdit?.(); });
    escapeRestores(input, took);
    titleRow.append(input);
  }
  if (opts.name) {
    const n = opts.name;
    const input = el("input", { className: "insp-input insp-mono doc-title doc-name" });
    input.value = n.get(); input.placeholder = n.placeholder ?? "Name";
    input.spellcheck = false;   // a name, not prose (parity row 52)
    const took = (v: string): void => { n.set(v); n.commit(); opts.afterEdit?.(); };
    input.addEventListener("input", () => took(input.value));
    input.addEventListener("change", () => { n.commit(); opts.afterEdit?.(); });
    escapeRestores(input, took);
    titleRow.append(input);
  }
  if (gid) titleRow.append(el("div", { className: "doc-gid" }, gid.root));
  if (titleRow.childElementCount > 0) head.append(titleRow);
  if (opts.kind !== undefined) head.append(el("p", { className: "doc-kind", text: opts.kind }));
  // The venue's claim on this entity, under the name it claims.
  for (const line of claimLines) head.append(line);
  paintClaim();
  if (opts.purpose) {
    const p = opts.purpose;
    // LABELLED, and the same word on all seven types that have this field
    // (design review 2026-08, B1). It had no label at all - only a placeholder,
    // which is gone the moment anything is typed, and which said seven different
    // things across the types. One field in one position in one face, carrying
    // "the story beat" on a card and "what does this group classify" on a tag
    // group, with nothing on screen to tell them apart once filled in.
    //
    // The ruling: it is ALWAYS documentation and never player-facing, on every
    // type, so one word is the right answer rather than a compromise between
    // seven. "Purpose" is that word because it is what the format already calls
    // the field, so the app, the shards and the docs agree.
    head.append(el("label", { className: "doc-purpose-label", text: "Purpose" }));
    const ta = el("textarea", { className: "insp-input insp-beat doc-purpose" });
    ta.value = p.get(); ta.rows = 2; ta.placeholder = p.placeholder ?? "";
    ta.addEventListener("input", () => { p.set(ta.value); if ((p.commitOn ?? "input") === "input") p.commit(); });
    ta.addEventListener("change", () => { p.commit(); opts.afterEdit?.(); });
    head.append(ta);
  }
  return head;
}

/** Derived, read-only usage as a recessive footer line of the document. */
export function derivedFooter(...lines: (string | Node | null)[]): HTMLElement {
  const f = el("div", { className: "doc-footer" });
  for (const l of lines) { if (l) f.append(typeof l === "string" ? el("span", { text: l }) : l); }
  return f;
}

// Fill (or refill) an outcome's accordion header: chevron + title + change
// count, then the gate shown in the same quiet "if" style as card faces.
function fillOutcomeHeader(row: HTMLElement, o: OutcomeEdit, open: boolean, catalogue: ConditionProperty[]): void {
  row.className = `outcome-row${open ? " open" : ""}`;
  row.dataset.outcome = o.id;
  const changes = `${plural(o.changes.length, "change")}`;
  const line = el("div", { className: "outcome-row-line" },
    // The vocabulary's chevron (the Unicode small triangles stay tiny at any
    // font size); the open state rotates it.
    el("span", { className: "outcome-row-chev" }, iconNode("collapsed", 12)),
    el("span", { className: "outcome-row-title", text: o.title ?? o.gameId }),
    el("span", { className: "outcome-row-sum", text: changes }),
  );
  const kids: HTMLElement[] = [line];
  if (o.gate) kids.push(el("div", { className: "cardwhen outcome-row-when" }, el("span", { className: "cardwhen-if", text: "if" }), previewCondition(o.gate, catalogue)));
  row.replaceChildren(...kids);
}

/**
 * The comment opener for a sub-item: an outcome, which is the one commentable
 * thing that is not a document of its own (design/annotation.md section 2).
 *
 * The same bubble as a document topline, in the outcome's own BODY rather than
 * the card's header, because a thread about "the player pays the toll" belongs to
 * that outcome and not to the card that holds it. In the body rather than the
 * closed row for the same reason the row carries no other control: a hairline
 * row of ten outcomes with ten bubbles on it would be noise, and the count is
 * already visible on the card's own bubble.
 */
function commentBubble(on: string, count: number, open: (anchor: HTMLElement) => void): HTMLElement {
  const bubble = el("button", {
    className: `btn ghost doc-thread${count > 0 ? " has" : ""}`,
    tip: count > 0 ? `${plural(count, "open comment")}` : "Comment on this outcome",
  }, iconNode("comment", 12), count > 0 ? String(count) : null);
  bubble.dataset.threadFor = on;
  bubble.dataset.tipNone = "Comment on this outcome";
  bubble.addEventListener("click", (e) => { e.preventDefault(); open(bubble); });
  return bubble;
}

/**
 * Bring every comment bubble under `root` up to date, in place.
 *
 * For a thread posted somewhere that does not rebuild the page: a marker on a
 * canvas. Rebuilding would throw the canvas away (its camera, its selection),
 * so the canvas repaints its markers and this repaints the bubbles, and the
 * map's heading stops showing the count it was drawn with.
 */
export function repaintBubbles(root: ParentNode, count: (id: string) => number): void {
  root.querySelectorAll<HTMLElement>(".doc-thread[data-thread-for]").forEach((bubble) => {
    const n = count(bubble.dataset.threadFor!);
    const tip = n > 0 ? plural(n, "open comment") : bubble.dataset.tipNone ?? "Comment on this";
    bubble.classList.toggle("has", n > 0);
    bubble.dataset.tip = tip;
    bubble.setAttribute("aria-label", tip);
    const icon = bubble.firstElementChild;
    bubble.replaceChildren(...(icon ? [icon] : []), ...(n > 0 ? [String(n)] : []));
  });
}

// The outcomes accordion in the centre: a light row per outcome that expands in
// place to its full (wide) editor. Only one is open at a time.
function outcomeAccordion(edit: Required<CardEdit>, outcomeFields: FieldDeclDto[], catalogue: ConditionProperty[], commit: () => void, setExpanded: (id: string | undefined) => void, h: InspectorHost,
  /** How the card's paired Patter scene reaches each outcome, by outcome id (OutcomeDto.patter). */
  patter: ReadonlyMap<string, PatterReach> = new Map()): HTMLElement {
  const list = el("div", { className: "cardedit-outcomes" });
  const duplicate = (o: OutcomeEdit): void => {
    const at = edit.outcomes.indexOf(o);
    const taken = new Set(edit.outcomes.map((x) => x.gameId));
    let gid = `${o.gameId}-copy`;
    for (let n = 2; taken.has(gid); n++) gid = `${o.gameId}-copy-${n}`;
    const clone: OutcomeEdit = {
      ...o, id: freshOutcomeId(), gameId: gid,
      ...(o.title !== undefined ? { title: `${o.title} (copy)` } : {}),
      changes: o.changes.map((c) => ({ ...c })),
      // Copied, not shared: a spread would leave the clone editing the
      // original's rows, which is the bug `changes` above already avoids.
      ...(o.fields !== undefined ? { fields: o.fields.map((f) => ({ ...f })) } : {}),
    };
    edit.outcomes.splice(at + 1, 0, clone); commit(); setExpanded(clone.id);
  };
  const remove = (o: OutcomeEdit): void => {
    edit.outcomes = edit.outcomes.filter((x) => x !== o);
    commit(); setExpanded(expandedOutcome === o.id ? undefined : expandedOutcome);
  };
  /**
   * Move an outcome up or down the list.
   *
   * The order outcomes are offered in is authorial: a deliberate first option, a
   * "walk away" last. It reaches the game now (the bundle carries display order,
   * not id order), so it needs a way to be set.
   *
   * In the context menu rather than as buttons on the row, because this row
   * deliberately carries no controls (see fillOutcomeHeader: ten hairline rows
   * with ten control clusters is noise). Up/down rather than drag is Patterpad's
   * gesture for a list of settings rows (`moveItem` in its dom.ts, used by the
   * field, property and cast lists); it reserves drag for the scene nav.
   *
   * No mutation needed: saveCard rewrites the whole list and stamps `order` from
   * position, so a swap here IS the reorder.
   */
  const move = (o: OutcomeEdit, delta: number): void => {
    const i = edit.outcomes.indexOf(o);
    const j = i + delta;
    if (j < 0 || j >= edit.outcomes.length) return;
    [edit.outcomes[i], edit.outcomes[j]] = [edit.outcomes[j]!, edit.outcomes[i]!];
    commit();
  };
  for (const o of edit.outcomes) {
    const open = o.id === expandedOutcome;
    // Closed rows are hairline list rows inside the Outcomes panel; the open
    // one becomes a lifted panel of its own (centre-clarity 2).
    const item = el("div", { className: `outcome-item${open ? " open" : ""}` });
    const header = el("button", { className: "outcome-row", onClick: () => setExpanded(open ? undefined : o.id) });
    fillOutcomeHeader(header, o, open, catalogue);
    header.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, [
        { label: open ? "Collapse" : "Edit", onClick: () => setExpanded(open ? undefined : o.id) },
        { label: "Move up", onClick: () => move(o, -1), disabled: edit.outcomes.indexOf(o) === 0 },
        { label: "Move down", onClick: () => move(o, 1), disabled: edit.outcomes.indexOf(o) === edit.outcomes.length - 1 },
        { label: "Duplicate", onClick: () => duplicate(o) },
        { label: "Remove", danger: true, onClick: () => remove(o) },
      ]);
    });
    item.append(header);
    if (open) item.append(outcomeBody(o, outcomeFields, catalogue, commit, () => fillOutcomeHeader(header, o, true, catalogue), () => remove(o), h, patter.get(o.id)));
    list.append(item);
  }
  const add = el("button", { className: "insp-add", text: "+ Outcome" });
  add.addEventListener("click", () => {
    const taken = new Set(edit.outcomes.map((o) => o.gameId));
    let gameId = "outcome";
    for (let n = 2; taken.has(gameId); n++) gameId = `outcome-${n}`;
    const created: OutcomeEdit = { id: freshOutcomeId(), gameId, title: "New outcome", changes: [] };
    edit.outcomes.push(created);
    commit(); setExpanded(created.id);
  });
  list.append(add);
  return list;
}

// The expanded outcome's full editor - wide, inline in the centre. Field edits
// commit and refresh the header (syncHeader) so its summary stays live.
type PatterReach = NonNullable<OutcomeDto["patter"]>;

function outcomeBody(o: OutcomeEdit, outcomeFields: FieldDeclDto[], catalogue: ConditionProperty[], commit: () => void, syncHeader: () => void, remove: () => void, h: InspectorHost, patter?: PatterReach): HTMLElement {
  const save = (): void => { commit(); syncHeader(); };
  const body = el("div", { className: "outcome-body" });

  // Paper first (the outcome's title + beat, reading face, chromeless), then
  // the machinery bare - the open item is already a lifted panel, so no
  // panels-within-panels.
  const gameId = gameIdField(
    () => o.gameId ?? "", (v) => { o.gameId = v; },
    () => gameIdify(o.title ?? "") || o.id, save,
  );
  const title = textField(o.title ?? "", "insp-input outcome-title", (v) => { o.title = v; gameId.refresh(); }, save);
  title.placeholder = "Outcome title";
  body.append(title);
  body.append(el("div", { className: "doc-gid outcome-gid" }, gameId.root,
    commentBubble(o.id, h.openThreads(o.id), (a) => h.showComments(o.id, o.title || o.gameId, a))));

  // The seventh type, and labelled like the other six (B1). This one is built
  // by hand rather than through documentHeading, which is how it came to be the
  // only purpose field whose placeholder said "in the story".
  body.append(el("label", { className: "doc-purpose-label", text: "Purpose" }));
  const purpose = el("textarea", { className: "insp-input outcome-beat" });
  purpose.value = o.purpose ?? "";
  purpose.rows = 2;
  purpose.placeholder = "What this outcome does";
  purpose.addEventListener("input", () => { o.purpose = purpose.value; commit(); });
  purpose.addEventListener("change", commit);
  body.append(purpose);

  // How the card's Patter scene reaches this outcome, when the project is paired with a Patter
  // project: read off its published bundle, so it says what the game will do. Quiet, like a
  // note, because it is a fact about another file, and the scene is where it is changed.
  if (patter) {
    body.append(bare("In Patter", `how the scene “${patter.scene}” reaches it`,
      ...patter.via.map((line) => el("div", { className: "outcome-patter", text: line }))));
  }

  // The outcome's template data, straight after the paper and before the
  // machinery: an after-line is prose the author writes in the same breath as
  // the purpose, not a condition. Drawn ONLY when the box declares outcome
  // fields - an outcome is an item inside a card, not a page of its own, so the
  // empty-state teaching a card's Fields tab carries would be a paragraph of
  // box configuration in the middle of somebody's writing. The box's Card
  // template tab is where the declaring is taught.
  if (outcomeFields.length > 0) {
    const setField = (name: string, value: string): void => {
      const fields = o.fields ?? (o.fields = []);
      const f = fields.find((x) => x.name === name);
      if (f) f.value = value; else fields.push({ name, value });
    };
    const rows = outcomeFields.map((decl) =>
      fieldRow(decl, o.fields?.find((f) => f.name === decl.name)?.value ?? "",
        (v) => setField(decl.name, v), save));
    body.append(bare("Fields", "what this outcome hands the game", ...rows));
  }

  const gateHost = el("div", { className: "insp-exed" });
  mountCondition(gateHost, { src: o.gate ?? "", properties: catalogue, onChange: (src) => { if (src.trim()) o.gate = src; else delete o.gate; save(); } });
  body.append(bare("When", "the condition for this outcome to be offered", gateHost));

  const changeHost = el("div", { className: "insp-exed" });
  mountChanges(changeHost, { changes: o.changes, properties: catalogue, onChange: (c) => { o.changes = c; save(); } });
  // B11: the hint named the restriction without explaining it, so an author who
  // wanted "add one to gold" learned the rule inside the expression editor -
  // while debugging, which is the worst place to meet it. The idiom is the
  // second half of the sentence the hint was already starting.
  body.append(bare("Changes", "what it sets (a change replaces the value, so add one with @story.gold + 1)", changeHost));

  body.append(el("button", { className: "btn insp-del small outcome-remove", text: "Remove outcome", onClick: remove }));
  return body;
}

// The card's mechanical settings - the inspector level: the host-facing gameId
// (computed from the title until pinned) and how the card ranks against rivals.

// --- the deck level -----------------------------------------------------------


// --- the hand level -------------------------------------------------------------
// A hand is a place on the board (schema 2.6): an instance of a hand template
// (chosen tags fill its holes; everything unset follows the template live) or
// standalone with its own inline rule.

/**
 * The hole picker's second half: "from a property" (design/engine-server.md
 * 4.6). The tags come first because filling a hole with one is what a hand
 * usually does; a property reference is the same control saying "wherever this
 * says", so it belongs in the same list rather than behind a mode switch.
 *
 * Nothing is appended when the project declares nothing that could name a tag,
 * which is most projects: an empty group would teach a reader to expect a
 * choice that is not there.
 */
function appendPropertyFills(sel: HTMLSelectElement, from: string[], current: string): void {
  // A hand that moves is a general engine feature, offered at every rung
  // (ruling of 2026-09-05: it was gated at venue, and a hole filled from a
  // property is not a venue's). Asked of the ladder rather than assumed, so
  // one table stays the whole answer; a reference already in the shard shows
  // whatever the answer, since hiding must never silently drop content.
  if (!shows("propertyHole") && !isHoleRef(current)) return;
  if (from.length === 0 && !isHoleRef(current)) return;
  const group = document.createElement("optgroup");
  group.label = "from a property";
  for (const ref of from) {
    const o = el("option", { text: ref });
    o.value = ref;
    if (ref === current) o.selected = true;
    group.append(o);
  }
  sel.append(group);
  // A reference the project no longer declares still has to show, or saving
  // this hand would silently drop the hole's fill.
  if (isHoleRef(current) && !from.includes(current)) {
    const o = el("option", { text: `${current} (not declared)` });
    o.value = current; o.selected = true;
    group.append(o);
  }
}

export function renderHandWorkspace(centre: HTMLElement, box: BoxDto, detail: HandDetail, catalogue: ConditionProperty[], h: InspectorHost): void {
  const boxId = box.id;
  const edit: HandEdit & { gameId: string; title: string; purpose: string; slots: string } = {
    gameId: detail.gameIdPinned ?? "",
    title: detail.title ?? "",
    purpose: detail.purpose ?? "",
    ...(detail.template !== undefined ? { template: detail.template } : {}),
    chosen: detail.chosen.map((c) => ({ group: c.group, value: c.value })),
    ...(detail.rule !== undefined ? {
      rule: {
        bindings: detail.rule.bindings.map((b) => ({ ...b })),
        condition: detail.rule.condition ?? "",
        slots: detail.rule.slots,
      },
    } : {}),
    slots: detail.slots,
    properties: detail.properties.map((p) => ({ ...p })),
  };
  const commit = (): void => h.saveHand(boxId, detail.id, edit);
  /** The address this hand answers to as it is being edited: the pinned one, or
   *  the one the title derives, which is what the chip itself shows. */
  const addressNow = (): string => edit.gameId.trim() || gameIdify(edit.title) || detail.gameId;
  const redraw = (): void => draw();
  const standalone = (): boolean => edit.template === undefined || edit.template === "";

  // The Cards tab's answer, asked of main every time this page is built: what
  // could come up here moves with edits made anywhere (a card's place, this
  // hand's own zone), and the page is rebuilt on each of them. Undefined until
  // it arrives; it then paints into the tab and the count, never through a
  // whole redraw, so a title being typed above keeps its caret.
  let cards: HandCardsDto | null | undefined;
  let showAnywhere = false;
  let cardsHost: HTMLElement | undefined;
  let cardsTab: HTMLElement | undefined;
  // Each row reads its condition against its OWN deck's catalogue, as the card
  // face does: the box's catalogue has no @deck, so a deck property would read
  // as unknown here and declared on the card's own page.
  const catalogues = new Map<string, ConditionProperty[]>();
  void (async () => {
    const answer = await h.handCards(boxId, detail.id);
    if (answer) {
      const decks = new Set([...answer.only, ...answer.never, ...answer.tiers.flatMap((t) => t.cards), ...answer.anywhere].map((r) => r.deck));
      await Promise.all([...decks].map(async (d) => { catalogues.set(d, await h.deckCatalogue(d)); }));
    }
    cards = answer;
    if (centre.isConnected) paintCards();
  })();
  const hereTitle = (): string => edit.title.trim() || detail.title || detail.gameId;
  /** One card that could come up here (`handCardRow`), with its gate badges,
   *  or the reason it never can. */
  const cardRow = (ref: HandCardRef & { why?: string }): HTMLElement | null =>
    handCardRow(box, ref, catalogues.get(ref.deck) ?? catalogue, detail.gameId,
      (deck, card) => h.openCardFromHand(boxId, deck, card, { id: detail.id, title: hereTitle() }),
      { ...(cards?.gated[ref.card] !== undefined ? { gates: cards.gated[ref.card] } : {}), ...(ref.why !== undefined ? { why: ref.why } : {}) });

  /** The Cards tab, painted into its host: the tiers, the Anywhere count, and
   *  the one way to add a card that belongs here. */
  function paintCards(): void {
    if (cardsTab && cards) {
      cardsTab.querySelector(".doc-tab-n")?.remove();
      const n = tierCount(cards);
      cardsTab.append(el("span", { className: "doc-tab-n", text: String(n) }));
      cardsTab.classList.toggle("zero", n === 0);
    }
    if (!cardsHost) return;
    if (cards === undefined) { cardsHost.replaceChildren(); return; }
    if (cards === null) { cardsHost.replaceChildren(el("p", { className: "doc-tab-note", text: "This hand is gone." })); return; }
    const c = cards;
    // The count is the tier's data, so it stays up; a section hint waits to be
    // approached, which is right for teaching text and wrong for a number.
    const tier = (label: string, refs: (HandCardRef & { why?: string })[], warn = false): HTMLElement => el("div", { className: `doc-sect${warn ? " handcards-never" : ""}` },
      el("div", { className: "doc-sect-head" }, caption(label), el("span", { className: "handcard-n", text: String(refs.length) })),
      refs.length > 0
        ? el("div", { className: "rowlist handcards" }, ...refs.map(cardRow))
        : el("p", { className: "doc-tab-note", text: "None." }));
    const boxName = box.title ?? box.gameId;
    // ANYWHERE IS A COUNT, not a list (plan item 1): in a big box it is most of
    // the box, and a place page that listed it would stop being about the place.
    const n = c.anywhere.length;
    const toggle = el("button", { className: "linkbtn", text: showAnywhere ? "Hide" : "Show",
      onClick: () => { showAnywhere = !showAnywhere; paintCards(); } });
    const anyLine = el("div", { className: "doc-sect" },
      n > 0
        ? el("p", { className: "handcard-any" }, el("span", { text: anywhereLine(c)! }), toggle)
        : el("p", { className: "handcard-any", text: `Every card in ${boxName} that could come up here is listed above.` }),
      n > 0 && showAnywhere ? el("div", { className: "rowlist handcards" }, ...c.anywhere.map(cardRow)) : null);
    const add = el("button", { className: "listrow ghost", text: "+ New card here" });
    add.addEventListener("click", () => openDeckPicker(add));
    const moving = movingNote(c);
    cardsHost.replaceChildren(
      ...(moving !== undefined ? [el("p", { className: "doc-tab-note", text: moving })] : []),
      tier("Only here", c.only),
      // Placed here by mistake (a tag that rules this hand out): shown, never
      // dropped, since this page is where the mistake should be caught.
      ...(c.never.length > 0 ? [tier(NEVER_LABEL, c.never, true)] : []),
      ...c.tiers.map((t) => tier(tierLabel(t), t.cards)),
      anyLine,
      add,
      // "Could", never "comes": nothing here evaluates a condition
      // (the antagonist review, ladder step 1, point 6).
      el("p", { className: "doc-tab-note", text: `Everything that could be dealt here from the decks in ${boxName}, whatever the conditions say right now.` }));
  }

  const openDeckPicker = (anchor: HTMLElement): void =>
    openDeckPickerFor(anchor, box, (deck) => h.newCardAtHand(boxId, deck, { id: detail.id, title: hereTitle() }));

  function draw(): void {
    const tabKey = `hand:${detail.id}`;
    // CARDS FIRST (plan item 2): a hand is a place, and what an author opens a
    // place for is what can happen there. The deck page made the same move for
    // the same reason (structure rule 4, 2026-08-04).
    const tab = currentDocTab(tabKey, "cards");
    const templateNow = detail.templates.find((t) => t.gameId === edit.template);
    const view = el("div", { className: "insp-card cardedit" });
    // What kind of hand this is, in the designer's own words: its template's
    // title ("Places in the village", "People you can talk to"), else its name.
    // The round-3 ruling: one noun on screen, "hand", and the author's word for
    // what their hands ARE comes from here rather than from a second noun.
    const kindOf = standalone() ? undefined : box.templates.find((t) => t.gameId === edit.template);
    view.append(documentHeading("Hand", {
      ...(kindOf !== undefined ? { kind: kindOf.title ?? kindOf.gameId } : {}),
      title: { get: () => edit.title, set: (v) => { edit.title = v; }, placeholder: "Hand title", commit },
      gameId: { get: () => edit.gameId, set: (v) => { edit.gameId = v; }, fallback: detail.gameId, deriveFrom: () => edit.title, commit },
      purpose: { get: () => edit.purpose, set: (v) => { edit.purpose = v; }, placeholder: "What sits here, and why", commit },
      menu: [{ label: "Delete hand", danger: true, onClick: () => h.deleteHand(boxId, detail.id) }],
      comments: { on: detail.id, count: h.openThreads(detail.id), open: (a) => h.showComments(detail.id, edit.title || detail.gameId, a) },
      // A venue binds a NAME, so the claim holds only while this hand still
      // answers to the one it bound. Renaming it in place is exactly when a
      // designer needs to watch the claim let go, and until 2026-09-07 the line
      // and the mark stood until the page was re-entered.
      ...(detail.contract !== undefined
        ? { contract: detail.contract, contractHolds: () => addressNow() === detail.gameId }
        : {}),
    }));
    const declared = standalone() ? edit.rule?.slots ?? "unbounded" : templateNow?.slots ?? "unbounded";
    const slotsNow = /^\d+$/.test(edit.slots) ? Number(edit.slots)
      : (/^\d+$/.test(String(declared)) ? Number(declared) : undefined);
    const bar = docTabs([
      { key: "cards", label: "Cards", ...(cards ? { count: tierCount(cards) } : {}) },
      { key: "dealing", label: "Dealing" },
      { key: "slots", label: "Slots", ...(slotsNow !== undefined ? { count: slotsNow } : {}) },
      { key: "properties", label: "Properties", count: (standalone() ? edit.properties?.length ?? 0 : 0) },
    ], tab, (next) => { setDocTab(tabKey, next); draw(); });
    cardsTab = bar.firstElementChild as HTMLElement;
    view.append(bar);

    if (tab === "cards") {
      cardsHost = el("div", { className: "handcards-tab" });
      view.append(cardsHost);
      paintCards();
      centre.replaceChildren(view);
      return;
    }
    cardsHost = undefined;

    if (tab === "slots") {
      if (standalone()) {
        const isBounded = edit.rule !== undefined && edit.rule.slots !== "unbounded" && String(edit.rule.slots).trim() !== "";
        const seg = el("div", { className: "seg insp-seg" });
        for (const [label, on] of [["unbounded", !isBounded], ["bounded", isBounded]] as [string, boolean][]) {
          const b = el("button", { className: `seg-opt${on ? " on" : ""}`, text: label });
          b.addEventListener("click", () => {
            if (!edit.rule) edit.rule = { bindings: [], condition: "", slots: "unbounded" };
            edit.rule.slots = label === "unbounded" ? "unbounded" : (isBounded ? edit.rule.slots : "3");
            commit(); draw();
          });
          seg.append(b);
        }
        const size = el("input", { className: "insp-input insp-mono insp-short" });
        size.value = isBounded ? String(edit.rule!.slots) : ""; size.placeholder = "3"; size.disabled = !isBounded;
        size.addEventListener("input", () => { if (/^\d+$/.test(size.value) && edit.rule) edit.rule.slots = size.value; });
        size.addEventListener("change", commit);
        view.append(el("div", { className: "doc-panel cfg-panel" },
          cfgRow("Slots", "How many cards this hand holds.", el("div", { className: "insp-segrow" }, seg, size))));
      } else {
        const slots = textField(edit.slots, "insp-input insp-mono insp-short", (v) => { edit.slots = v; }, commit);
        slots.placeholder = String(declared);
        // Load-bearing subtitle: "blank follows the template" is the entire
        // meaning of an empty control, so it does not wait to be approached.
        const slotsRow = cfgRow("Slots", "The one template field an instance may override. Blank follows the template's slots.", slots);
        slotsRow.classList.add("cfg-loadbearing");
        view.append(el("div", { className: "doc-panel cfg-panel" }, slotsRow));
      }
      centre.replaceChildren(view);
      return;
    }

    if (tab === "properties") {
      if (standalone()) {
        view.append(el("div", { className: `doc-panel${(edit.properties ?? []).length === 0 ? " empty" : ""}` }, propList(edit.properties ?? [], commit, "+ Property", { shareScope: "hand" })),
          el("p", { className: "doc-tab-note", text: "Properties this hand carries for its cards, as @hand." }));
      } else {
        view.append(el("p", { className: "doc-tab-note", text: "These come from this hand's template. Edit them there and every hand of that kind follows." }));
      }
      centre.replaceChildren(view);
      return;
    }

    // Dealing: which kind of hand this is. An instance fills its template's
    // holes; a standalone hand carries its own rule inline.
    const pick = el("select", { className: "insp-input" });
    const alone = el("option", { text: "(standalone, its own rule)" }); alone.value = ""; if (standalone()) alone.selected = true;
    pick.append(alone);
    for (const t of detail.templates) {
      const o = el("option", { text: t.gameId });
      o.value = t.gameId; if (t.gameId === edit.template) o.selected = true;
      pick.append(o);
    }
    pick.addEventListener("change", () => {
      edit.template = pick.value;
      if (pick.value !== "") {
        const t = detail.templates.find((x) => x.gameId === pick.value);
        edit.chosen = (t?.chooses ?? []).map((group) => ({
          group, value: edit.chosen?.find((c) => c.group === group)?.value ?? "",
        }));
        delete edit.rule;
      } else if (!edit.rule) {
        edit.rule = { bindings: [], condition: "", slots: "unbounded" };
      }
      commit(); redraw();
    });
    view.append(section("Template", "the kind of hand this is", pick));

    if (!standalone()) {
      // One chosen row per hole: the tags that make this instance concrete.
      const holes = templateNow?.chooses ?? [];
      if (holes.length > 0) {
        let moves = false;
        const rows = holes.map((group) => {
          const current = edit.chosen?.find((c) => c.group === group)?.value ?? "";
          const options = detail.groups.find((g) => g.gameId === group)?.values
            ?? detail.chosen.find((c) => c.group === group)?.values ?? [];
          const sel = el("select", { className: "insp-input insp-mono" });
          const none = el("option", { text: "(choose)" }); none.value = ""; sel.append(none);
          for (const v of options) { const o = el("option", { text: v }); o.value = v; if (v === current) o.selected = true; sel.append(o); }
          appendPropertyFills(sel, detail.movableFrom, current);
          if (isHoleRef(current)) moves = true;
          sel.addEventListener("change", () => {
            edit.chosen = (edit.chosen ?? []).filter((c) => c.group !== group);
            if (sel.value) edit.chosen.push({ group, value: sel.value });
            commit(); redraw();
          });
          return el("div", { className: "doc-row" }, el("span", { className: "doc-row-label" }, chipDot(group), group), sel);
        });
        view.append(section("Chosen tags",
          moves ? "filling the template's holes (one of them moves with a property)"
            : "filling the template's holes, so the hand is fully concrete", ...rows));
      } else {
        view.append(emptySection("Chosen tags", "this template has no holes"));
      }
    } else if (edit.rule) {
      // The inline rule: bindings + its own When.
      const rule = edit.rule;
      if (detail.groups.length > 0) {
        let moves = false;
        const rows = detail.groups.map((group) => {
          const current = rule.bindings?.find((b) => b.group === group.gameId);
          const sel = el("select", { className: "insp-input insp-mono" });
          const none = el("option", { text: "(any)" }); none.value = ""; sel.append(none);
          for (const v of group.values) { const o = el("option", { text: v }); o.value = v; if (current?.value === v) o.selected = true; sel.append(o); }
          appendPropertyFills(sel, detail.movableFrom, current?.value ?? "");
          if (isHoleRef(current?.value ?? "")) moves = true;
          sel.addEventListener("change", () => {
            rule.bindings = (rule.bindings ?? []).filter((b) => b.group !== group.gameId);
            if (sel.value) rule.bindings.push({ group: group.gameId, value: sel.value });
            commit(); redraw();
          });
          return el("div", { className: "doc-row" }, el("span", { className: "doc-row-label" }, chipDot(group.gameId), group.gameId), sel);
        });
        view.append(section("Pulls cards tagged",
          moves ? "the rule's bindings (one of them moves with a property)"
            : "the rule's bindings (an unbound group means any)", ...rows));
      } else {
        view.append(emptySection("Pulls cards tagged", "no tag groups in this box"));
      }
      const condHost = el("div", { className: "insp-exed" });
      mountCondition(condHost, { src: rule.condition ?? "", properties: catalogue, onChange: (src) => { rule.condition = src; commit(); } });
      view.append(section("When", "the condition a card must also satisfy", condHost));
    }

    // (No footer: "seated on the board" was the same sentence on every hand -
    // teaching text, not this hand's data. Density pass, 2026-07-30.)
    centre.replaceChildren(view);
  }
  draw();
}

// --- the box level ------------------------------------------------------------
// The box page's tab bodies (Contents is views-side): Dealing holds the
// ranking policy, Card template the field declarations, Properties the @box state.

export function renderBoxTabBody(centre: HTMLElement, box: BoxDto, tab: string, h: InspectorHost): void {
  const view = el("div", { className: "insp-card cardedit" });
  if (tab === "dealing") {
    let specificity = box.ranking.specificity;
    // WHAT A DEAL IS, and this page is the only place in the app that says so
    // (design review 2026-08, B6). Dealing names a tab on five entity types and
    // every one of them explained a knob: priority, redraw, copies, a tie-break
    // checkbox. None explained the mechanism, so an author could set all of them
    // without ever being told what they were setting. This tab is the right home
    // because it is the only Dealing surface about POLICY rather than one card's
    // settings, and it held a single checkbox on an otherwise empty page.
    view.append(el("div", { className: "doc-panel doc-explainer" },
      el("p", { text: "A deal fills a hand with cards. Every card whose When conditions are true right now is eligible, and the deal takes from those." }),
      el("p", { text: "It happens when the game asks (arriving somewhere, starting a turn, opening a conversation) and never on its own." }),
      el("p", { text: "More cards are usually eligible than a hand has room for, so they are ranked and the best ones go. The settings below decide that order." })));
    view.append(el("div", { className: "doc-panel cfg-panel" },
      cfgRow("Rank by specificity", "More specific cards win ties. Off, priority alone breaks them.",
        cfgCheck(specificity, (v) => { specificity = v; h.saveBox(box.id, { ranking: { specificity: v } }); }))));
    // Only once the project is paired with a Patter project: otherwise there is nothing to perform.
    if (box.patter) {
      view.append(el("div", { className: "doc-panel cfg-panel" },
        cfgRow("Performed by Patter", "Every card in this box plays the Patter scene named after it. Storyletter checks each one has a scene, and the Board plays them.",
          cfgCheck(box.patter.performed, (v) => { h.saveBox(box.id, { patterPerformed: v }); }))));
    }

    // WHAT A TURN IS in this box (design/engine-server.md 4.8). Two answers,
    // and the second is a declaration rather than a policy: saying "every 60
    // seconds" is what stops plays advancing the clock, so a designer cannot
    // set the convention and then forget to switch play-advance off. The
    // consequence is spelt out under the choice rather than left to be
    // discovered on the Board, because it changes what Redraw MEANS on every
    // card in the box.
    let seconds: number | undefined = box.turn?.seconds;
    const turnsHost = el("div");
    const drawTurns = (): void => {
      const timed = seconds !== undefined;
      const seg = el("div", { className: "seg insp-seg" });
      for (const [label, on] of [["a play", !timed], ["every N seconds of play", timed]] as [string, boolean][]) {
        const b = el("button", { className: `seg-opt${on ? " on" : ""}`, text: label });
        // A click on the choice already made does nothing: it must not reset a
        // seconds the designer has typed.
        if (!on) b.addEventListener("click", () => {
          seconds = timed ? undefined : 60;
          h.saveBox(box.id, { turn: seconds === undefined ? null : { seconds } });
          drawTurns();
        });
        seg.append(b);
      }
      const field = el("input", { className: "insp-input insp-mono insp-short" });
      field.value = timed ? String(seconds) : "";
      // "N", as the Redraw field does: the placeholder convention is a shown
      // default of one character, and the label above already says what N is.
      field.placeholder = "60"; field.disabled = !timed;
      const note = el("p", { className: "insp-note" });
      const say = (n: number | undefined): void => {
        note.textContent = n === undefined ? "" : "Plays in this box don't advance its turns. The game's clock does. "
          + `Redraw times on its cards are read as time, so a Redraw of 30 means ${turnSpan(30, n, true)}.`;
      };
      const typed = (): number | undefined => {
        const n = Number(field.value);
        return /^\d+$/.test(field.value.trim()) && Number.isInteger(n) && n > 0 ? n : undefined;
      };
      field.addEventListener("input", () => say(typed()));
      field.addEventListener("change", () => {
        const n = typed();
        if (n !== undefined) { seconds = n; h.saveBox(box.id, { turn: { seconds: n } }); }
      });
      say(seconds);
      turnsHost.replaceChildren(
        el("div", { className: "cfg-panel" },
          cfgRow("A turn is", "A play, as everywhere else, or a length of time the game's clock counts out.",
            el("div", { className: "insp-segrow" }, seg, field))),
        note);
    };
    // A timed box is a general engine feature, shown at every rung (ruling of
    // 2026-09-05: it was gated at venue, and a clock is not a venue's). The
    // question still goes through the ladder rather than around it, so that
    // one table stays the whole answer to what a rung shows; the `seconds`
    // arm keeps a box that is ALREADY timed showing its section whatever any
    // future rule says, since hiding must never swallow content in use.
    if (shows("timedBox") || seconds !== undefined) {
      drawTurns();
      view.append(section("Turns", "what a turn is in this box", turnsHost));
    }
  } else if (tab === "template") {
    const fields: FieldDeclDto[] = box.fields.map((f) => ({ ...f, values: f.values ? [...f.values] : undefined }));
    // The tab used to BE the label, so this list carried no head of its own.
    // It has one now that a second list shares the page: an unlabelled list
    // above a labelled one reads as the labelled one's preamble.
    view.append(sectHead("Card fields"),
      el("div", { className: `doc-panel${fields.length === 0 ? " empty" : ""}` }, propList(fields, () => h.saveBox(box.id, { fields }), "+ Field", { sharingSwitches: false })),
      el("p", { className: "doc-tab-note", text: "The fields every card in this box can carry." }));
    // The outcome half, on the SAME tab (2026-09-13). The tab vocabulary is
    // fixed (storyletter.md), and these are two halves of one template rather
    // than two subjects: what a card carries and what a press hands back. A
    // second list under its own overline says that, where a second tab would
    // have claimed they were unrelated. Same component as the card list (rule
    // 6), same sharing answer: field data carries no state.
    const outcomeFields: FieldDeclDto[] = box.outcomeFields.map((f) => ({ ...f, values: f.values ? [...f.values] : undefined }));
    view.append(sectHead("Outcome fields"),
      el("div", { className: `doc-panel${outcomeFields.length === 0 ? " empty" : ""}` }, propList(outcomeFields, () => h.saveBox(box.id, { outcomeFields }), "+ Field", { sharingSwitches: false })),
      el("p", { className: "doc-tab-note", text: "The fields every outcome in this box can carry. They're handed to the game with the press." }));
  } else {
    const properties: PropertyDeclDto[] = box.properties.map((p) => ({ ...p, values: p.values ? [...p.values] : undefined }));
    view.append(el("div", { className: `doc-panel${properties.length === 0 ? " empty" : ""}` }, propList(properties, () => h.saveBox(box.id, { properties }), "+ Property", { shareScope: "box" })),
      el("p", { className: "doc-tab-note", text: "Properties the whole box carries, as @box." }));
  }
  centre.replaceChildren(view);
}

// --- the deck level: tab bodies -------------------------------------------------
// The deck page's non-browse tabs (the page itself is views-side): Dealing is
// the deck's When (its gate in the file format), Fields the @deck state.

export function renderDeckTabBody(host: HTMLElement, box: BoxDto, deck: DeckDto, tab: string, catalogue: ConditionProperty[], h: InspectorHost): void {
  const view = el("div", { className: "insp-card cardedit" });
  if (tab === "dealing") {
    let gate = deck.gate ?? "";
    const gateHost = el("div", { className: "insp-exed" });
    mountCondition(gateHost, { src: gate, properties: catalogue, onChange: (src) => { gate = src; h.saveDeckConfig(deck.id, { gate }); } });
    view.append(section("When", "the condition for any card in this deck", gateHost,
      el("p", { className: "insp-note", text: "Evaluated once per deal. When false, none of this deck's cards are dealt." })));

    // Scarcity across playthroughs (design/shared-scarcity.md). The deck is
    // where this normally goes: a pile that is scarce AS A PILE says so once,
    // and a card only overrides it when it alone is unique.
    const deckRows: HTMLElement[] = [];
    if (shows("sharing")) {
      deckRows.push(cfgRow("Shared across playthroughs",
        "One pile for everyone. A card dealt to one participant can't be dealt to another, "
        + "and a card whose Redraw is never is spent for the whole world the first time anyone plays it. "
        + "A single-player game is unaffected.",
        cfgCheck(deck.shared === true, (on) => h.saveDeckConfig(deck.id, { shared: on }))));
    }
    // Durability across the RUN (design/engine-server.md 4.2): the pile is
    // where this normally goes too, and a card overrides it the same way. A
    // pile already flagged keeps its switch at every rung, for the reason the
    // card page does: "remove the flag" is the only way out of a durable flag
    // below venue, and it needs a control to be removed with.
    if (shows("durable") || deck.durable === true) {
      deckRows.push(cfgRow("Durable",
        "Cards in this pile stay played after the run ends. Tomorrow they're still gone for whoever "
        + "played them. Only a card whose Redraw is never has anything to carry.",
        cfgCheck(deck.durable === true, (on) => h.saveDeckConfig(deck.id, { durable: on }))));
    }
    if (deckRows.length > 0) view.append(el("div", { className: "doc-panel cfg-panel" }, ...deckRows));
  } else {
    const properties: PropertyDeclDto[] = deck.properties.map((p) => ({ ...p, values: p.values ? [...p.values] : undefined }));
    view.append(el("div", { className: `doc-panel${properties.length === 0 ? " empty" : ""}` }, propList(properties, () => h.saveDeckConfig(deck.id, { properties }), "+ Property", { shareScope: "deck" })),
      el("p", { className: "doc-tab-note", text: "Properties this deck carries for its cards, as @deck." }));
  }
  host.replaceChildren(view);
}

// --- the hand-template level ----------------------------------------------------
// A declared kind of hand ("NPCs you can talk to"): fixed bindings plus holes
// the instance fills, a shared condition, default slots. Live inheritance:
// instances follow edits here (schema 2.6).

export function renderTemplateWorkspace(centre: HTMLElement, box: BoxDto, detail: TemplateDetail, catalogue: ConditionProperty[], h: InspectorHost): void {
  const boxId = box.id;
  const edit: Required<TemplateEdit> = {
    gameId: detail.gameIdPinned ?? "",
    title: detail.title ?? "",
    purpose: detail.purpose ?? "",
    condition: detail.condition ?? "",
    bindings: detail.bindings.map((b) => ({ ...b })),
    slots: detail.slots,
    properties: detail.properties.map((p) => ({ ...p })),
  };
  const commit = (): void => h.saveTemplate(boxId, detail.id, edit);

  function draw(): void {
    const tabKey = `template:${detail.id}`;
    const tab = currentDocTab(tabKey, "dealing");
    const view = el("div", { className: "insp-card cardedit" });
    // A TITLE, as a hand has: what the designer calls this kind of hand
    // ("Places in the village"), shown under every one of its hands' titles.
    // The address stays the chip beside it, pinned for every template the app
    // makes, so a title typed here never moves it.
    view.append(documentHeading("Hand template", {
      title: { get: () => edit.title, set: (v) => { edit.title = v; }, placeholder: "What you call hands of this kind", commit },
      gameId: { get: () => edit.gameId, set: (v) => { edit.gameId = v; }, fallback: detail.gameId, deriveFrom: () => edit.title, commit },
      purpose: { get: () => edit.purpose, set: (v) => { edit.purpose = v; }, placeholder: "What kind of hand this is", commit },
      menu: [{ label: "Delete hand template", danger: true, onClick: () => h.deleteTemplate(boxId, detail.id) }],
      comments: { on: detail.id, count: h.openThreads(detail.id), open: (a) => h.showComments(detail.id, edit.title || detail.gameId, a) },
    }));
    const holes = edit.bindings.filter((b) => b.hole).length;
    const bound = edit.bindings.filter((b) => b.value !== undefined).length;
    view.append(docTabs([
      { key: "dealing", label: "Dealing" },
      { key: "bindings", label: "Bindings", count: bound + holes },
      { key: "properties", label: "Properties", count: edit.properties.length },
    ], tab, (next) => { setDocTab(tabKey, next); draw(); }));

    if (tab === "dealing") {
      // The shared condition, written once and evaluated per instance
      // against that instance's composed @hand (the reuse case).
      const condHost = el("div", { className: "insp-exed" });
      mountCondition(condHost, { src: edit.condition, properties: catalogue, onChange: (src) => { edit.condition = src; commit(); } });
      view.append(section("When", "the condition a card must also satisfy, shared by every instance", condHost));

      const isBounded = edit.slots !== "unbounded";
      const seg = el("div", { className: "seg insp-seg" });
      for (const [label, on] of [["unbounded", !isBounded], ["bounded", isBounded]] as [string, boolean][]) {
        const b = el("button", { className: `seg-opt${on ? " on" : ""}`, text: label });
        b.addEventListener("click", () => { edit.slots = label === "unbounded" ? "unbounded" : (isBounded ? edit.slots : "3"); commit(); draw(); });
        seg.append(b);
      }
      const size = el("input", { className: "insp-input insp-mono insp-short" });
      size.value = isBounded ? edit.slots : ""; size.placeholder = "3"; size.disabled = !isBounded;
      size.addEventListener("input", () => { if (/^\d+$/.test(size.value)) edit.slots = size.value; });
      size.addEventListener("change", commit);
      view.append(el("div", { className: "doc-panel cfg-panel" },
        cfgRow("Slots", "The default hand size. An instance may override it.", el("div", { className: "insp-segrow" }, seg, size)),
      ));

      view.append(derivedFooter(detail.instances.length > 0
        ? `Instanced by ${detail.instances.join(", ")}.`
        : "No hands of this kind yet."));
      centre.replaceChildren(view);
      return;
    }

    if (tab === "properties") {
      view.append(el("div", { className: `doc-panel${edit.properties.length === 0 ? " empty" : ""}` }, propList(edit.properties, commit, "+ Property", { shareScope: "hand" })),
        el("p", { className: "doc-tab-note", text: "Properties every hand of this kind carries as @hand, each with its own values." }));
      centre.replaceChildren(view);
      return;
    }

    // Bindings: each tag group bound to a fixed tag, left as a hole the
    // instance chooses, or unbound (any).
    const setBinding = (group: string, next: BindingDto): void => {
      edit.bindings = edit.bindings.filter((b) => b.group !== group);
      edit.bindings.push(next);
    };
    const bindBody: HTMLElement[] = detail.groups.map((group) => {
      const current = edit.bindings.find((b) => b.group === group.gameId);
      const select = el("select", { className: "insp-input insp-mono" });
      const none = el("option", { text: "(any)" }); none.value = ""; if (!current?.value && !current?.hole) none.selected = true;
      select.append(none);
      const hole = el("option", { text: "the instance chooses" }); hole.value = "?:"; if (current?.hole) hole.selected = true;
      select.append(hole);
      const grpV = el("optgroup"); grpV.label = "fixed tag";
      for (const v of group.values) { const o = el("option", { text: v }); o.value = `v:${v}`; if (current?.value === v) o.selected = true; grpV.append(o); }
      select.append(grpV);
      select.addEventListener("change", () => {
        const val = select.value;
        if (val === "?:") setBinding(group.gameId, { group: group.gameId, hole: true });
        else if (val.startsWith("v:")) setBinding(group.gameId, { group: group.gameId, value: val.slice(2) });
        else setBinding(group.gameId, { group: group.gameId });
        commit();
      });
      return el("div", { className: "doc-row" }, el("span", { className: "doc-row-label" }, chipDot(group.gameId), group.gameId), select);
    });
    view.append(bindBody.length > 0
      ? el("div", { className: "doc-panel" }, el("div", { className: "doc-panel-rows" }, ...bindBody))
      : el("p", { className: "doc-tab-note", text: "No tag groups in this box to bind. Tags classify cards so hands can pull by them." }));
    // B4: "hole" is taught HERE, where holes are made, or not used at all. It
    // was author-facing vocabulary in one place and internal in another, and
    // introduced nowhere.
    view.append(el("p", { className: "doc-tab-note", text: "For each group, pin every hand of this kind to one tag, leave the choice to each hand, or ignore the group." }));
    centre.replaceChildren(view);
  }
  draw();
}

// --- the tag-group level --------------------------------------------------------

export function renderTagGroupWorkspace(centre: HTMLElement, box: BoxDto, detail: TagGroupDetail, h: InspectorHost): void {
  const boxId = box.id;
  const edit: Required<TagGroupEdit> = {
    gameId: detail.gameId,
    purpose: detail.purpose ?? "",
    properties: detail.properties.map((p) => ({ ...p })),
    values: detail.values.map((v): ValueDetail => ({
      ...v, properties: v.properties.map((p) => ({ ...p })), values: { ...(v.values ?? {}) },
    })),
  };
  const commit = (): void => h.saveTagGroup(boxId, detail.id, edit);
  const redraw = (): void => draw();

  function draw(): void {
    const view = el("div", { className: "insp-card cardedit" });
    view.append(documentHeading("Tag group", {
      name: { get: () => edit.gameId, set: (v) => { edit.gameId = v; }, placeholder: "group-name", commit },
      purpose: { get: () => edit.purpose, set: (v) => { edit.purpose = v; }, placeholder: "What this group classifies", commit },
      menu: [{ label: "Delete tag group", danger: true, onClick: () => h.deleteTagGroup(boxId, detail.id) }],
      comments: { on: detail.id, count: h.openThreads(detail.id), open: (a) => h.showComments(detail.id, edit.gameId, a) },
    }));

    // Tags live inside the one Tags panel, hairline-separated blocks -
    // not their own heavier cards (one panel material, centre-clarity 1).
    const valBody: HTMLElement[] = edit.values.map((v, i) => {
      const block = el("div", { className: "doc-vblock" });
      const name = el("input", { className: "insp-input insp-mono" });
      name.value = v.gameId; name.placeholder = "Tag name";
      name.addEventListener("input", () => { v.gameId = name.value; });
      name.addEventListener("change", commit);
      const del = el("button", { className: "btn insp-del small", text: "Remove", onClick: () => { edit.values.splice(i, 1); commit(); redraw(); } });
      // Up/down beside Remove, which is Patterpad's trio for a list of settings
      // rows (`moveItem` in its dom.ts, used by the field, property and cast
      // lists). Tags are stored id-sorted now, so the order an author arranges
      // them in has to be recorded rather than implied by where they landed;
      // saveTagGroup stamps `order` from position, so a swap here is the whole
      // reorder.
      const swap = (j: number): void => {
        if (j < 0 || j >= edit.values.length) return;
        [edit.values[i], edit.values[j]] = [edit.values[j]!, edit.values[i]!];
        commit(); redraw();
      };
      const up = el("button", { className: "btn ghost icon insp-move", tip: "Move up", onClick: () => swap(i - 1) }, iconNode("up")) as HTMLButtonElement;
      const down = el("button", { className: "btn ghost icon insp-move", tip: "Move down", onClick: () => swap(i + 1) }, iconNode("down")) as HTMLButtonElement;
      up.disabled = i === 0;
      down.disabled = i === edit.values.length - 1;
      block.append(el("div", { className: "insp-ohead" }, el("span", { className: "insp-kv" }, chipDot(v.gameId), name),
        el("span", { className: "insp-moves" }, up, down, del)));
      block.append(bare("Tag properties", "When a hand with this tag is dealt to, these values appear as @hand.<name>.", propList(v.properties, commit, "+ Property", { shareScope: detail.projectMap === true ? "zone" : "tag" })));
      // What the GROUP declares, this tag's own starting value for each. One
      // row per declaration, using the same control the declaration's own
      // default uses, so a quality offers its stages here too.
      if (edit.properties.length > 0) {
        const rows = el("div", { className: "set-rows" });
        for (const decl of edit.properties) {
          const shadow = { ...decl, default: v.values?.[decl.name] ?? "" };
          const control = valueControl(shadow, () => {
            v.values ??= {};
            if (shadow.default.trim() === "") delete v.values[decl.name];
            else v.values[decl.name] = shadow.default;
            commit();
          });
          rows.append(el("div", { className: "set-row" },
            el("span", { className: "set-label insp-mono", text: decl.name }), control,
            el("span", { className: "set-dim", text: `Group default ${decl.default || "(first stage)"}.` })));
        }
        block.append(bare("Starts at", "this tag's own value for what the group declares", rows));
      }
      return block;
    });
    const add = el("button", { className: "insp-add", text: "+ Tag", onClick: () => { edit.values.push({ gameId: "", properties: [] }); commit(); redraw(); } });
    // The group's own declarations come FIRST: they are what every tag below
    // has, so reading downwards reads "these are the properties, and here is
    // where each tag starts". Declaring here rather than on each tag is also
    // what stops a tag added later quietly arriving without one
    // (design/hand-typing.md).
    // The nudge: a name declared identically on every tag is the group form
    // written the long way. Quiet, one line, only when true (the density
    // rule: teaching text waits until it is needed).
    const hoistables = hoistableProperties(edit);
    const nudge = hoistables.length === 0 ? [] : hoistables.map((name) =>
      el("div", { className: "insp-nudge" },
        el("span", { className: "set-dim" },
          el("span", { className: "insp-mono", text: name }),
          el("span", { text: " is on every tag. Declared here, a tag added later gets it too. " }),
        ),
        el("button", { className: "insp-add small", text: "Move it here", onClick: () => {
          hoistProperty(edit, name); commit(); redraw();
        } })));
    // Each property says who shares its value, and follows its own Shared
    // tick-box as it is ticked (zone-share.ts: the round-3 ruling for the
    // project map's zones, every scope since the sign-off round). On Solo a
    // zone's properties also say where a value every guest shares comes from.
    const soloPointer = detail.projectMap === true && !shows("sharing")
      ? [soloSharePointer("doc-tab-note")] : [];
    view.append(section("Properties", detail.projectMap === true ? "every zone on the map has these" : "every tag in this group has these",
      propList(edit.properties, () => { commit(); redraw(); }, "+ Property", { shareScope: detail.projectMap === true ? "zone" : "tag" }), ...soloPointer, ...nudge));
    view.append(section("Tags", "declared, not freeform", ...valBody, add));

    // The spatial template of play: this group is a map, so its tags carry outlines
    // and the box gains a Map tab. Configuration rather than content, so it wears
    // the cfg-row voice the other switches use, and it lives BELOW the tags: the
    // tags are what the group is, this is how it is shown.
    const spatial = box.tagGroups.find((g) => g.id === detail.id)?.spatial === true;
    // "A map", not "A place", which it read until 2026-08-31. Two things were
    // wrong with the old word and the second is the reason it changed.
    //
    // It inverted container and member: the GROUP was labelled a place while its
    // TAGS are zones, so the Village was "a place" and the forest a "zone", when
    // the forest is the more obviously place-shaped of the two.
    //
    // And it hard-coded geography, directly above help saying the opposite. A map
    // of act structure is not a place in any sense, and a surface arguing with
    // itself is worse than either half alone.
    //
    // "A map" also makes this agree with the four surfaces around it: the section
    // above, the Maps tab, "+ New map", and the docs page. It was the only
    // outlier. `spatial` remains the stored key, `zones` the bundle's, `sites`
    // the sidecar's: nothing about the format moves (design/maps-discoverability.md).
    view.append(section("Map", undefined, cfgRow(
      "A map",
      spatial
        ? "Its tags are zones with outlines, drawn on the box's Map. It can be geography or any other two-dimensional layout, such as acts, a cast, or a tech tree."
        : "Turn on to draw these tags as a map. It need not be geography. Acts and their beats, a cast and who is close to whom, or anything else you can lay out will do.",
      cfgCheck(spatial, (on) => h.setGroupSpatial(boxId, detail.id, on)),
    )));

    // Derived: who leans on this group.
    const cardsN = box.decks.flatMap((d) => d.cards).filter((c) => c.tags.some((m) => m.group === detail.gameId)).length;
    const templates = box.templates.filter((t) => t.bindings.some((b) => b.startsWith(`${detail.gameId} =`))).map((t) => t.gameId);
    view.append(derivedFooter(
      `${plural(cardsN, "card")} tagged. ${templates.length > 0 ? `Bound by ${templates.join(", ")}` : "Not bound by any hand template"}.`));
    centre.replaceChildren(view);
  }
  draw();
}


