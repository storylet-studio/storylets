// ---------------------------------------------------------------------------
// The Find window (Patterpad's detached search tool, ported): a small,
// frameless, pinnable helper that floats over the editor. Three tabs, in
// Patterpad's order and look: FIND filters every navigable thing in the
// project; REPLACE rewrites text (titles, purposes, card string fields) across
// every item, previewed before → after; PROPERTY lists every read and write of
// a property, with the outcome that writes it. A hit drives the editor over
// IPC and the window stays put, so you can step through hits while the editor
// stays live underneath. Esc closes.
// ---------------------------------------------------------------------------

import "../src/theme.css";
import "./search.css";
import "@wildwinter/app-shell/tooltip.css";
import { applyTheme } from "../src/theme.js";
import { toolWindowHead } from "../src/tool-window-head.js";
import { el } from "../src/dom.js";
import { confirmDialog, initTooltips, pinButton } from "@wildwinter/app-shell";
import { searchIndex, searchMatch } from "../src/search.js";
import type { SearchHit } from "../src/search.js";
import type { ProjectDto, PropertyUsage, ReplaceHit, ReplaceOptions, ReviewAt, SearchMode, SearchOpen, StudioApi } from "../../shared/api.js";

declare global { interface Window { studio: StudioApi; } }
const studio = window.studio;

const root = document.getElementById("find")!;
let project: ProjectDto | undefined;
let mode: SearchMode = "find";
let query = "";
let replacement = "";
let hits: SearchHit[] = [];            // Find
let usages: PropertyUsage[] = [];      // Property
let replaceHits: ReplaceHit[] = [];    // Replace (the preview)
let active = 0;
let pinned = true;
let token = 0;   // an out-of-order async answer must not overwrite a newer query

const MODES: { mode: SearchMode; label: string }[] = [
  { mode: "find", label: "Find" },
  { mode: "replace", label: "Replace" },
  { mode: "property", label: "Property" },
];
const PLACEHOLDER: Record<SearchMode, string> = {
  find: "Decks, cards, hands, tags…",
  replace: "Find text to replace…",
  property: "Property… (@gold, @story.act, @world.time_of_day)",
};


async function refreshProject(): Promise<void> {
  const result = await studio.revalidate();
  if (result) { project = result.project; void run(); }
}

let listEl: HTMLElement;
let inputEl: HTMLInputElement;
let replaceEl: HTMLInputElement;
let replaceRow: HTMLElement;
let replaceAllBtn: HTMLButtonElement;
const tabEls = new Map<SearchMode, HTMLButtonElement>();

// --- navigation ---------------------------------------------------------------

/** Where a Property hit goes: its item, an outcome as its card with that
 *  outcome expanded. A tag group is never a hit (nothing on it reads a
 *  property), so the fall-through is the box. */
function placeOf(u: PropertyUsage): ReviewAt {
  const i = u.item;
  switch (i.kind) {
    case "card": return { kind: "card", box: i.box, deck: i.deck!, card: i.card! };
    case "outcome": return { kind: "outcome", box: i.box, deck: i.deck!, card: i.card!, outcome: i.id };
    case "deck": return { kind: "deck", box: i.box, deck: i.deck! };
    case "hand": return { kind: "hand", box: i.box, hand: i.id };
    case "template": return { kind: "template", box: i.box, template: i.id };
    case "tagGroup": return { kind: "tagGroup", box: i.box, group: i.id };
    case "box": return { kind: "box", box: i.box };
  }
}

function rowCount(): number {
  return mode === "find" ? hits.length : mode === "property" ? usages.length : 0;
}

function choose(i: number): void {
  if (mode === "find") { const hit = hits[i]; if (hit) void studio.searchReveal(hit.selection); }
  else if (mode === "property") { const u = usages[i]; if (u) void studio.searchReveal(placeOf(u)); }
}

// --- rendering ----------------------------------------------------------------

function none(text: string): HTMLElement {
  return el("div", { className: "sr-none", text });
}

function renderFind(): void {
  listEl.replaceChildren(...hits.map((hit, i) =>
    el("button", { className: `sr-row${i === active ? " active" : ""}`, onClick: () => choose(i) },
      el("span", { className: "sr-kind", text: hit.kind }),
      el("span", { className: "sr-label", text: hit.label }),
      el("span", { className: "sr-sub", text: hit.sublabel }))));
  if (hits.length === 0) listEl.replaceChildren(none(project ? "nothing matches" : "no project open"));
}

