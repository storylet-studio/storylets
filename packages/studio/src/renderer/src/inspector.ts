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

import { icon, openGameIdEditor } from "@wildwinter/app-shell";
import { currentDocTab, setDocTab } from "./doc-tab-memory.js";
import { whereModel, whereWarning } from "./where.js";
// The DERIVED address, computed for placeholders and previews. From the model
// rather than the shell: this is the same rule the compiler and the CLI use, and
// model/test/id-parity.test.ts holds the two copies to each other.
import { gameIdify, PLACE_GROUP } from "@storylet-studio/model";
import { el } from "./dom.js";

import { openContextMenu, openPopover } from "./context-menu.js";
import { chipDot } from "./views.js";
import { mountChanges, mountCondition, previewCondition } from "./expr-panels.js";
import { mountPropertyList, valueControl } from "./prop-list.js";
import { hoistableProperties, hoistProperty } from "./tag-hoist.js";
import type {
  BindingDto, BoxDto, BoxEdit, CardDto, CardEdit, ConditionProperty, DeckDto, DeckEdit,
  FieldDeclDto, HandDetail, HandEdit, OutcomeEdit, PropertyDeclDto,
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
}

const overline = (text: string): HTMLElement => el("span", { className: "insp-label", text });

// One section grammar (centre-clarity 3): overline label OUTSIDE the panel,
// an optional muted hint on the same line, then the panel - one material for
// every machinery cluster. The panel contains only content, never its label.
const sectHead = (label: string, hint?: string): HTMLElement =>
  el("div", { className: "doc-sect-head" }, overline(label),
    hint ? el("span", { className: "doc-sect-hint", text: hint }) : null);
const sectParts = (label: string, hint: string | undefined, ...body: (Node | null)[]): Node[] =>
  [sectHead(label, hint), el("div", { className: "doc-panel" }, ...body)];
const section = (label: string, hint: string | undefined, ...body: (Node | null)[]): HTMLElement =>
  el("div", { className: "doc-sect" }, ...sectParts(label, hint, ...body));
// The rare unpanelled cluster (inside an already-lifted panel, e.g. an open
// outcome's gate/changes): same head, content bare.
const bare = (label: string, hint: string | undefined, ...body: (Node | null)[]): HTMLElement =>
  el("div", { className: "doc-sect" }, sectHead(label, hint), ...body);

