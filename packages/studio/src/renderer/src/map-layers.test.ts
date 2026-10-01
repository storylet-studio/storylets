import { describe, expect, it } from "vitest";
import {
  MAP_LAYER_PICTURES, MAP_LAYER_ZONES, activeBox, hideAll, isShown, moveLayer, orderedBoxes, setActive,
  showAll, showLayer, soloLayer, toggleLayer,
} from "./map-layers.js";

const boxes = ["village", "news", "talk"];

describe("the project map's layers", () => {
  it("orders boxes by the person's order, then the rest in project order", () => {
    expect(orderedBoxes({}, boxes)).toEqual(boxes);
    expect(orderedBoxes({ order: ["talk", "gone"] }, boxes)).toEqual(["talk", "village", "news"]);
  });

  it("keeps the active layer while it is on the map, else takes the top one", () => {
    expect(activeBox({}, boxes)).toBe("village");
    expect(activeBox({ active: "news" }, boxes)).toBe("news");
    expect(activeBox({ active: "gone", order: ["talk"] }, boxes)).toBe("talk");
    expect(activeBox({}, [])).toBeUndefined();
    expect(setActive({}, "news").active).toBe("news");
  });

  it("toggles one layer", () => {
    const hidden = toggleLayer({}, "news");
    expect(isShown(hidden, "news")).toBe(false);
    expect(toggleLayer(hidden, "news")).toEqual({});
  });

  it("hides every box layer, but never Zones or Pictures", () => {
    const all = hideAll({}, boxes);
    for (const b of boxes) expect(isShown(all, b)).toBe(false);
    expect(isShown(all, MAP_LAYER_ZONES)).toBe(true);
    expect(isShown(all, MAP_LAYER_PICTURES)).toBe(true);
    // Show all shows everything, Zones included.
    expect(showAll({ hidden: [...boxes, MAP_LAYER_ZONES] })).toEqual({});
  });

  it("solos a layer with Zones still up, and the second Option-click restores", () => {
    const start = { hidden: [MAP_LAYER_PICTURES] };
    const solo = soloLayer(start, "news", boxes);
    expect(isShown(solo, "news")).toBe(true);
    expect(isShown(solo, "village")).toBe(false);
    expect(isShown(solo, "talk")).toBe(false);
    expect(isShown(solo, MAP_LAYER_ZONES)).toBe(true);
    expect(isShown(solo, MAP_LAYER_PICTURES)).toBe(false);
    expect(soloLayer(solo, "news", boxes)).toEqual(start);
  });

  it("restores to before ANY soloing when a second layer is soloed first", () => {
    const start = {};
    const twice = soloLayer(soloLayer(start, "news", boxes), "talk", boxes);
    expect(isShown(twice, "talk")).toBe(true);
    expect(isShown(twice, "news")).toBe(false);
    expect(soloLayer(twice, "talk", boxes)).toEqual(start);
  });

  it("forgets the solo on any other change, so a stale restore cannot undo work", () => {
    const solo = soloLayer({}, "news", boxes);
    expect(toggleLayer(solo, "village").solo).toBeUndefined();
    expect(showAll(solo).solo).toBeUndefined();
    expect(hideAll(solo, boxes).solo).toBeUndefined();
  });

  it("moves a box layer before or after another", () => {
    expect(moveLayer({}, boxes, "talk", "village", true).order).toEqual(["talk", "village", "news"]);
    expect(moveLayer({}, boxes, "village", "news", false).order).toEqual(["news", "village", "talk"]);
  });

  it("shows one hidden layer for a new site, leaving the rest hidden", () => {
    const hidden = hideAll({}, boxes);
    const shown = showLayer(hidden, "news");
    expect(isShown(shown, "news")).toBe(true);
    expect(isShown(shown, "village")).toBe(false);
    expect(showLayer({}, "news")).toEqual({});
  });
});
