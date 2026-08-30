// @vitest-environment jsdom
// Camera memory: the keys, the write-through, and the cap.

import { beforeEach, describe, expect, it, vi } from "vitest";

const setCanvasCameras = vi.fn<(c: Record<string, unknown>) => Promise<void>>(async () => {});
(globalThis as unknown as { window: { studio: unknown } }).window = Object.assign(globalThis.window ?? {}, {
  studio: { setCanvasCameras },
});

const memory = await import("./canvas-memory.js");
const { flushCameras, hydrateCameras, mapCameraKey, nodeCameraKey, recallCamera, rememberCamera } = memory;

const cam = (x: number) => ({ x, y: 0, scale: 1 });
/** What the last write-through sent. */
const written = (): Record<string, unknown> =>
  setCanvasCameras.mock.calls[setCanvasCameras.mock.calls.length - 1]![0];

describe("camera keys", () => {
  it("keeps a deck's canvas and a box's map in separate name spaces", () => {
    expect(nodeCameraKey("d_1")).not.toBe(mapCameraKey("d_1", undefined));
  });

  it("keys a map by its GROUP as well as its box: one box can carry several maps", () => {
    expect(mapCameraKey("b_1", "g_town")).not.toBe(mapCameraKey("b_1", "g_castle"));
  });
});

describe("remembering", () => {
  beforeEach(() => { setCanvasCameras.mockClear(); });

  it("hands back what it was told", () => {
    rememberCamera("node:d_9", { x: 12, y: -4, scale: 0.75 });
    expect(recallCamera("node:d_9")).toEqual({ x: 12, y: -4, scale: 0.75 });
    expect(recallCamera("node:never-seen")).toBeUndefined();
  });

  it("writes through on a debounce rather than on every frame", () => {
    for (let i = 0; i < 20; i++) rememberCamera("node:d_pan", cam(i));
    expect(setCanvasCameras).not.toHaveBeenCalled();   // a pan is not twenty disk writes
    flushCameras();
    expect(setCanvasCameras).toHaveBeenCalledTimes(1);
    expect((written()["node:d_pan"] as { x: number }).x).toBe(19);
  });

  it("has nothing to say when nothing has changed", () => {
    flushCameras();
    flushCameras();
    expect(setCanvasCameras).not.toHaveBeenCalled();
  });

  it("keeps the recent ones and sheds the rest", () => {
    for (let i = 0; i < 60; i++) rememberCamera(`node:cap_${i}`, cam(i));
    flushCameras();
    const keys = Object.keys(written()).filter((k) => k.startsWith("node:cap_"));
    expect(keys.length).toBeLessThanOrEqual(40);
    expect(recallCamera("node:cap_59")).toBeDefined();  // the newest survives
    expect(recallCamera("node:cap_0")).toBeUndefined(); // the oldest does not
  });

  it("counts a revisited canvas as recent, so the one you keep using is not shed", () => {
    rememberCamera("node:favourite", cam(1));
    for (let i = 0; i < 39; i++) {
      rememberCamera(`node:other_${i}`, cam(i));
      rememberCamera("node:favourite", cam(i));
    }
    expect(recallCamera("node:favourite")).toBeDefined();
  });
});

describe("hydrating", () => {
  it("takes a saved map, and ignores anything malformed in it", () => {
    hydrateCameras({
      "node:good": { x: 1, y: 2, scale: 0.5 },
      "node:partial": { x: 1, y: 2 } as unknown as { x: number; y: number; scale: number },
      "node:nan": { x: Number.NaN, y: 0, scale: 1 },
    });
    expect(recallCamera("node:good")).toEqual({ x: 1, y: 2, scale: 0.5 });
    // A hand-edited or older state file is read, not trusted: a canvas with a
    // NaN camera draws nothing at all, which would look like a broken view.
    expect(recallCamera("node:partial")).toBeUndefined();
    expect(recallCamera("node:nan")).toBeUndefined();
  });

  it("survives having nothing to hydrate from", () => {
    expect(() => hydrateCameras(undefined)).not.toThrow();
  });
});