function renderProperty(): void {
  listEl.replaceChildren(...usages.map((u, i) => {
    const item = u.item;
    // An outcome is named with its card, the way the editor shows it.
    const label = item.kind === "outcome"
      ? `${item.location[item.location.length - 1] ?? ""} › ${item.title ?? item.gameId}`
      : item.title ?? item.gameId;
    return el("button", { className: `sr-row${i === active ? " active" : ""}`, onClick: () => choose(i) },
      el("span", { className: "sr-kind", text: item.kind }),
      el("span", { className: "sr-label", text: label }),
      el("span", { className: `sr-use ${u.use}`, text: u.use === "read" ? "reads" : "writes" }),
      el("span", { className: "sr-sub", text: `${u.where} · ${u.text}` }));
  }));
  if (usages.length === 0) {
    listEl.replaceChildren(none(!project ? "no project open" : query.trim() ? "nothing reads or writes that" : "type a property: @gold, @story.act, @world.time_of_day"));
  }
}

/** The texts a Replace hit names, in the words the editor uses for them. */
function fieldLabel(h: ReplaceHit): string {
  if (h.field === "name") return "name";
  if (h.field.startsWith("field:")) return `field ${h.field.slice("field:".length)}`;
  return h.field;
}

function renderReplace(): void {
  replaceAllBtn.textContent = replaceHits.length ? `Replace all (${replaceHits.length})` : "Replace all";
  replaceAllBtn.disabled = replaceHits.length === 0;
  listEl.replaceChildren(...replaceHits.map((h) => {
    const row = el("div", { className: "sr-row sr-rrow" },
      el("span", { className: "sr-diff" },
        el("span", { className: "sr-before", text: h.before }),
        el("span", { className: "sr-arrow", text: " → " }),
        el("span", { className: "sr-after", text: h.after })),
      el("span", { className: "sr-sub", text: `${[...h.location, h.kind === "project" ? "project" : ""].filter((s) => s !== "").join(" › ")} · ${fieldLabel(h)}` }),
      el("button", { className: "sr-rone", text: "Replace", onClick: () => void applyReplace(h) }));
    return row;
  }));
  if (replaceHits.length === 0) {
    listEl.replaceChildren(none(!project ? "no project open" : query.trim() ? "nothing matches" : "type the text to find; titles, purposes and card fields are searched"));
  }
}

function render(): void {
  if (active >= rowCount()) active = 0;
  if (mode === "find") renderFind();
  else if (mode === "property") renderProperty();
  else renderReplace();
}

// --- queries ------------------------------------------------------------------

/** The search index, rebuilt only when the project itself changes.
 *
 *  Find deliberately filters as you type with no debounce (below), and it used
 *  to rebuild the WHOLE index on every keystroke: a walk of every card, every
 *  outcome, a joined `uses` string and two template literals per hit, to answer
 *  a query over data that had not changed. Measured at 20 000 cards: 5.2ms of
 *  the 9.9ms round trip was the index. It is a pure function of the project, so
 *  it is memoised on the project's identity - `refreshProject` hands over a new
 *  object, which is exactly when a rebuild is due. */
let indexed: { of: ProjectDto; rows: SearchHit[] } | undefined;
const indexOf = (p: ProjectDto): SearchHit[] => {
  if (indexed?.of !== p) indexed = { of: p, rows: searchIndex(p) };
  return indexed.rows;
};

const replaceOpts = (): ReplaceOptions => ({ query, replacement });

async function run(): Promise<void> {
  const mine = ++token;
  if (mode === "find") {
    hits = project ? searchMatch(indexOf(project), query) : [];
  } else if (mode === "property") {
    const found = project && query.trim() ? await studio.propertyUsage(query) : [];
    if (mine !== token) return;
    usages = found;
  } else {
    const found = project && query.trim() ? (await studio.replacePreview(replaceOpts())).hits : [];
    if (mine !== token) return;
    replaceHits = found;
  }
  render();
}

let debounce: ReturnType<typeof setTimeout> | undefined;
/** Find filters as you type; the other two ask main, so they wait a beat. */
function runSoon(): void {
  clearTimeout(debounce);
  if (mode === "find") { void run(); return; }
  debounce = setTimeout(() => void run(), 110);
}

/** Apply the replacement: one hit, or every previewed one. A bulk replace is
 *  confirmed with its count first; it is one undo step in the editor. */
async function applyReplace(only?: ReplaceHit): Promise<void> {
  const n = only ? 1 : replaceHits.length;
  if (n === 0) return;
  if (!only) {
    const items = new Set(replaceHits.map((h) => h.id)).size;
    const ok = await confirmDialog({
      title: `Replace ${n} occurrence${n === 1 ? "" : "s"} across ${items} item${items === 1 ? "" : "s"}?`,
      body: `“${query}” → “${replacement}”`,
      confirmLabel: "Replace",
    });
    if (!ok) return;
  }
  const res = await studio.replaceApply(only ? { ...replaceOpts(), onlyId: only.id, onlyField: only.field } : replaceOpts());
  if ("error" in res) { listEl.replaceChildren(none(`Replace failed: ${res.error}`)); return; }
  await refreshProject();   // the applied hits are gone; the preview says so
}

