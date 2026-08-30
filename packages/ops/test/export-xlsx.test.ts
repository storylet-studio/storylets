// ---------------------------------------------------------------------------
// The readable export, read back with exceljs against the example project:
// the sheet list, the header rows, and a handful of cells that prove the
// resolution work (tag ids to gameIds, fields from the card template, the
// outcomes flattened both ways, hands' tags through their template's hole).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { loadProject } from "../src/load.js";
import { runExportXlsx, spreadsheetFileName } from "../src/export-xlsx.js";
import type { SourceProject } from "@storylet-studio/compiler";

const exampleDir = fileURLToPath(new URL("../../../examples/the-hamlet.storylets", import.meta.url));

const headers = (ws: ExcelJS.Worksheet): string[] => (ws.getRow(1).values as string[]).filter(Boolean);
const text = (v: ExcelJS.CellValue): string => (v == null ? "" : typeof v === "object" && "richText" in v ? v.richText.map((r) => r.text).join("") : String(v));
const rowWhere = (ws: ExcelJS.Worksheet, col: number, value: string): string[] => {
  const found = ws.getSheetValues().find((r) => Array.isArray(r) && text(r[col]) === value) as ExcelJS.CellValue[] | undefined;
  expect(found, `${ws.name}: a row whose column ${col} is ${JSON.stringify(value)}`).toBeDefined();
  return found!.map(text);
};

async function exported(source: SourceProject) {
  const result = await runExportXlsx(source, { generated: new Date("2026-08-21T10:00:00Z") });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(result.buffer as unknown as ArrayBuffer);
  return { result, wb };
}