// An empty section costs one line, not a panel (centre-clarity 8): overline +
// quiet summary, with a ghost + that swaps in the real panel when there is
// one to expand. A commit-driven redraw re-collapses it only while it is
// still empty, which is the correct resting state.
function emptySection(label: string, summary: string, expandTo?: () => Node[]): HTMLElement {
  const wrap = el("div", { className: "doc-sect" });
  const row = el(expandTo ? "button" : "div", { className: "doc-collapsed" },
    overline(label), el("span", { className: "doc-collapsed-sum", text: summary }),
    expandTo ? el("span", { className: "doc-collapsed-plus", text: "+" }) : null);
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
  input.addEventListener("input", () => { onInput(input.value); onChange(); });
  input.addEventListener("change", onChange);
  return input;
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
    })),
  };
}
// A gameId field (Patterpad's model): the address is *derived from the title*
// until the author sites one, so it reads as a quiet auto value rather than a
// typed-in literal. Click it for a small popover to override, or to hand it
// back to auto. `refresh` repaints it when the title it derives from changes.
function gameIdField(
  get: () => string, set: (v: string) => void, derived: () => string, commit: () => void,
): { root: HTMLElement; refresh: () => void } {
  const root = el("button", { className: "gid" });
  const paint = (): void => {
    const pinned = get().trim();
    root.className = `gid${pinned ? "" : " gid-auto"}`;
    root.title = pinned ? "Game id - fixed by hand (click to edit)" : "Game id - follows the title (click to override)";
    root.replaceChildren(
      el("span", { className: "gid-value", text: pinned || derived() || "(unnamed)" }),
      el("span", { className: "gid-tag", text: pinned ? "pinned" : "auto" }),
    );
  };
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
      title: { get: () => edit.title ?? "", set: (v) => { edit.title = v; }, placeholder: "<card title>", commit },
      gameId: { get: () => edit.gameId ?? "", set: (v) => { edit.gameId = v; }, fallback: card.gameId, deriveFrom: () => edit.title ?? "", commit },
      purpose: { get: () => edit.purpose ?? "", set: (v) => { edit.purpose = v; }, placeholder: "<what happens when this card plays>", commit },
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
      view.append(el("div", { className: "doc-panel" }, outcomeAccordion(edit, catalogue, commit, setExpanded, h)));
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
    const condHost = el("div", { className: "insp-exed" });
    mountCondition(condHost, { src: edit.condition ?? "", properties: catalogue, onChange: (src) => { edit.condition = src; commit(); } });
    view.append(section("When", "the condition to be dealt", condHost));

    const priority = textField(edit.priority ?? "", "insp-input insp-mono insp-short", (v) => { edit.priority = v; }, commit);
    priority.placeholder = "0";
    const seg = el("div", { className: "insp-seg" });
    const isNumber = /^\d+$/.test(edit.redraw ?? "");
    for (const [label, value] of [["always", "always"], ["never", "never"], ["turns", "5"]] as [string, string][]) {
      const on = label === "turns" ? isNumber : edit.redraw === value;
      const b = el("button", { className: on ? "on" : "", text: label });
      b.addEventListener("click", () => { edit.redraw = label === "turns" ? (isNumber ? edit.redraw : "5") : value; commit(); drawCentre(); });
      seg.append(b);
    }
    const turns = el("input", { className: "insp-input insp-mono insp-short" });
    turns.value = isNumber ? (edit.redraw ?? "") : ""; turns.placeholder = "N"; turns.disabled = !isNumber;
    turns.addEventListener("input", () => { if (/^\d+$/.test(turns.value)) edit.redraw = turns.value; });
    turns.addEventListener("change", commit);
    const copies = textField(edit.copies ?? "", "insp-input insp-mono insp-short", (v) => { edit.copies = v; }, commit);
    copies.placeholder = "1";

    /** Scarcity across playthroughs (design/shared-scarcity.md), as THREE
     *  states, because two would lie: a card that says nothing takes its
     *  deck's flag, and "inherit" has to be visibly different from "not
     *  shared" or an author cannot tell why a card in a shared pile is
     *  scarce. The default choice names what the deck actually says, so the
     *  answer is on the card page rather than one click away. */
    const sharedRows = (): HTMLElement[] => {
      const seg = el("div", { className: "insp-seg" });
      const states: [string, boolean | null][] = [
        [deck.shared === true ? "deck (shared)" : "deck (not shared)", null],
        ["shared", true],
        ["not shared", false],
      ];
      for (const [label, value] of states) {
        const on = edit.shared === value;
        const b = el("button", { className: on ? "on" : "", text: label });
        b.addEventListener("click", () => { edit.shared = value; commit(); drawCentre(); });
        seg.append(b);
      }
      const effective = edit.shared === null ? deck.shared === true : edit.shared === true;
      const rows = [cfgRow("Shared across playthroughs",
        "One in the world rather than one each: dealt to one participant, it cannot be dealt to another, "
        + "and a Redraw of never spends it for everyone. A single-player game is unaffected.",
        seg)];
      // Only when it can do something: sharedCopies on an unshared card is a
      // dead setting, and the compiler says so. Better not to offer it.
      if (effective) {
        const world = textField(edit.sharedCopies ?? "", "insp-input insp-mono insp-short",
          (v) => { edit.sharedCopies = v; }, commit);
        world.placeholder = edit.copies.trim() || "1";
        rows.push(cfgRow("In the world",
          "How many hands may hold it anywhere, across every playthrough. Blank means the same as Copies, "
          + "so leave it alone for one-in-the-world; set both for five in the world, one to a customer.",
          world));
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
      cfgRow("Redraw", "Whether a played card can be dealt again.", el("div", { className: "insp-segrow" }, seg, turns)),
      cfgRow("Copies", "How many hands may hold this card at once, in one playthrough. One copy is the rule; more is for interchangeable filler.", copies),
      ...sharedRows(),
    ));

    // WHERE: the first question a designer asks of a card, answered as a
    // sentence rather than left to be assembled from a place row and a region
    // row (design/where-and-selectors.md Part A). Place axes are
    // the home group plus every SPATIAL group; everything else stays in Tags.
    view.append(whereRow());

    // Tags: the groups this card is filed under, minus the place axes the Where
    // row above now owns. The reserved home group is a place axis by
    // definition, so it never appears here any more.
    const placeGroups = new Set(box.tagGroups.filter((g) => g.spatial === true).map((g) => g.gameId));
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
    if (m.places.length === 0 && m.regions.length === 0) {
      line.append(el("span", { className: "where-any", text: "Anywhere" }));
    } else {
      for (const p of m.places) line.append(el("span", { className: "chip on where-place", text: p.title }));
      for (const r of m.regions) {
        for (const v of r.values) line.append(el("span", { className: "chip on where-region" }, chipDot(v), `anywhere in ${v}`));
      }
    }
    const open = el("button", { className: "where-edit", text: "Change", tip: "Choose the places and regions this card belongs to" });
    open.addEventListener("click", () => openWherePicker(open));
    const warning = whereWarning(m);
    const body = el("div", { className: "where-body" }, el("div", { className: "where-head" }, line, open));
    if (warning !== undefined) body.append(el("p", { className: "where-warn", text: warning }));
    return section("Where", "the places this card can come up", body);
  }

  /** The picker: places and regions in separate sections, because a place plus
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
      wrap.append(el("span", { className: "insp-label", text: "Places" }));
      const placeRow = el("div", { className: "insp-chips" });
      for (const hd of box.hands) {
        const on = homes.includes(hd.gameId);
        const zone = Object.values(hd.tags)[0];
        const chip = el("button", { className: `chip where-place${on ? " on" : ""}` }, hd.title ?? hd.gameId,
          zone !== undefined ? el("span", { className: "where-in", text: zone }) : null);
        chip.addEventListener("click", () => toggle(PLACE_GROUP, hd.gameId));
        placeRow.append(chip);
      }
      wrap.append(placeRow);
      for (const g of box.tagGroups.filter((x) => x.spatial === true)) {
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
      wrap.append(el("p", { className: "where-hint", text: "A card with no place comes up anywhere. Choosing a place AND a region means both must match, which is usually not what you want." }));
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
      return [el("p", { className: "doc-tab-note", text: "No card fields declared. Define what every card can carry on the box's Card template tab. Cards with no fields are keys: your game looks them up by game id and supplies the text." })];
    }
    const setField = (name: string, value: string): void => {
      let f = edit.fields.find((x) => x.name === name);
      if (!f) { f = { name, value: "" }; edit.fields.push(f); }
      f.value = value;
    };
    const fieldBody: HTMLElement[] = [];
    for (const decl of box.fields) {
      const current = edit.fields.find((f) => f.name === decl.name)?.value ?? "";
      let control: HTMLElement;
      if (decl.type === "boolean" || (decl.type === "enum" && (decl.values?.length ?? 0) > 0)) {
        // A declared type is a contract: offer its values, don't ask for typing.
        const sel = el("select", { className: "insp-input insp-mono" });
        const none = el("option", { text: "(unset)" }); none.value = ""; sel.append(none);
        const opts = decl.type === "boolean" ? ["true", "false"] : decl.values!;
        for (const v of opts) { const o = el("option", { text: v }); o.value = v; if (v === current) o.selected = true; sel.append(o); }
        sel.addEventListener("change", () => { setField(decl.name, sel.value); commit(); });
        control = sel;
      } else {
        // string / number / flags: text, coerced on save.
        const input = el("input", { className: "insp-input insp-mono" });
        input.value = current; input.placeholder = `<${decl.type}>`;
        input.addEventListener("input", () => setField(decl.name, input.value));
        input.addEventListener("change", commit);
        control = input;
      }
      fieldBody.push(el("div", { className: "doc-row" }, el("span", { className: "doc-row-label", text: decl.name }), control));
    }
    return [el("div", { className: "doc-panel" }, ...fieldBody)];
  }

  drawCentre();
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
function propList(decls: PropertyDeclDto[], onChange: () => void, addLabel: string): HTMLElement {
  const host = el("div", { className: "prop-list" });
  mountPropertyList(host, decls, { onChange, addLabel });
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
  purpose?: IdentityField & { placeholder?: string; commit: () => void; commitOn?: "input" | "blur" };
  menu?: { label: string; danger?: boolean; onClick: () => void }[];
  /** The comment-thread opener, in the TOPLINE beside the ⋯ menu: the row that
   *  means "about this whole document". Patterpad puts it in the inspector
   *  level's action row; we have no inspector, so this is the equivalent. */
  /** `on` is the id the thread is filed against. It is stamped on the bubble so a
   *  caller holding only an id can FIND this anchor once the document renders,
   *  which is how the feedback walk arrives at a comment it navigated to. */
  comments?: { on: string; count: number; open: (anchor: HTMLElement) => void };
  afterEdit?: () => void;
}): HTMLElement {
  const head = el("div", { className: "doc-head" });
  const topline = el("div", { className: "doc-topline" }, overline(label));
  if (opts.comments) {
    const c = opts.comments;
    const bubble = el("button", {
      className: `doc-thread${c.count > 0 ? " has" : ""}`,
      text: c.count > 0 ? `${icon.comment} ${c.count}` : icon.comment,
      tip: c.count > 0 ? `${c.count} open comment${c.count === 1 ? "" : "s"}` : "Comment on this",
    });
    bubble.dataset.threadFor = c.on;
    bubble.addEventListener("click", (e) => { e.preventDefault(); c.open(bubble); });
    topline.append(bubble);
  }
  if (opts.menu?.length) {
    const items = opts.menu;
    const more = el("button", { className: "doc-menu", text: icon.more, tip: "More" });
    more.addEventListener("click", (e) => {
      const r = more.getBoundingClientRect();
      e.preventDefault();
      openContextMenu(r.left, r.bottom + 4, items);
    });
    topline.append(more);
  }
  head.append(topline);
  let gid: { root: HTMLElement; refresh: () => void } | undefined;
  if (opts.gameId) {
    const g = opts.gameId;
    gid = gameIdField(g.get, g.set, () => gameIdify(g.deriveFrom()) || g.fallback, g.commit);
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
    input.addEventListener("input", () => { t.set(input.value); gid?.refresh(); if ((t.commitOn ?? "input") === "input") { t.commit(); opts.afterEdit?.(); } });
    input.addEventListener("change", () => { t.commit(); opts.afterEdit?.(); });
    titleRow.append(input);
  }
  if (opts.name) {
    const n = opts.name;
    const input = el("input", { className: "insp-input insp-mono doc-title doc-name" });
    input.value = n.get(); input.placeholder = n.placeholder ?? "name";
    input.addEventListener("input", () => { n.set(input.value); n.commit(); opts.afterEdit?.(); });
    input.addEventListener("change", () => { n.commit(); opts.afterEdit?.(); });
    titleRow.append(input);
  }
  if (gid) titleRow.append(el("div", { className: "doc-gid" }, gid.root));
  if (titleRow.childElementCount > 0) head.append(titleRow);
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
  const changes = `${o.changes.length} change${o.changes.length === 1 ? "" : "s"}`;
  const line = el("div", { className: "outcome-row-line" },
    // Drawn in CSS (the Unicode small triangles stay tiny at any font size);
    // the open state rotates it.
    el("span", { className: "outcome-row-chev" }),
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
    className: `doc-thread${count > 0 ? " has" : ""}`,
    text: count > 0 ? `${icon.comment} ${count}` : icon.comment,
    tip: count > 0 ? `${count} open comment${count === 1 ? "" : "s"}` : "Comment on this outcome",
  });
  bubble.dataset.threadFor = on;
  bubble.addEventListener("click", (e) => { e.preventDefault(); open(bubble); });
  return bubble;
}

