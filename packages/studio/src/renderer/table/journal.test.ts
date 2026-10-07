// The Board's journal as one row model (journal.ts): the screen draws the rows
// and Copy writes the same rows out, so Copy takes what the screen shows, the
// quotes and the cap included. Expectations hand-written from the journal's
// design (design/board-legibility.md piece 3), not read back from the code.

import { describe, expect, it } from "vitest";
import { journalPlan } from "./model.js";
import type { BoardLogEntry, LogEntry } from "./model.js";
import { BECOMES, JOURNAL_SHOWN, journalRowText, journalRows, journalText } from "./journal.js";
import type { JournalContext } from "./journal.js";

type Sans<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
const L = (entries: Sans<LogEntry, "seq">[]): BoardLogEntry[] =>
  entries.map((e, i) => ({ ...e, seq: i } as LogEntry));

const TITLES: Record<string, string> = { c_ambush: "Ambush", c_masthead: "The Masthead", c_patrols: "Patrols" };
const ctx = (hidden: LogEntry["type"][] = []): JournalContext => ({
  label: (id) => ({ gameId: id, ...(TITLES[id] !== undefined ? { title: TITLES[id] } : {}) }),
  handName: (h) => (h === "h_docks" ? "docks-street" : h),
  stamp: (e) => ("turn" in e && e.turn !== undefined ? `T${e.turn}` : ""),
  hidden: new Set(hidden),
});
const READS: Record<string, string[]> = { c_patrols: ["story.heat"] };
const rowsOf = (log: BoardLogEntry[], hidden: LogEntry["type"][] = []) =>
  journalRows(journalPlan(log, (i) => {
    const play = log[i];
    if (play?.type !== "play") return [];
    // The ripple for these fixtures: a deal reading what the play wrote.
    const writes = new Set(log.slice(0, i).filter((e) => e.type === "write").map((e) => (e as { path: string }).path));
    return log.slice(i + 1).flatMap((e) => (e.type === "deal"
      ? e.cards.filter((c) => c.verdict === "dealt" && (READS[c.id] ?? []).some((r) => writes.has(r)))
          .map((c) => ({ kind: "dealt" as const, card: c.id, hand: e.hand, why: "reads" as const, seq: e.seq }))
      : []));
  }, 1), ctx(hidden));

describe("the journal's rows", () => {
  it("tells a play with its writes and its consequences under it, quoted and with the arrow", () => {
    const rows = rowsOf(L([
      { type: "write", target: "@story.heat", path: "story.heat", prev: 1, value: 2 },
      { type: "play", card: "c_ambush", outcome: "fight", turn: 4 },
      { type: "deal", hand: "docks-street", cards: [{ id: "c_patrols", verdict: "dealt" }], turn: 4 },
    ]));
    expect(rows.map((r) => [r.kind, r.under === true])).toEqual([["played", false], ["wrote", true], ["and so", true]]);
    expect(rows[0]!.parts).toEqual(["“Ambush”", BECOMES, "fight"]);
    expect(rows.map(journalRowText)).toEqual([
      "T4\tplayed\t“Ambush” -> fight",
      "\twrote\t@story.heat 1 -> 2",
      "\tand so\t“Patrols” -> docks-street",
    ]);
  });

  it("writes a card played with no outcome without an arrow", () => {
    const [row] = rowsOf(L([{ type: "play", card: "c_masthead", outcome: "", turn: 1 }]));
    expect(journalRowText(row!)).toBe("T1\tplayed\t“The Masthead”");
  });

  it("names a top-level beat with no clock as --, so the columns line up", () => {
    const [row] = rowsOf(L([{ type: "diagnostic", where: "c_ambush", message: "bad maths" }]));
    expect(row!.warning).toBe(true);
    expect(journalRowText(row!)).toBe("--\twarning\tc_ambush: bad maths");
  });

  it("drops what the chips hide: a play's writes ride wrote, the play rides played", () => {
    const log = L([
      { type: "write", target: "@story.heat", path: "story.heat", value: 2 },
      { type: "play", card: "c_ambush", outcome: "fight", turn: 4 },
    ]);
    expect(rowsOf(log, ["write"]).map((r) => r.kind)).toEqual(["played"]);
    expect(rowsOf(log, ["play"])).toEqual([]);
  });

  it("leaves a quiet refresh out: a deal that dealt nothing is not a beat", () => {
    expect(rowsOf(L([{ type: "deal", hand: "docks-street", cards: [{ id: "c_ambush", verdict: "capped" }] }]))).toEqual([]);
  });
});

describe("Copy", () => {
  it("takes the rows the screen shows: the latest, and no more", () => {
    const log = L(Array.from({ length: JOURNAL_SHOWN + 20 }, (_, i) => ({ type: "play" as const, card: "c_ambush", outcome: `o${i}`, turn: i })));
    const lines = journalText(rowsOf(log)).split("\n");
    expect(lines).toHaveLength(JOURNAL_SHOWN);
    expect(lines[0]).toBe(`T20\tplayed\t“Ambush” -> o20`);
    expect(lines[lines.length - 1]).toBe(`T${JOURNAL_SHOWN + 19}\tplayed\t“Ambush” -> o${JOURNAL_SHOWN + 19}`);
  });
});