describe("runExportXlsx on the example project", async () => {
  const loaded = loadProject(exampleDir);
  const source = loaded.source!;
  const { result, wb } = await exported(source);

  it("lays out Overview, one sheet per deck in authored order, then Outcomes, Hands, Tag groups", () => {
    // Ambients carries order 0.5 and the rest fall back to file position, so it
    // leads, as it does in the navigator.
    expect(wb.worksheets.map((ws) => ws.name)).toEqual([
      "Overview", "Ambients", "Arrival", "The Calling Tree", "Gareth's Debt", "Mira's Secret",
      "Outcomes", "Hands", "Tag groups",
    ]);
    expect(result.sheets).toEqual(wb.worksheets.map((ws) => ws.name));
  });

  it("counts what it wrote, and the Overview says the same", () => {
    expect(result.counts.boxes).toBe(1);
    expect(result.counts.decks).toBe(5);
    expect(result.counts.cards).toBeGreaterThan(10);
    expect(result.counts.hands).toBe(3);
    expect(result.counts.tagGroups).toBe(1);
    const overview = wb.getWorksheet("Overview")!;
    expect(rowWhere(overview, 1, "Project")[2]).toBe("The Hamlet");
    expect(rowWhere(overview, 1, "Version")[2]).toBe("0.1.0");
    expect(rowWhere(overview, 1, "Cards")[2]).toBe(String(result.counts.cards));
    expect(rowWhere(overview, 1, "Generated")[2]).toBe("2026-08-21 10:00:00 UTC");
    expect(rowWhere(overview, 1, "Content hash")[2]).toMatch(/^[0-9a-z]{7}$/);
    // The sheet index at the foot names every deck sheet.
    expect(rowWhere(overview, 1, "Ambients")[3]).toBe("Village");
  });

  it("gives a deck sheet the fixed columns, a column per tag group and per card field, then Purpose and Outcomes", () => {
    const arrival = wb.getWorksheet("Arrival")!;
    // One box, so no Box column.
    // "Place" is the reserved home group, headed for a reader rather than by
    // its internal name, and it appears because the Hamlet's cards use it.
    // Shared and In the world sit beside Copies: they are the same question
    // (how many of this card exist) asked of the world rather than of a board.
    expect(headers(arrival)).toEqual(["Title", "gameId", "When", "Priority", "Redraw", "Copies",
      "Shared", "In the world", "area", "Place", "scene", "Purpose", "Outcomes"]);
    expect(arrival.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(arrival.getRow(1).font?.bold).toBe(true);
  });

  it("writes a card row with its tags as gameIds, its field, and its outcomes flattened", () => {
    const arrival = wb.getWorksheet("Arrival")!;
    const row = rowWhere(arrival, 2, "settle-at-the-inn");
    expect(row[1]).toBe("Get Settled at the Inn");
    expect(row[3]).toBe("not check_flags(@rel_innkeeper, +met)");
    expect(row[4]).toBe("3");
    expect(row[5]).toBe("never");
    expect(row[6]).toBe("1");
    // Neither the card nor its deck opts in, so the card defers to the deck
    // ("deck") and has no world count at all. The three-state reading is the
    // card page's: "deck" is not the same answer as a flat no.
    expect(row[7]).toBe("deck");
    expect(row[8]).toBe("");
    // This card belongs AT The Inn, not anywhere in the village, so the area
    // column is empty and Place carries the hand. That is the direct form the
    // Hamlet gained in 2026-08-21's Where work; a regional card is the mirror
    // of it (see "Market Bustle" below).
    expect(row[9]).toBe("");                // area: not a regional card
    expect(row[10]).toBe("the-inn");        // Place: the reserved home group
    expect(row[11]).toBe("scn_inn");        // the box's card field
    // The mirror: a card that IS regional fills area and leaves Place empty.
    const bustle = rowWhere(wb.getWorksheet("Ambients")!, 2, "market-bustle");
    expect(bustle[9]).toBe("village");
    expect(bustle[10]).toBe("");
    // DISPLAY order, which is what the card document shows and what the bundle
    // carries: "warmly" is order 0 in the shard even though its id sorts second.
    // The export read storage order until 2026-08-21 and so disagreed with both.
    expect(row[13]).toBe([
      "Ask warmly about the village's history: @story.rel_innkeeper = set_flags(@rel_innkeeper, +met, +warm); @story.reputation = @reputation + 1",
      "Ask only about the road north: @story.rel_innkeeper = set_flags(@rel_innkeeper, +met)",
    ].join("\n"));
  });

  it("lists every outcome on its own row of the Outcomes sheet", () => {
    const outcomes = wb.getWorksheet("Outcomes")!;
    expect(headers(outcomes)).toEqual(["Deck", "Card", "Outcome", "gameId", "When", "Changes", "Purpose"]);
    const row = rowWhere(outcomes, 4, "ask-about-the-road-north");
    expect(row[1]).toBe("Arrival");
    expect(row[2]).toBe("Get Settled at the Inn");
    expect(row[6]).toBe("@story.rel_innkeeper = set_flags(@rel_innkeeper, +met)");
    expect(outcomes.rowCount - 1).toBe(result.counts.outcomes);
  });

  it("lists hands with their template, their tags through the template's hole, and slots", () => {
    const hands = wb.getWorksheet("Hands")!;
    expect(headers(hands)).toEqual(["Hand", "gameId", "Template", "When", "Tags", "Slots", "Purpose"]);
    const tree = rowWhere(hands, 2, "the-mystic-tree");
    expect(tree[1]).toBe("The Mystic Tree");
    expect(tree[3]).toBe("whats-happening");
    expect(tree[5]).toBe("area = forest");
    expect(tree[6]).toBe("1");
  });

  it("lists every tag of every group with its properties", () => {
    const tags = wb.getWorksheet("Tag groups")!;
    expect(headers(tags)).toEqual(["Group", "Tag", "Properties", "Purpose"]);
    const forest = rowWhere(tags, 2, "forest");
    expect(forest[1]).toBe("area");
    expect(forest[3]).toBe("peril = 0");
    expect(forest[4]).toBe("Where in the world this beat belongs.");
  });

  it("suggests the project's name as the file name", () => {
    expect(spreadsheetFileName(source)).toBe("The Hamlet.xlsx");
  });
});

describe("sheet naming", () => {
  it("adds a Box column and disambiguates colliding deck titles across boxes", async () => {
    const loaded = loadProject(exampleDir);
    const one = loaded.source!;
    const boxA = one.boxes[0]!;
    const arrival = boxA.decks.find((d) => d.shard.deck.title === "Arrival")!;
    // A second box whose one deck shares the first box's deck title, plus a deck
    // titled like a fixed sheet and one with characters Excel refuses.
    const boxB = {
      ...boxA,
      path: "other",
      box: { ...boxA.box, box: { ...boxA.box.box, id: "b_other", gameId: "other", title: "Other" } },
      hands: { ...boxA.hands, hands: [] },
      decks: [
        { path: "other/decks/arrival.storyletdeck", shard: { ...arrival.shard, deck: { ...arrival.shard.deck, id: "k_other_arrival" } } },
        { path: "other/decks/hands.storyletdeck", shard: { ...arrival.shard, deck: { ...arrival.shard.deck, id: "k_hands", title: "Hands" }, cards: [] } },
        { path: "other/decks/q.storyletdeck", shard: { ...arrival.shard, deck: { ...arrival.shard.deck, id: "k_q", title: "What: a/b?" }, cards: [] } },
      ],
    };
    const two: SourceProject = { ...one, boxes: [boxA, boxB] };
    const { wb } = await exported(two);
    const names = wb.worksheets.map((ws) => ws.name);
    expect(names).toContain("Arrival");
    expect(names).toContain("Arrival (Other)");
    expect(names).toContain("Hands (Other)");
    expect(names).toContain("What- a-b-");
    expect(headers(wb.getWorksheet("Arrival (Other)")!)[0]).toBe("Box");
    expect(rowWhere(wb.getWorksheet("Arrival (Other)")!, 3, "settle-at-the-inn")[1]).toBe("Other");
  });
});
