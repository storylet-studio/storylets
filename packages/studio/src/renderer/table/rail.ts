// ---------------------------------------------------------------------------
// The Board's rail: Journal, State and Why not? as tabs, in both views
// (design/board-legibility.md piece 2). The journal is the story of the
// session so far, drawn from the rows journal.ts builds, with the filter chips
// that mute kinds of beat and the Copy that takes exactly what is shown.
// ---------------------------------------------------------------------------

import { copyWithFeedback, el, iconNode } from "@wildwinter/app-shell";
import type { IconName } from "@wildwinter/app-shell";
import { focusKey } from "../tool-window/focus.js";
import { journalPlan } from "./model.js";
import type { BoardLogEntry, LogEntry, Table } from "./model.js";
import { JOURNAL_SHOWN, journalRows, journalText } from "./journal.js";
import type { JournalRow } from "./journal.js";
import { activeLog } from "./board-state.js";
import type { Board, BoardState } from "./board-state.js";
import { statePanel } from "./state-panel.js";
import { whyPanel } from "./why-panel.js";

/** The tab the rail shows. Live mode is observe-only - nothing to poke - so it
 *  has no State tab, and a State tab chosen locally shows the journal there;
 *  Why not? reads the game's own deals. */
export function railTabShown(s: BoardState): BoardState["railTab"] {
  return s.railTab === "state" && s.liveMode ? "journal" : s.railTab;
}

export function rail(b: Board): HTMLElement {
  const s = b.state;
  const withState = !s.liveMode;
  const tab = railTabShown(s);
  const showJournal = tab === "journal";
  const tabButton = (id: BoardState["railTab"], text: string, tip?: string): HTMLElement =>
    focusKey(el("button", { className: `seg-opt railtab${tab === id ? " on" : ""}`, text, ...(tip !== undefined ? { tip } : {}),
      onClick: () => { s.railTab = id; b.render(); } }), `tab:${id}`);
  // The rows are the one model the screen and Copy share (journal.ts): Copy
  // takes exactly the rows shown here.
  const rows = showJournal ? currentJournal(s) : [];
  return el("aside", { className: "rail" },
    el("div", { className: "railtabs" },
      el("div", { className: "seg" },
        tabButton("journal", "Journal"),
        withState ? tabButton("state", "State", "The live story state") : null,
        tabButton("why", "Why not?", "Why the cards that could have come up in the selected hand didn't")),
      el("span", { className: "railgap" }),
      showJournal ? (() => {
        const copy = el("button", { className: "btn mini", text: "Copy", tip: "Copy the journal as shown" });
        copy.addEventListener("click", () => void copyWithFeedback(copy, journalText(rows)));
        return copy;
      })() : null),
    // The filter chips stay put while the story scrolls beneath them.
    showJournal ? journalChips(b) : null,
    showJournal ? journal(s, rows) : tab === "state" ? statePanel(b) : whyPanel(b));
}

/** The chips that mute kinds of beat (a muted chip greys out). A chip is its
 *  word, except the warning chip, which is the vocabulary's warning sign and the
 *  count: the count keeps a warning that scrolled away from being missed, and
 *  the word stays in its tooltip. */
function journalChips(b: Board): HTMLElement {
  const s = b.state;
  const warnCount = activeLog(s).filter((e) => e.type === "diagnostic").length;
  const kinds: { type: LogEntry["type"]; label: string; icon?: IconName; count?: number }[] = [
    { type: "deal", label: "dealt" }, { type: "play", label: "played" },
    { type: "write", label: "wrote" }, { type: "evict", label: "left" },
    { type: "turns", label: "turns" },
    { type: "diagnostic", label: "warning", icon: "warning", count: warnCount },
  ];
  return el("div", { className: "jfilters" }, ...kinds.map(({ type, label, icon, count }) =>
    focusKey(el("button", { className: `jflt${s.journalHidden.has(type) ? "" : " on"}`,
      tip: s.journalHidden.has(type) ? `Show ${label} entries` : `Hide ${label} entries`,
      onClick: () => {
        if (s.journalHidden.has(type)) s.journalHidden.delete(type); else s.journalHidden.add(type);
        b.render();
      } },
    ...(icon ? [iconNode(icon, 12), count !== undefined && count > 0 ? String(count) : null] : [label])), `jflt:${type}`)));
}

