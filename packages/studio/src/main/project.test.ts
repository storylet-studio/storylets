// The project session tested headlessly against the real example project:
// ops in, display DTOs out, with ids resolved to names for the chips.

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { openProject } from "./project.js";

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
    expect(box.tagGroups).toEqual([{ id: "d_zone", gameId: "area", values: ["docks", "market"] }]);
    expect(box.hands[0]).toMatchObject({ gameId: "docks-street", template: "street-hands", slots: 2 });
  });

  it("reports a directory that is not a project as an error", () => {
    const bad = openProject("/tmp");
    expect("error" in bad).toBe(true);
  });
});
