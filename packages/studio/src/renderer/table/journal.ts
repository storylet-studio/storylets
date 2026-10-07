// ---------------------------------------------------------------------------
// The Board's journal as rows: one model, built from the plan (journalPlan,
// model.ts), that the screen draws and Copy writes out. They were built twice,
// once as DOM and once as text, and had drifted: Copy dropped the quotes the
// screen shows, and took 200 rows where the screen shows 80. Now Copy takes
// what the screen shows, because both read the same rows.
//
// Pure, so it tests headlessly: the window hands in how to name a card, a hand
// and a stamp.
// ---------------------------------------------------------------------------

import type { BoardLogEntry, JournalItem, LogEntry } from "./model.js";

/** One piece of a row's payload: words, or the vocabulary's "becomes" arrow. */
export type JournalPart = string | { arrow: true };
export const BECOMES: JournalPart = { arrow: true };

export interface JournalRow {
  /** The clock it happened on ("T4", "contracts 4"), or "" for none. */
  stamp: string;
  /** What kind of beat: "dealt", "played", "wrote", "and so"... */
  kind: string;
  /** Drawn as the warning sign on screen; written as its word. */
  warning?: true;
  /** The beat's class on screen (`j-play`, `j-ripple`...). */
  cls: string;
  /** A play's own writes and consequences, told under it. */
  under?: true;
  parts: JournalPart[];
}

/** What the rows need from the window: names, stamps, and the chips. */
export interface JournalContext {
  /** A card's label, for quoting it. */
  label: (cardRef: string) => { gameId: string; title?: string };
  /** A hand by the name the board uses (an evict names its hand by id). */
  handName: (hand: string) => string;
  /** The entry's stamp, or "". */
  stamp: (entry: BoardLogEntry) => string;
  /** Kinds muted by the filter chips. */
  hidden: ReadonlySet<LogEntry["type"]>;
}

/** The screen shows the latest rows only; Copy takes the same ones. */
export const JOURNAL_SHOWN = 80;

const json = (v: unknown): string => JSON.stringify(v);

export function journalRows(plan: readonly JournalItem[], ctx: JournalContext): JournalRow[] {
  const quote = (cardRef: string): string => {
    const l = ctx.label(cardRef);
    return `“${l.title ?? l.gameId}”`;
  };
  /** A value changing: what it was (when known), the arrow, what it is. */
  const change = (prev: unknown, value: unknown): JournalPart[] =>
    prev !== undefined ? [json(prev), BECOMES, json(value)] : [json(value)];

  const entryRow = (e: BoardLogEntry): JournalRow | null => {
    const stamp = ctx.stamp(e);
    switch (e.type) {
      case "deal": {
        const dealt = e.cards.filter((c) => c.verdict === "dealt");
        if (dealt.length === 0) return null;   // a quiet refresh is not a story beat
        return { stamp, kind: "dealt", cls: "j-deal", parts: [dealt.map((c) => quote(c.id)).join(", "), BECOMES, e.hand] };
      }
      case "play":
        return { stamp, kind: "played", cls: "j-play", parts: [quote(e.card), ...(e.outcome === "" ? [] : [BECOMES, e.outcome])] };
      case "write":
        return { stamp, kind: "wrote", cls: "j-write", parts: [`${e.target} `, ...change(e.prev, e.value)] };
      case "evict":
        return { stamp, kind: "left", cls: "j-evict", parts: [`${quote(e.card)} (${e.reason})`] };
      case "turns":
        return { stamp, kind: "turn", cls: "j-turn", parts: [`${e.box} advances to ${e.turn}`] };
      case "peek":
        return null;   // looking is not a story beat (the look/use rule)
      case "diagnostic":
        return { stamp, kind: "warning", warning: true, cls: "j-warn", parts: [`${e.where}: ${e.message}`] };
      case "meddle":
        return { stamp, kind: "meddled", cls: "j-meddle", parts: [`${e.label} `, ...change(e.prev, e.value)] };
    }
  };

  // The chips gate kinds: a play's group rides the played chip, its writes also
  // honour wrote, and meddles ride wrote too (both are state changes).
  const rows: JournalRow[] = [];
  for (const item of plan) {
    if (item.kind === "play") {
      if (ctx.hidden.has("play")) continue;
      const row = entryRow(item.entry);
      if (row) rows.push(row);
      if (!ctx.hidden.has("write")) {
        for (const w of item.writes) {
          rows.push({ stamp: "", kind: "wrote", cls: "j-write j-in", under: true, parts: [`${w.target} `, ...change(w.prev, w.value)] });
        }
      }
      for (const r of item.ripple) {
        rows.push({
          stamp: "", kind: "and so", cls: "j-ripple", under: true,
          parts: r.kind === "dealt"
            ? [quote(r.card), BECOMES, `${ctx.handName(r.hand)}${r.why === "slot" ? " (took the freed slot)" : ""}`]
            : [`${quote(r.card)} left ${ctx.handName(r.hand)}`],
        });
      }
    } else if (item.kind === "turns") {
      if (ctx.hidden.has("turns")) continue;
      rows.push(item.uniform !== undefined
        ? { stamp: `T${item.uniform}`, kind: "turn", cls: "j-turn", parts: ["every box", BECOMES, String(item.uniform)] }
        : { stamp: "", kind: "turn", cls: "j-turn", parts: ["every box +1"] });
    } else {
      const gate = item.entry.type === "meddle" ? "write" : item.entry.type;
      if (ctx.hidden.has(gate)) continue;
      const row = entryRow(item.entry);
      if (row) rows.push(row);
    }
  }
  return rows;
}

/** A row as Copy writes it: tab-separated stamp, kind and payload, the arrow
 *  as "->". A beat told under its play has no stamp; a top-level beat with no
 *  clock says "--", so the columns still line up in a spreadsheet. */
export function journalRowText(row: JournalRow): string {
  const payload = row.parts.map((p) => (typeof p === "string" ? p : " -> ")).join("")
    // A change written as "target " + value leaves no double space before the arrow.
    .replace(/ {2,}->/g, " ->");
  return `${row.under ? "" : row.stamp || "--"}\t${row.kind}\t${payload}`;
}

/** The rows the screen shows (the latest), as Copy writes them. */
export function journalText(rows: readonly JournalRow[]): string {
  return rows.slice(-JOURNAL_SHOWN).map(journalRowText).join("\n");
}
