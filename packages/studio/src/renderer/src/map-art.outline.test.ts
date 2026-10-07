// A zone item's outline back in world coordinates (map-art `worldOutline`),
// which is what a dropped or reshaped zone writes: it has to be the polygon it
// came from, and after a drag the polygon moved by exactly the drag.

import { describe, expect, it } from "vitest";
import { worldOutline, zoneShape } from "./map-art.js";

const polygon = [{ x: 100, y: 40 }, { x: 220, y: 40 }, { x: 220, y: 160 }, { x: 140, y: 160 }];

describe("a zone's outline in the world", () => {
  it("is the polygon the item was made from", () => {
    expect(worldOutline(zoneShape({ id: "z_1", title: "docks", name: "docks", polygon }))).toEqual(polygon);
  });

  it("moves with the item", () => {
    const zone = zoneShape({ id: "z_1", title: "docks", name: "docks", polygon });
    zone.x += 30;
    zone.y -= 10;
    expect(worldOutline(zone)).toEqual(polygon.map((p) => ({ x: p.x + 30, y: p.y - 10 })));
  });
});
