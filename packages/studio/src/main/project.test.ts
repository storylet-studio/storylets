// The project session tested headlessly against the real example project:
// ops in, display DTOs out, with ids resolved to names for the chips.

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentResult, diskUnchanged, openProject, validate } from "./project.js";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));

describe("project session", () => {
  const result = openProject(exampleDir);

  it("opens the example project clean", () => {
    expect("error" in result).toBe(false);
  });

  if ("error" in result) return;
  const { dto } = result.session;

  it("projects the tree: box, decks, cards with beats", () => {
    expect(dto.name).toBe("Saltmarsh");
    const box = dto.boxes[0]!;
    expect(box.gameId).toBe("encounters");
    expect(box.decks.map((d) => d.gameId)).toEqual(["docks", "market"]);
    const ambush = box.decks[0]!.cards.find((c) => c.gameId === "ambush-at-the-ford")!;
    expect(ambush.title).toBe("Ambush at the ford");
    expect(ambush.purpose).toContain("Pressure beat");
    expect(ambush.condition).toBe("@hand.danger >= 2");
    expect(ambush.redraw).toBe("5");
  });

  it("resolves tag ids to tag names for the chips", () => {
    const ambush = dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "ambush-at-the-ford")!;
    expect(ambush.tags).toEqual([{ group: "area", values: ["docks"] }]);
    expect(ambush.copies).toBe("");   // the default of 1 shows blank
  });

  it("projects outcomes with gates and readable change lines", () => {
    const ambush = dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "ambush-at-the-ford")!;
    const fight = ambush.outcomes.find((o) => o.gameId === "stand-and-fight")!;
    expect(fight.gate).toBe("@story.reputation >= 0");
    expect(fight.changes).toContain("@hand.danger ← @hand.danger - 1");
  });

  it("projects hand templates with binding lines, and hands with their template", () => {
    const box = dto.boxes[0]!;
    const street = box.templates.find((t) => t.gameId === "street-hands")!;
    expect(street.bindings).toEqual(["area = ?"]);   // a hole: the instance chooses
    expect(street.slots).toBe("3");
    expect(street.instances).toBe(1);
    // Chosen by the template, so a place axis on the card's Where row.
    expect(box.tagGroups).toEqual([{ id: "d_zone", gameId: "area", values: ["docks", "market"], placeAxis: true }]);
    expect(box.hands[0]).toMatchObject({ gameId: "docks-street", template: "street-hands", slots: 2 });
  });

  it("reports a directory that is not a project as an error", () => {
    const bad = openProject("/tmp");
    expect("error" in bad).toBe(true);
  });
});

// Focus revalidated from disk and repainted everything, every alt-tab (the
// Storyletter review of 2026-10, item 3). Main now says when nothing changed.
describe("revalidating a project nothing has touched", () => {
  const scratch = () => {
    const dir = join(mkdtempSync(join(tmpdir(), "studio-stamp-")), "copy.storylets");
    cpSync(exampleDir, dir, { recursive: true });
    const opened = openProject(dir);
    if ("error" in opened) throw new Error(opened.error);
    return opened.session;
  };

  it("is unchanged straight after opening", () => {
    expect(diskUnchanged(scratch())).toBe(true);
  });

  it("notices a shard edited behind the app's back, and is unchanged again once re-read", () => {
    const session = scratch();
    const deck = join(session.loaded.dir, "encounters", "decks", "docks.storyletdeck");
    writeFileSync(deck, readFileSync(deck, "utf8").replace("Ambush at the ford", "Ambush by hand"), "utf8");
    expect(diskUnchanged(session)).toBe(false);
    validate(session);
    expect(diskUnchanged(session)).toBe(true);
  });
});

// Find booted on `revalidate`, which now answers null for an untouched project,
// so it opened empty. It reads the project as main holds it instead.
describe("the project as main holds it", () => {
  it("is there for a window that asks, untouched disk or not, and is not re-read", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "studio-current-")), "copy.storylets");
    cpSync(exampleDir, dir, { recursive: true });
    const opened = openProject(dir);
    if ("error" in opened) throw new Error(opened.error);
    const session = opened.session;
    expect(diskUnchanged(session)).toBe(true);
    const current = currentResult(session);
    expect(current.project.name).toBe("Saltmarsh");
    expect(Array.isArray(current.problems)).toBe(true);
    // An edit behind the app's back is revalidate's to pick up, not this one's.
    const deck = join(dir, "encounters", "decks", "docks.storyletdeck");
    writeFileSync(deck, readFileSync(deck, "utf8").replace("Ambush at the ford", "Ambush by hand"), "utf8");
    const again = currentResult(session);
    expect(again.project.boxes[0]!.decks[0]!.cards.some((c) => c.title === "Ambush by hand")).toBe(false);
  });
});
