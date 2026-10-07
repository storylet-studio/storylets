// @vitest-environment jsdom
// The pure parts the Board's window split out of table.ts: which maps the view
// shows (board-state.ts), the filter and box counts (box-nav.ts), where a Why
// not? reason leads (why-panel.ts), and what one Escape takes (head.ts).

import { describe, expect, it } from "vitest";
import { mapChoices, spaceList } from "./board-state.js";
import { activeFilters, changedIn, filterGroups, heldIn, matchesFilters } from "./box-nav.js";
import { reasonTarget } from "./why-panel.js";
import { escapeStep } from "./head.js";
import type { ProjectMapDto } from "../../shared/api.js";
import type { HandView } from "./model.js";

const map = (box: string, group: string, space?: number): ProjectMapDto =>
  ({ box: `id-${box}`, boxGameId: box, group: `g-${group}`, groupGameId: group, ...(space !== undefined ? { space } : {}) });

describe("which maps the view shows", () => {
  const maps = [map("town", "district", 0), map("news", "district", 0), map("codex", "shelf", 1), map("town", "rooms")];

  it("finds the shared spaces: a space carried by two or more boxes", () => {
    expect(spaceList(maps).map((list) => list.map((m) => m.boxGameId))).toEqual([["town", "news"]]);
  });

  it("shows a box its own maps, and Everything the first member of each shared space", () => {
    expect(mapChoices(maps, "town").map((m) => m.groupGameId)).toEqual(["district", "rooms"]);
    expect(mapChoices(maps, undefined).map((m) => m.boxGameId)).toEqual(["town"]);
    expect(mapChoices(maps, "nowhere")).toEqual([]);
  });
});

describe("the filters and the box counts", () => {
  const hand = (gameId: string, box: string, tags: Record<string, string> = {}): HandView =>
    ({ id: `id-${gameId}`, gameId, box, boxId: `id-${box}`, tags });
  const hands = [hand("square", "town", { district: "market" }), hand("docks", "town", { district: "docks" }), hand("shelf", "codex")];

  it("unions each tag group's values across the boxes", () => {
    expect(filterGroups([
      { gameId: "town", groups: [{ gameId: "district", values: ["market", "docks"] }] },
      { gameId: "news", groups: [{ gameId: "district", values: ["docks", "harbour"] }, { gameId: "mood", values: ["grim"] }] },
    ])).toEqual([{ gameId: "district", values: ["market", "docks", "harbour"] }, { gameId: "mood", values: ["grim"] }]);
  });

  it("keeps only the filters that choose something, and a hand must match every one", () => {
    const active = activeFilters({ district: "docks", mood: "" });
    expect(active).toEqual([["district", "docks"]]);
    expect(hands.filter((h) => matchesFilters(h.tags, active)).map((h) => h.gameId)).toEqual(["docks"]);
    expect(matchesFilters({}, [])).toBe(true);
  });

  it("counts what a box's hands hold, and how many the last refresh changed", () => {
    const board = [{ hand: "square", cards: [{ id: "a", gameId: "a" }, { id: "b", gameId: "b" }] }, { hand: "shelf", cards: [{ id: "c", gameId: "c" }] }];
    expect(heldIn(hands, board, "town")).toBe(2);
    expect(heldIn(hands, board, "codex")).toBe(1);
    expect(changedIn(hands, new Set(["docks", "shelf"]), "town")).toBe(1);
    expect(changedIn(hands, new Set(), "codex")).toBe(0);
  });
});

describe("where a Why not? reason leads", () => {
  it("opens the When for a failed condition, the deck's for a deck gate, and Dealing for the rest", () => {
    expect(reasonTarget("condition")).toMatchObject({ section: "when", deck: false });
    expect(reasonTarget("deck-gate")).toMatchObject({ section: "when", deck: true });
    expect(reasonTarget("cooldown")).toMatchObject({ section: "dealing", deck: false });
  });

  it("goes nowhere for a card whose tags do not fit, or with no verdict", () => {
    expect(reasonTarget("tags")).toBeUndefined();
    expect(reasonTarget(undefined)).toBeUndefined();
  });
});

describe("what one Escape takes (ruling Q)", () => {
  const quiet = { asking: false, pending: undefined, open: undefined, snapPanel: undefined, selectedHand: undefined };

  it("takes the innermost layer first", () => {
    const open = { card: "c", hand: "h" };
    expect(escapeStep({ ...quiet, pending: "o", open, snapPanel: "save", selectedHand: "h" }, undefined)).toEqual({ take: "pending" });
    expect(escapeStep({ ...quiet, open, snapPanel: "save", selectedHand: "h" }, undefined)).toEqual({ take: "open" });
    expect(escapeStep({ ...quiet, snapPanel: "restore", selectedHand: "h" }, undefined)).toEqual({ take: "snapshots" });
    expect(escapeStep({ ...quiet, selectedHand: "h" }, undefined)).toEqual({ take: "hand" });
  });

  it("answers from what the key went down on: a hand the map has already dropped still counts", () => {
    expect(escapeStep(quiet, { hand: "h", zoneGroup: "district" })).toEqual({ take: "hand" });
    expect(escapeStep(quiet, { hand: undefined, zoneGroup: "district" })).toEqual({ take: "zone", group: "district" });
  });

  it("closes only when nothing smaller is left, and leaves a dialog its own Escape", () => {
    expect(escapeStep(quiet, { hand: undefined, zoneGroup: undefined })).toEqual({ take: "close" });
    expect(escapeStep({ ...quiet, asking: true, pending: "o" }, undefined)).toEqual({ take: "dialog" });
  });
});