// --- modes --------------------------------------------------------------------

function setMode(next: SearchMode): void {
  mode = next;
  for (const [m, btn] of tabEls) {
    btn.classList.toggle("active", m === mode);
    btn.setAttribute("aria-selected", String(m === mode));
  }
  inputEl.placeholder = PLACEHOLDER[mode];
  replaceRow.hidden = mode !== "replace";
  active = 0;
  void run();
  inputEl.focus();
  inputEl.select();
}

function mount(): void {
  const pin = pinButton({ pinned, onToggle: (on) => { pinned = on; void studio.setSearchPinned(on); } });
  // Reset View re-pins every helper window in main and tells the window after
  // the fact, so the button must be able to show a state it did not choose
  // (app-shell 0.23.0). This window mounts once, so it keeps the handle and
  // drives it; `set` deliberately does not call back into `onToggle`.
  studio.onWindowPinned((on) => { pinned = on; pin.set(on); });

  // The tabs stand where the title did (Patterpad's bar: modes left, pin and
  // close right). The segmented control is our container, so it opts out of
  // the drag region itself; the shell's rule only covers the buttons inside.
  const modes = el("div", { className: "swin-modes" });
  modes.setAttribute("role", "tablist");
  for (const { mode: m, label } of MODES) {
    const btn = el("button", { className: "swin-mode", text: label, onClick: () => setMode(m) });
    btn.type = "button";
    btn.setAttribute("role", "tab");
    tabEls.set(m, btn);
    modes.append(btn);
  }

  // A slim, draggable bar in place of the OS title bar (the window is frameless).
  // No title: the tabs stand where it would be. The pin is passed in already
  // built, because this window mounts its chrome ONCE and drives the button
  // with pin.set(on) - see the note where `pin` is created.
  const head = toolWindowHead({
    pin,
    onClose: () => void studio.closeSearch(),
    lead: [modes],
  });

  inputEl = el("input", { className: "swin-input" });
  inputEl.spellcheck = false;
  inputEl.addEventListener("input", () => { query = inputEl.value; active = 0; runSoon(); });
  inputEl.addEventListener("keydown", (event) => {
    if (mode === "replace") return;   // its rows carry their own buttons
    if (event.key === "ArrowDown") { active = Math.min(active + 1, rowCount() - 1); render(); event.preventDefault(); }
    else if (event.key === "ArrowUp") { active = Math.max(active - 1, 0); render(); event.preventDefault(); }
    else if (event.key === "Enter") { choose(active); event.preventDefault(); }
  });

  // Replace only: the replacement text and the bulk apply.
  replaceEl = el("input", { className: "swin-input swin-replace" });
  replaceEl.placeholder = "Replace with…";
  replaceEl.spellcheck = false;
  replaceEl.addEventListener("input", () => { replacement = replaceEl.value; runSoon(); });
  replaceAllBtn = el("button", { className: "swin-replace-all", text: "Replace all", onClick: () => void applyReplace() });
  replaceAllBtn.type = "button";
  replaceRow = el("div", { className: "swin-replace-row" }, replaceEl, replaceAllBtn);
  replaceRow.hidden = true;

  listEl = el("div", { className: "sr-list" });
  root.replaceChildren(head, inputEl, replaceRow, listEl);
  setMode(mode);
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") void studio.closeSearch();
});
// The editor may have changed while Find was open; refresh on return.
window.addEventListener("focus", () => void refreshProject());

/** Open on a tab, with a query as if it had been typed (a seeded open: the
 *  Coverage window's gate links arrive here as the Property tab carrying a
 *  ref; the Edit and Review menus arrive as a bare tab). */
function seed(open: SearchOpen): void {
  if (open.query !== undefined) {
    query = open.query;
    if (inputEl) { inputEl.value = open.query; }
  }
  setMode(open.mode ?? mode);
}

studio.onSearchSeed(seed);
// A different project underneath: the hits on screen are the old one's.
studio.onProjectChanged(() => void refreshProject());

async function boot(): Promise<void> {
  initTooltips();
  const state = await studio.getState();
  applyTheme(state.theme);
  studio.onTheme(applyTheme);
  pinned = state.searchPinned;
  mount();
  await refreshProject();
  const pending = await studio.pendingSearchQuery();
  if (pending !== undefined) seed(pending);
}
void boot();