/** The journal itself: the latest rows, newest at the bottom. */
function journal(s: BoardState, rows: JournalRow[]): HTMLElement {
  const out = el("div", { className: `journal${stampBoxes(s.table) ? " stamped" : ""}` });
  if (rows.length === 0) out.append(el("span", { className: "empty", text: s.journalHidden.size > 0 ? "Nothing matches these filters." : "Nothing has happened yet." }));
  for (const r of rows.slice(-JOURNAL_SHOWN)) out.append(journalRowEl(r));
  return out;
}

/** The journal as rows (journal.ts), the filter chips applied: what the screen
 *  draws and what Copy writes out, from the one model. The plan (journalPlan,
 *  model.ts) makes a play carry its writes and its consequences; an attributed
 *  deal or evict never renders flat again; a full every-box advance is one
 *  beat. */
function currentJournal(s: BoardState): JournalRow[] {
  const table = s.table;
  const full = activeLog(s);
  const plan = journalPlan(full, (i) => (table ? table.rippleFor(full, i) : []), table?.boxes().length ?? 0);
  return journalRows(plan, {
    label: (id) => table?.label(id) ?? { gameId: id },
    // Evict events carry the hand's ID where deal events carry its gameId (a
    // trace quirk that is a four-runtime fixture change to fix at source):
    // translate here so the ripple always names hands the way the board does.
    handName: (h) => table?.hands().find((x) => x.gameId === h || x.id === h)?.gameId ?? h,
    stamp: (entry) => stampOf(table, entry),
    hidden: s.journalHidden,
  });
}

/** A journal row on screen: the stamp, the kind (the warning sign for a
 *  warning), and the payload with the vocabulary's arrow drawn. */
function journalRowEl(row: JournalRow): HTMLElement {
  return el("div", { className: `jrow ${row.cls}` },
    el("span", { className: "jt", text: row.stamp }),
    el("span", { className: "jk" }, row.warning ? iconNode("warning", 12) : row.kind),
    el("span", { className: "jp" }, ...row.parts.map((p) => (typeof p === "string" ? p : becomes()))));
}

/** The journal's "becomes" arrow between a before and an after (a card and
 *  the hand it went to, a value and its new one): the vocabulary's drawing,
 *  not a typed "→". */
function becomes(): HTMLElement {
  return el("span", { className: "jarrow" }, iconNode("arrowRight", 12));
}

// --- stamps --------------------------------------------------------------------------

/** Are stamps box-qualified? Only where drift can exist: a multi-box project.
 *  A single box keeps the bare T-number the qualification would only bloat. */
const stampBoxes = (table: Table | undefined): boolean => (table?.boxes().length ?? 0) > 1;

/** The box a journal entry belongs to, as the gameId the clocks speak. */
function entryBoxName(table: Table | undefined, entry: BoardLogEntry): string | undefined {
  if (!table) return undefined;
  switch (entry.type) {
    case "deal":
    case "evict":
      return table.hands().find((h) => h.gameId === entry.hand || h.id === entry.hand)?.box;
    case "play":
      return table.boxOf(entry.card);
    case "turns":
      return entry.box;
    default:
      return undefined;
  }
}

/** The stamp: "contracts 4" in a multi-box project (clocks forward, design/
 *  board-legibility.md piece 4 - bare T-numbers from different clocks read as
 *  time travel), "T4" where only one clock exists. */
function stampOf(table: Table | undefined, entry: BoardLogEntry): string {
  const turn = "turn" in entry && entry.turn !== undefined ? entry.turn : undefined;
  if (turn === undefined) return "";
  if (!stampBoxes(table)) return `T${turn}`;
  const box = entryBoxName(table, entry);
  return box !== undefined ? `${box} ${turn}` : `T${turn}`;
}