// The outcomes accordion in the centre: a light row per outcome that expands in
// place to its full (wide) editor. Only one is open at a time.
function outcomeAccordion(edit: Required<CardEdit>, catalogue: ConditionProperty[], commit: () => void, setExpanded: (id: string | undefined) => void, h: InspectorHost): HTMLElement {
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
    if (open) item.append(outcomeBody(o, catalogue, commit, () => fillOutcomeHeader(header, o, true, catalogue), () => remove(o), h));
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
function outcomeBody(o: OutcomeEdit, catalogue: ConditionProperty[], commit: () => void, syncHeader: () => void, remove: () => void, h: InspectorHost): HTMLElement {
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
  title.placeholder = "<outcome title>";
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
  purpose.placeholder = "<what this outcome does>";
  purpose.addEventListener("input", () => { o.purpose = purpose.value; commit(); });
  purpose.addEventListener("change", commit);
  body.append(purpose);

  const gateHost = el("div", { className: "insp-exed" });
  mountCondition(gateHost, { src: o.gate ?? "", properties: catalogue, onChange: (src) => { if (src.trim()) o.gate = src; else delete o.gate; save(); } });
  body.append(bare("When", "the condition for this outcome to be offered", gateHost));

  const changeHost = el("div", { className: "insp-exed" });
  mountChanges(changeHost, { changes: o.changes, properties: catalogue, onChange: (c) => { o.changes = c; save(); } });
  // B11: the hint named the restriction without explaining it, so an author who
  // wanted "add one to gold" learned the rule inside the expression editor -
  // while debugging, which is the worst place to meet it. The idiom is the
  // second half of the sentence the hint was already starting.
  body.append(bare("Changes", "what it sets: a change replaces a value rather than adjusting it, so add one with @story.gold + 1", changeHost));

  body.append(el("button", { className: "insp-del small outcome-remove", text: "Remove outcome", onClick: remove }));
  return body;
}

// The card's mechanical settings - the inspector level: the host-facing gameId
// (computed from the title until pinned) and how the card ranks against rivals.

// --- the deck level -----------------------------------------------------------


// --- the hand level -------------------------------------------------------------
// A hand is a place on the board (schema 2.6): an instance of a hand template
// (chosen tags fill its holes; everything unset follows the template live) or
// standalone with its own inline rule.

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
  const redraw = (): void => draw();
  const standalone = (): boolean => edit.template === undefined || edit.template === "";

  function draw(): void {
    const tabKey = `hand:${detail.id}`;
    const tab = currentDocTab(tabKey, "dealing");
    const templateNow = detail.templates.find((t) => t.gameId === edit.template);
    const view = el("div", { className: "insp-card cardedit" });
    view.append(documentHeading("Hand", {
      title: { get: () => edit.title, set: (v) => { edit.title = v; }, placeholder: "<hand title>", commit },
      gameId: { get: () => edit.gameId, set: (v) => { edit.gameId = v; }, fallback: detail.gameId, deriveFrom: () => edit.title, commit },
      purpose: { get: () => edit.purpose, set: (v) => { edit.purpose = v; }, placeholder: "<what sits here, and why>", commit },
      menu: [{ label: "Delete hand", danger: true, onClick: () => h.deleteHand(boxId, detail.id) }],
      comments: { on: detail.id, count: h.openThreads(detail.id), open: (a) => h.showComments(detail.id, edit.title || detail.gameId, a) },
    }));
    const declared = standalone() ? edit.rule?.slots ?? "unbounded" : templateNow?.slots ?? "unbounded";
    const slotsNow = /^\d+$/.test(edit.slots) ? Number(edit.slots)
      : (/^\d+$/.test(String(declared)) ? Number(declared) : undefined);
    view.append(docTabs([
      { key: "dealing", label: "Dealing" },
      { key: "slots", label: "Slots", ...(slotsNow !== undefined ? { count: slotsNow } : {}) },
      { key: "properties", label: "Properties", count: (standalone() ? edit.properties?.length ?? 0 : 0) },
    ], tab, (next) => { setDocTab(tabKey, next); draw(); }));

    if (tab === "slots") {
      if (standalone()) {
        const isBounded = edit.rule !== undefined && edit.rule.slots !== "unbounded" && String(edit.rule.slots).trim() !== "";
        const seg = el("div", { className: "insp-seg" });
        for (const [label, on] of [["unbounded", !isBounded], ["bounded", isBounded]] as [string, boolean][]) {
          const b = el("button", { className: on ? "on" : "", text: label });
          b.addEventListener("click", () => {
            if (!edit.rule) edit.rule = { bindings: [], condition: "", slots: "unbounded" };
            edit.rule.slots = label === "unbounded" ? "unbounded" : (isBounded ? edit.rule.slots : "3");
            commit(); draw();
          });
          seg.append(b);
        }
        const size = el("input", { className: "insp-input insp-mono insp-short" });
        size.value = isBounded ? String(edit.rule!.slots) : ""; size.placeholder = "N"; size.disabled = !isBounded;
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
        view.append(el("div", { className: `doc-panel${(edit.properties ?? []).length === 0 ? " empty" : ""}` }, propList(edit.properties ?? [], commit, "+ Property")),
          el("p", { className: "doc-tab-note", text: "@hand state: properties this hand carries for its cards." }));
      } else {
        view.append(el("p", { className: "doc-tab-note", text: "These come from this hand's template. Edit them there and every hand of that kind follows." }));
      }
      centre.replaceChildren(view);
      return;
    }

    // Dealing: which kind of hand this is. An instance fills its template's
    // holes; a standalone hand carries its own rule inline.
    const pick = el("select", { className: "insp-input" });
    const alone = el("option", { text: "(standalone: its own rule)" }); alone.value = ""; if (standalone()) alone.selected = true;
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
        const rows = holes.map((group) => {
          const current = edit.chosen?.find((c) => c.group === group)?.value ?? "";
          const options = detail.groups.find((g) => g.gameId === group)?.values
            ?? detail.chosen.find((c) => c.group === group)?.values ?? [];
          const sel = el("select", { className: "insp-input insp-mono" });
          const none = el("option", { text: "(choose)" }); none.value = ""; sel.append(none);
          for (const v of options) { const o = el("option", { text: v }); o.value = v; if (v === current) o.selected = true; sel.append(o); }
          sel.addEventListener("change", () => {
            edit.chosen = (edit.chosen ?? []).filter((c) => c.group !== group);
            if (sel.value) edit.chosen.push({ group, value: sel.value });
            commit();
          });
          return el("div", { className: "doc-row" }, el("span", { className: "doc-row-label" }, chipDot(group), group), sel);
        });
        view.append(section("Chosen tags", "filling the template's holes - a hand is fully concrete", ...rows));
      } else {
        view.append(emptySection("Chosen tags", "this template has no holes"));
      }
    } else if (edit.rule) {
      // The inline rule: bindings + its own When.
      const rule = edit.rule;
      if (detail.groups.length > 0) {
        const rows = detail.groups.map((group) => {
          const current = rule.bindings?.find((b) => b.group === group.gameId);
          const sel = el("select", { className: "insp-input insp-mono" });
          const none = el("option", { text: "(any)" }); none.value = ""; sel.append(none);
          for (const v of group.values) { const o = el("option", { text: v }); o.value = v; if (current?.value === v) o.selected = true; sel.append(o); }
          sel.addEventListener("change", () => {
            rule.bindings = (rule.bindings ?? []).filter((b) => b.group !== group.gameId);
            if (sel.value) rule.bindings.push({ group: group.gameId, value: sel.value });
            commit();
          });
          return el("div", { className: "doc-row" }, el("span", { className: "doc-row-label" }, chipDot(group.gameId), group.gameId), sel);
        });
        view.append(section("Pulls cards tagged", "the rule's bindings; an unbound group is any", ...rows));
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
      el("p", { text: "A deal fills a place with cards. Every card whose When conditions are true right now is eligible; the deal takes from those." }),
      el("p", { text: "It happens when the game asks - arriving somewhere, starting a turn, opening a conversation - and never on its own." }),
      el("p", { text: "More cards are usually eligible than a place has room for, so they are ranked and the best ones go. The settings below decide that order." })));
    view.append(el("div", { className: "doc-panel cfg-panel" },
      cfgRow("Rank by specificity", "More specific cards win ties; otherwise ties break by priority alone.",
        cfgCheck(specificity, (v) => { specificity = v; h.saveBox(box.id, { ranking: { specificity: v } }); }))));
  } else if (tab === "template") {
    const fields: FieldDeclDto[] = box.fields.map((f) => ({ ...f, values: f.values ? [...f.values] : undefined }));
    view.append(el("div", { className: `doc-panel${fields.length === 0 ? " empty" : ""}` }, propList(fields, () => h.saveBox(box.id, { fields }), "+ Field")),
      el("p", { className: "doc-tab-note", text: "The template for this box's cards: the fields every card can carry." }));
  } else {
    const properties: PropertyDeclDto[] = box.properties.map((p) => ({ ...p, values: p.values ? [...p.values] : undefined }));
    view.append(el("div", { className: `doc-panel${properties.length === 0 ? " empty" : ""}` }, propList(properties, () => h.saveBox(box.id, { properties }), "+ Property")),
      el("p", { className: "doc-tab-note", text: "@box state: properties the whole box carries." }));
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
      el("p", { className: "insp-note", text: "Evaluated once per deal; when false, none of this deck's cards are dealt." })));

    // Scarcity across playthroughs (design/shared-scarcity.md). The deck is
    // where this normally goes: a pile that is scarce AS A PILE says so once,
    // and a card only overrides it when it alone is unique.
    view.append(el("div", { className: "doc-panel cfg-panel" },
      cfgRow("Shared across playthroughs",
        "One pile for everyone: a card dealt to one participant cannot be dealt to another, "
        + "and a card whose Redraw is never is spent for the whole world the first time anyone plays it. "
        + "A single-player game is unaffected.",
        cfgCheck(deck.shared === true, (on) => h.saveDeckConfig(deck.id, { shared: on })))));
  } else {
    const properties: PropertyDeclDto[] = deck.properties.map((p) => ({ ...p, values: p.values ? [...p.values] : undefined }));
    view.append(el("div", { className: `doc-panel${properties.length === 0 ? " empty" : ""}` }, propList(properties, () => h.saveDeckConfig(deck.id, { properties }), "+ Property")),
      el("p", { className: "doc-tab-note", text: "@deck state: properties this deck carries for its cards." }));
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
    gameId: detail.gameId,
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
    view.append(documentHeading("Hand template", {
      name: { get: () => edit.gameId, set: (v) => { edit.gameId = v; }, placeholder: "<template-name>", commit },
      purpose: { get: () => edit.purpose, set: (v) => { edit.purpose = v; }, placeholder: "<what kind of place this is, and what it pulls>", commit },
      menu: [{ label: "Delete hand template", danger: true, onClick: () => h.deleteTemplate(boxId, detail.id) }],
      comments: { on: detail.id, count: h.openThreads(detail.id), open: (a) => h.showComments(detail.id, edit.gameId, a) },
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
      view.append(section("When", "the condition a card must also satisfy - shared by every instance", condHost));

      const isBounded = edit.slots !== "unbounded";
      const seg = el("div", { className: "insp-seg" });
      for (const [label, on] of [["unbounded", !isBounded], ["bounded", isBounded]] as [string, boolean][]) {
        const b = el("button", { className: on ? "on" : "", text: label });
        b.addEventListener("click", () => { edit.slots = label === "unbounded" ? "unbounded" : (isBounded ? edit.slots : "3"); commit(); draw(); });
        seg.append(b);
      }
      const size = el("input", { className: "insp-input insp-mono insp-short" });
      size.value = isBounded ? edit.slots : ""; size.placeholder = "N"; size.disabled = !isBounded;
      size.addEventListener("input", () => { if (/^\d+$/.test(size.value)) edit.slots = size.value; });
      size.addEventListener("change", commit);
      view.append(el("div", { className: "doc-panel cfg-panel" },
        cfgRow("Slots", "The default hand size; an instance may override it.", el("div", { className: "insp-segrow" }, seg, size)),
      ));

      view.append(derivedFooter(detail.instances.length > 0
        ? `Instanced by ${detail.instances.join(", ")}.`
        : "No hand instances this template yet."));
      centre.replaceChildren(view);
      return;
    }

    if (tab === "properties") {
      view.append(el("div", { className: `doc-panel${edit.properties.length === 0 ? " empty" : ""}` }, propList(edit.properties, commit, "+ Property")),
        el("p", { className: "doc-tab-note", text: "@hand state every instance carries (each hand gets its own values)." }));
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
    view.append(el("p", { className: "doc-tab-note", text: "For each group: pin every place of this kind to one tag, leave it for each place to choose, or ignore the group entirely." }));
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
      name: { get: () => edit.gameId, set: (v) => { edit.gameId = v; }, placeholder: "<group-name>", commit },
      purpose: { get: () => edit.purpose, set: (v) => { edit.purpose = v; }, placeholder: "<what this group classifies>", commit },
      menu: [{ label: "Delete tag group", danger: true, onClick: () => h.deleteTagGroup(boxId, detail.id) }],
      comments: { on: detail.id, count: h.openThreads(detail.id), open: (a) => h.showComments(detail.id, edit.gameId, a) },
    }));

    // Tags live inside the one Tags panel, hairline-separated blocks -
    // not their own heavier cards (one panel material, centre-clarity 1).
    const valBody: HTMLElement[] = edit.values.map((v, i) => {
      const block = el("div", { className: "doc-vblock" });
      const name = el("input", { className: "insp-input insp-mono" });
      name.value = v.gameId; name.placeholder = "<tag name>";
      name.addEventListener("input", () => { v.gameId = name.value; });
      name.addEventListener("change", commit);
      const del = el("button", { className: "insp-del small", text: "Remove", onClick: () => { edit.values.splice(i, 1); commit(); redraw(); } });
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
      const up = el("button", { className: "insp-move", text: "\u2191", tip: "Move up", onClick: () => swap(i - 1) }) as HTMLButtonElement;
      const down = el("button", { className: "insp-move", text: "\u2193", tip: "Move down", onClick: () => swap(i + 1) }) as HTMLButtonElement;
      up.disabled = i === 0;
      down.disabled = i === edit.values.length - 1;
      block.append(el("div", { className: "insp-ohead" }, el("span", { className: "insp-kv" }, chipDot(v.gameId), name),
        el("span", { className: "insp-moves" }, up, down, del)));
      block.append(bare("Tag properties", "When a hand with this tag is dealt to, these values appear as @hand.<name>.", propList(v.properties, commit, "+ Property")));
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
            el("span", { className: "set-dim", text: `group default ${decl.default || "(first stage)"}` })));
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
          el("span", { text: " is on every tag; declared here, a tag added later gets it too. " }),
        ),
        el("button", { className: "insp-add small", text: "Move it here", onClick: () => {
          hoistProperty(edit, name); commit(); redraw();
        } })));
    view.append(section("Properties", "every tag in this group has these",
      propList(edit.properties, () => { commit(); redraw(); }, "+ Property"), ...nudge));
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
        ? "Its tags are zones with outlines, drawn on the box's Map. Geography, or any other two-dimensional layout: acts, a cast, a tech tree."
        : "Turn on to draw these tags as a map. It need not be geography: acts and their beats, a cast and who is close to whom, anything you can lay out.",
      cfgCheck(spatial, (on) => h.setGroupSpatial(boxId, detail.id, on)),
    )));

    // Derived: who leans on this group.
    const cardsN = box.decks.flatMap((d) => d.cards).filter((c) => c.tags.some((m) => m.group === detail.gameId)).length;
    const templates = box.templates.filter((t) => t.bindings.some((b) => b.startsWith(`${detail.gameId} =`))).map((t) => t.gameId);
    view.append(derivedFooter(
      `${cardsN} card${cardsN === 1 ? "" : "s"} tagged · ${templates.length > 0 ? `bound by ${templates.join(", ")}` : "not bound by any hand template"}.`));
    centre.replaceChildren(view);
  }
  draw();
}


