// @vitest-environment jsdom
// The canvas navigation cluster: what it offers, and when it stops offering it.
// Its whole job is to make invisible gestures reachable, so what is actually
// worth testing is that a control never sits there enabled and doing nothing.

import { describe, expect, it, vi } from "vitest";
import { mountCanvasControls, zoomLabel } from "./canvas-controls.js";

const state = (over: Partial<Parameters<ReturnType<typeof mountCanvasControls>["update"]>[0]> = {}) => ({
  scale: 1, hasItems: true, hasSelection: false, min: 0.1, max: 3, ...over,
});

const buttons = (host: HTMLElement): HTMLButtonElement[] =>
  [...host.querySelectorAll<HTMLButtonElement>(".canvasbtn")];

describe("zoomLabel", () => {
  it("reads as whole percent", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(0.5)).toBe("50%");
    // No decimals: a readout that flickers through 112.4% while you pinch is noise.
    expect(zoomLabel(1.1237)).toBe("112%");
  });
});

describe("the cluster", () => {
  it("offers fit, fit-selection and zoom, each with a rollover naming its key", () => {
    const host = document.createElement("div");
    mountCanvasControls(host, {
      fitAll: vi.fn(), fitSelection: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), actualSize: vi.fn(),
    });
    const tips = buttons(host).map((b) => b.dataset["tip"]);
    expect(tips).toEqual([
      "Fit everything (Home)", "Fit the selection (F)", "Zoom out (⌘−)", "Back to 100% (⌘0)", "Zoom in (⌘+)",
    ]);
    // The rollover is the accessible name too: four of the five have no text.
    expect(buttons(host).every((b) => (b.getAttribute("aria-label") ?? "") !== "")).toBe(true);
  });

  it("runs the action it names", () => {
    const host = document.createElement("div");
    const actions = {
      fitAll: vi.fn(), fitSelection: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), actualSize: vi.fn(),
    };
    const controls = mountCanvasControls(host, actions);
    controls.update(state({ hasSelection: true }));
    for (const b of buttons(host)) b.click();
    expect(actions.fitAll).toHaveBeenCalled();
    expect(actions.fitSelection).toHaveBeenCalled();
    expect(actions.zoomIn).toHaveBeenCalled();
    expect(actions.zoomOut).toHaveBeenCalled();
    expect(actions.actualSize).toHaveBeenCalled();
  });

  it("greys fit-the-selection with nothing selected, and offers it once there is", () => {
    const host = document.createElement("div");
    const controls = mountCanvasControls(host, {
      fitAll: vi.fn(), fitSelection: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), actualSize: vi.fn(),
    });
    controls.update(state());
    expect(buttons(host)[1]!.disabled).toBe(true);
    controls.update(state({ hasSelection: true }));
    expect(buttons(host)[1]!.disabled).toBe(false);
  });

  it("stops offering a zoom that has run out of room", () => {
    const host = document.createElement("div");
    const controls = mountCanvasControls(host, {
      fitAll: vi.fn(), fitSelection: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), actualSize: vi.fn(),
    });
    const [, , out, readout, inn] = buttons(host);
    controls.update(state({ scale: 3 }));
    expect(inn!.disabled).toBe(true);
    expect(out!.disabled).toBe(false);
    expect(readout!.textContent).toBe("300%");
    controls.update(state({ scale: 0.1 }));
    expect(out!.disabled).toBe(true);
    expect(inn!.disabled).toBe(false);
  });

  it("greys everything on an empty canvas, except the zoom, which still means something", () => {
    const host = document.createElement("div");
    const controls = mountCanvasControls(host, {
      fitAll: vi.fn(), fitSelection: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), actualSize: vi.fn(),
    });
    controls.update(state({ hasItems: false }));
    const [all, sel, out, readout, inn] = buttons(host);
    expect([all!.disabled, sel!.disabled, readout!.disabled]).toEqual([true, true, true]);
    expect([out!.disabled, inn!.disabled]).toEqual([false, false]);
  });

  it("takes itself away with the canvas", () => {
    const host = document.createElement("div");
    const controls = mountCanvasControls(host, {
      fitAll: vi.fn(), fitSelection: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), actualSize: vi.fn(),
    });
    expect(host.querySelector(".canvasctl")).not.toBeNull();
    controls.destroy();
    expect(host.querySelector(".canvasctl")).toBeNull();
  });
});
