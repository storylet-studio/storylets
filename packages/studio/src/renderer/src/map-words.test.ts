// What the project map says (map-words.ts), pinned without a canvas. The
// sentences an author reads while deciding whether to drag a pin: whether the
// drag moves the hand, moves nothing, or only marks a spot, and the rollover
// that names a shape the zoom has made anonymous.

import { describe, expect, it } from "vitest";
import { describeSite, editHint, fixedDropLine, layerName, listNames, mapHoverTip, tracingHint } from "./map-words.js";
import { siteShape, zoneShape } from "./map-art.js";
import { frameShape } from "./furniture-art.js";
import type { MapItem } from "./map-view.js";

const zones: Record<string, string> = { z_docks: "docks", z_market: "market" };
const zoneName = (id: string): string | undefined => zones[id];

const site = (over: Partial<Extract<MapItem, { kind: "site" }>> = {}): Extract<MapItem, { kind: "site" }> => ({
  kind: "site", box: "b_town",
  ...siteShape({ id: "h_inn", title: "The Inn", name: "the-inn", at: { x: 0, y: 0 }, zone: "z_docks", zoneName: "docks" }),
  ...over,
});

describe("names", () => {
  it("reads a box by its title, else its gameId", () => {
    expect(layerName({ title: "Town", gameId: "town" })).toBe("Town");
    expect(layerName({ gameId: "town" })).toBe("town");
  });

  it("lists names as an author writes them", () => {
    expect(listNames([])).toBe("");
    expect(listNames(["docks"])).toBe("docks");
    expect(listNames(["docks", "market"])).toBe("docks and market");
    expect(listNames(["docks", "market", "square"])).toBe("docks, market and square");
  });
});

describe("what a selected pin says", () => {
  it("says a drag moves the hand when it can", () => {
    expect(describeSite(site(), { rebinds: true }, zoneName))
      .toBe("The Inn is in docks. Drag it to another to move the hand.");
  });

  it("says a drag binds an unbound hand", () => {
    expect(describeSite(site({ zone: undefined }), { rebinds: true }, zoneName))
      .toBe("The Inn is in no zone yet. Drag it into one to bind it.");
  });

  it("names the template that fixes the hand", () => {
    expect(describeSite(site(), { rebinds: false, fixedBy: "Stall" }, zoneName))
      .toBe('The Inn is in docks, fixed by the template "Stall" for every hand it makes.');
  });

  it("says a pin of a hand with no route to the zones only marks a spot", () => {
    expect(describeSite(site(), { rebinds: false }, zoneName))
      .toBe("The Inn doesn't use the map's zones, so its pin only marks a spot.");
  });

  it("adds the outlines that do not count", () => {
    expect(describeSite(site({ alsoInside: ["market"] }), { rebinds: true }, zoneName))
      .toBe("The Inn is in docks. Drag it to another to move the hand. Also inside market, which does not count.");
  });

  it("puts a stray pin first, offering another zone only when the drag can rebind", () => {
    expect(describeSite(site({ strayFrom: "docks" }), { rebinds: true }, zoneName))
      .toBe('"The Inn" is dealt in docks, but its pin stands outside it. Drag it back into docks, or into another zone to move the hand.');
    expect(describeSite(site({ strayFrom: "docks" }), { rebinds: false, fixedBy: "Stall" }, zoneName))
      .toBe('"The Inn" is dealt in docks, but its pin stands outside it. Drag it back into docks.');
  });

  it("says why a drop of a fixed hand moved nothing", () => {
    expect(fixedDropLine("The Inn", "Stall"))
      .toBe('"The Inn" stays in the zone its template "Stall" gives every hand it makes, so moving its pin moves nothing.');
  });
});

describe("the strip while tracing or placing", () => {
  it("walks the author through a trace", () => {
    expect(tracingHint("New zone", true, 0)).toBe("Click to place the first corner of New zone");
    expect(tracingHint("New zone", true, 1)).toBe("New zone: 1 corner so far");
    expect(tracingHint("New zone", true, 2)).toBe("New zone: 2 corners so far");
    expect(tracingHint("New zone", true, 3)).toBe("Click the first corner of New zone again, or press Enter, to close it");
  });

  it("says where a placement goes", () => {
    expect(tracingHint("The Inn", false, 0)).toBe("Click where The Inn sits");
  });
});

describe("the editing strip's line", () => {
  const pinLine = (): string => "the pin's own line";

  it("speaks for nothing, or for several", () => {
    expect(editHint(undefined, 0, undefined, pinLine)).toBe("Zones are the project's. Hands go to the active layer.");
    expect(editHint(undefined, 3, undefined, pinLine)).toBe("3 selected");
  });

  it("names a zone's picked corner, counting from one", () => {
    const zone: MapItem = { kind: "zone", ...zoneShape({ id: "z_docks", title: "docks", name: "docks", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] }) };
    expect(editHint(zone, 1, 0, pinLine)).toBe("Corner 1 of docks is picked. Delete removes it.");
    expect(editHint(zone, 1, undefined, pinLine)).toBe("docks is a zone. Drag a corner to reshape it, or a mid-point to add one.");
  });

  it("calls an untitled frame a frame, and hands a pin to its own line", () => {
    const frame = frameShape({ id: "r_1", x: 0, y: 0, w: 100, h: 100 });
    expect(editHint(frame, 1, undefined, pinLine)).toBe("Frame is a frame. Drag its bar to move it, or double-click to rename it.");
    expect(editHint(site(), 1, undefined, pinLine)).toBe("the pin's own line");
  });
});

describe("the rollover", () => {
  const ctx = { zoneName, boxName: (box: string) => (box === "b_town" ? "Town" : undefined), manyBoxes: true };

  it("names a pin and its box below the label floor, and only the box above it", () => {
    expect(mapHoverTip(site(), 0.2, ctx)).toBe("The Inn, Town");
    expect(mapHoverTip(site(), 1, ctx)).toBe("The Inn, Town");
    expect(mapHoverTip(site(), 1, { ...ctx, manyBoxes: false })).toBeUndefined();
  });

  it("warns about a stray pin at any zoom", () => {
    expect(mapHoverTip(site({ strayFrom: "docks" }), 1, ctx)).toBe("The Inn is dealt in docks, but its pin stands outside it.");
  });

  it("explains nested outlines", () => {
    expect(mapHoverTip(site({ alsoInside: ["market"] }), 1, ctx))
      .toBe("The Inn belongs to docks. It also sits inside market, which counts for nothing. Zones are tags, so they don't nest, and a hand belongs to the frontmost zone around it.");
    expect(mapHoverTip(site({ zone: undefined, alsoInside: ["market"] }), 1, ctx))
      .toBe("The Inn sits inside market. Zones don't nest, so dropping it binds to the frontmost one only.");
  });

  it("names a frame below its own floor, and a zone below the label floor", () => {
    const frame = frameShape({ id: "r_1", x: 0, y: 0, w: 100, h: 100, title: "Act two" });
    expect(mapHoverTip(frame, 0.5, ctx)).toBe("Act two");
    expect(mapHoverTip(frame, 1, ctx)).toBeUndefined();
    const zone: MapItem = { kind: "zone", ...zoneShape({ id: "z_docks", title: "docks", name: "docks", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] }) };
    expect(mapHoverTip(zone, 0.2, ctx)).toBe("docks");
    expect(mapHoverTip(zone, 1, ctx)).toBeUndefined();
  });
});
