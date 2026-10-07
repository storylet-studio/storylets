// The project map's menus (map-menus.ts), as the items they offer: a restack
// entry only where it would move something, and a picture's menu that says
// what it is and steps the fade round.

import { describe, expect, it, vi } from "vitest";
import { FADE_STEPS, nextFade, pictureMenuItems, restackItems } from "./map-menus.js";
import type { MapBackgroundDto } from "../../shared/api.js";

const labels = (items: { label: string }[]): string[] => items.map((i) => i.label);

describe("restacking", () => {
  const order = ["back", "middle", "front"];

  it("offers all four in the middle of the stack", () => {
    expect(labels(restackItems(order, "middle", () => undefined)))
      .toEqual(["Bring to front", "Bring forward", "Send backward", "Send to back"]);
  });

  it("offers only what would move something at either end", () => {
    expect(labels(restackItems(order, "front", () => undefined))).toEqual(["Send backward", "Send to back"]);
    expect(labels(restackItems(order, "back", () => undefined))).toEqual(["Bring to front", "Bring forward"]);
    expect(restackItems(["only"], "only", () => undefined)).toEqual([]);
  });

  it("says which way it went", () => {
    const move = vi.fn();
    restackItems(order, "middle", move)[1]!.onClick();
    expect(move).toHaveBeenCalledWith("forward");
  });
});

describe("fading", () => {
  it("steps down from full and comes back round", () => {
    expect(nextFade(undefined)).toBe(0.6);
    expect(nextFade(1)).toBe(0.6);
    expect(nextFade(0.6)).toBe(0.35);
    expect(nextFade(0.35)).toBe(0.15);
    expect(nextFade(0.15)).toBe(1);
    expect(FADE_STEPS[0]).toBe(1);
  });

  it("treats a value near a step as that step, and starts again from full off them", () => {
    expect(nextFade(0.61)).toBe(0.35);
    expect(nextFade(0.5)).toBe(1);
  });
});

describe("a picture's menu", () => {
  const picture = (over: Partial<MapBackgroundDto> = {}): MapBackgroundDto =>
    ({ id: "p_1", file: "plan.png", url: "asset://plan.png", x: 0, y: 0, width: 100, height: 100, ...over }) as MapBackgroundDto;
  const actions = () => ({ editBackground: vi.fn(), restackBackground: vi.fn(), removeBackground: vi.fn() });

  it("offers lock, hide and fade by what the picture is now", () => {
    expect(labels(pictureMenuItems(picture(), ["p_1"], actions())))
      .toEqual(["Lock in place", "Hide", "Fade (100%)", "Remove from the map"]);
    expect(labels(pictureMenuItems(picture({ locked: true, hidden: true, opacity: 0.35 }), ["p_1"], actions())))
      .toEqual(["Unlock", "Show", "Fade (35%)", "Remove from the map"]);
  });

  it("restacks among the other pictures", () => {
    expect(labels(pictureMenuItems(picture(), ["p_1", "p_2"], actions())))
      .toEqual(["Lock in place", "Hide", "Fade (100%)", "Bring to front", "Bring forward", "Remove from the map"]);
  });

  it("fades to the next step", () => {
    const a = actions();
    pictureMenuItems(picture({ opacity: 0.6 }), ["p_1"], a)[2]!.onClick();
    expect(a.editBackground).toHaveBeenCalledWith("p_1", { opacity: 0.35 });
  });
});
