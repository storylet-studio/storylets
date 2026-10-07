// @vitest-environment jsdom
// The Board's map as a selection: one call per click, so the Board renders once
// for it; a site click leaves the zone filter alone; the Board's own redraw is
// never reported back as a click (it used to clear the zone it had just
// filtered to); and another map is framed whole. The canvas is a stand-in that
// records what the map asks of it: Konva itself is not under test.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoxMapDto } from "../../shared/api.js";

/** The stand-in surface: a selection that reports changes the way the real one
 *  does (only when it changes), and a count of fits. */
const surface = {
  opts: undefined as undefined | { onSelectionChange?: (ids: string[]) => void },
  selected: [] as string[],
  fits: 0,
};
vi.mock("konva", () => ({ default: {} }));
vi.mock("../src/canvas-tokens.js", () => ({
  readCanvasTokens: () => ({}),
  readableOn: () => "#000",
  watchCanvasTokens: () => () => undefined,
}));
vi.mock("../src/image-cache.js", () => ({ onImageReady: () => () => undefined, retryFailedImages: () => undefined }));
vi.mock("../src/canvas-surface.js", () => ({
  mountCanvasSurface: (opts: { onSelectionChange?: (ids: string[]) => void }) => {
    surface.opts = opts;
    const select = (ids: string[]): void => {
      const same = ids.length === surface.selected.length && ids.every((id) => surface.selected.includes(id));
      surface.selected = [...ids];
      if (!same) opts.onSelectionChange?.([...ids]);
    };
    return {
      setItems: () => undefined, setForeground: () => undefined, setTokens: () => undefined,
      select, selection: () => [...surface.selected],
      fitAll: () => { surface.fits++; }, destroy: () => undefined,
    };
  },
}));

const { mountBoardMap } = await import("./board-map.js");

const MAP: BoxMapDto = {
  hasProject: true, groups: [{ id: "g_area", gameId: "area" }], groupId: "g_area",
  zones: [{ id: "z_docks", gameId: "docks", polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }],
  undrawn: [], backgrounds: [],
  sites: [{ id: "h_inn", gameId: "the-inn", x: 50, y: 50, zone: "z_docks" }],
  unplaced: [], furniture: { frames: [], notes: [], labels: [], arrows: [], images: [] },
} as unknown as BoxMapDto;

const marks = (filtered?: string) => ({
  visited: () => false, held: () => 0, changed: () => false, changedStamp: 0,
  ...(filtered !== undefined ? { filtered } : {}),
});
/** A click on the surface: it selects, and the surface says so. */
const click = (ids: string[]): void => {
  surface.selected = [...ids];
  surface.opts!.onSelectionChange!([...ids]);
};

beforeEach(() => { surface.opts = undefined; surface.selected = []; surface.fits = 0; });

describe("the Board's map", () => {
  it("reports a zone click once, as the hand cleared and the filter set", () => {
    const pick = vi.fn();
    const map = mountBoardMap(document.createElement("div"), MAP, undefined, marks(), { pick, reveal: vi.fn() });
    click(["z_docks"]);
    expect(pick.mock.calls).toEqual([[undefined, { id: "z_docks" }]]);
    // The Board redraws with the filter on: the zone stays selected, and nothing
    // comes back as a click.
    map.update(MAP, undefined, marks("z_docks"));
    expect(surface.selected).toEqual(["z_docks"]);
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it("leaves the filter alone on a site click", () => {
    const pick = vi.fn();
    mountBoardMap(document.createElement("div"), MAP, undefined, marks("z_docks"), { pick, reveal: vi.fn() });
    click(["h_inn"]);
    expect(pick.mock.calls).toEqual([["the-inn"]]);
  });

  it("clears the filter when a click takes the selection off a zone, and only then", () => {
    const pick = vi.fn();
    mountBoardMap(document.createElement("div"), MAP, undefined, marks(), { pick, reveal: vi.fn() });
    click(["z_docks"]);
    click([]);
    expect(pick.mock.calls[1]).toEqual([undefined, { id: undefined }]);
    click(["h_inn"]);
    click([]);
    expect(pick.mock.calls[3]).toEqual([undefined]);
  });

  it("shows a filter set from the dropdown as the zone selected, without a click", () => {
    const pick = vi.fn();
    const map = mountBoardMap(document.createElement("div"), MAP, undefined, marks(), { pick, reveal: vi.fn() });
    map.update(MAP, undefined, marks("z_docks"));
    expect(surface.selected).toEqual(["z_docks"]);
    map.update(MAP, "the-inn", marks("z_docks"));
    expect(surface.selected).toEqual(["h_inn"]);
    expect(pick).not.toHaveBeenCalled();
  });

  it("frames the whole map when asked, beyond the first fit", () => {
    const map = mountBoardMap(document.createElement("div"), MAP, undefined, marks(), { pick: vi.fn(), reveal: vi.fn() });
    expect(surface.fits).toBe(1);
    map.update(MAP, undefined, marks());
    expect(surface.fits).toBe(1);   // a redraw keeps the camera
    map.fit();
    expect(surface.fits).toBe(2);
  });
});
