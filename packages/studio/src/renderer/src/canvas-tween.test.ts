// The camera's eased move, driven frame by frame on a clock of the test's own
// (canvas-tween.ts): it reads the theme's motion, arrives exactly where it was
// sent, and a move that is stopped takes no further step.

import { describe, expect, it } from "vitest";
import { CAMERA_MS, cameraMotion, startCameraTween, type FrameClock } from "./canvas-tween.js";

/** A clock whose frames run only when the test says so. */
function manualClock(): FrameClock & { frame: (at: number) => void; pending: () => number } {
  let next = 1;
  const queue = new Map<number, (now: number) => void>();
  return {
    request: (step) => { const id = next++; queue.set(id, step); return id; },
    cancel: (id) => { queue.delete(id); },
    now: () => 0,
    frame: (at) => {
      const due = [...queue.values()];
      queue.clear();
      for (const step of due) step(at);
    },
    pending: () => queue.size,
  };
}

const view = { width: 800, height: 600 };
const from = { x: 0, y: 0, scale: 1 };
const to = { x: -400, y: -300, scale: 2 };
const linear = { ms: 100, curve: (t: number) => t };

describe("the theme's motion", () => {
  it("reads the panel duration and the standard curve", () => {
    const tokens: Record<string, string> = { "--dur-panel": "0.3s", "--ease-standard": "cubic-bezier(0, 0, 1, 1)" };
    const motion = cameraMotion((name) => tokens[name] ?? "");
    expect(motion.ms).toBe(300);
    expect(motion.curve(0.25)).toBeCloseTo(0.25, 3);
  });

  it("falls back to app-shell's own when the tokens cannot be read", () => {
    const motion = cameraMotion(() => "");
    expect(motion.ms).toBe(CAMERA_MS);
    expect(motion.curve(0)).toBe(0);
    expect(motion.curve(1)).toBe(1);
  });
});

describe("an eased move", () => {
  it("takes no step until a frame arrives", () => {
    const clock = manualClock();
    const steps: unknown[] = [];
    const move = startCameraTween(from, to, linear, view, (at) => steps.push(at), clock);
    expect(steps).toEqual([]);
    expect(move.to).toBe(to);
    expect(clock.pending()).toBe(1);
  });

  it("steps once a frame and arrives exactly where it was sent", () => {
    const clock = manualClock();
    const steps: { scale: number; done: boolean }[] = [];
    startCameraTween(from, to, linear, view, (at, done) => steps.push({ scale: at.scale, done }), clock);
    clock.frame(50);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.done).toBe(false);
    expect(steps[0]!.scale).toBeGreaterThan(1);
    expect(steps[0]!.scale).toBeLessThan(2);
    clock.frame(100);
    expect(steps).toHaveLength(2);
    expect(steps[1]).toEqual({ scale: 2, done: true });
    // Arrived: nothing more is asked for.
    expect(clock.pending()).toBe(0);
  });

  it("hands over the destination itself on the last step, not an approximation", () => {
    const clock = manualClock();
    let last: unknown;
    startCameraTween(from, to, linear, view, (at) => { last = at; }, clock);
    clock.frame(500);
    expect(last).toBe(to);
  });

  it("stops: no step after stop, and nothing left waiting", () => {
    const clock = manualClock();
    let steps = 0;
    const move = startCameraTween(from, to, linear, view, () => { steps++; }, clock);
    clock.frame(10);
    move.stop();
    clock.frame(20);
    expect(steps).toBe(1);
    expect(clock.pending()).toBe(0);
  });

  it("ends when a step stops it, as starting another move does", () => {
    const clock = manualClock();
    let steps = 0;
    const move = startCameraTween(from, to, linear, view, () => { steps++; move.stop(); }, clock);
    clock.frame(10);
    clock.frame(20);
    expect(steps).toBe(1);
    expect(clock.pending()).toBe(0);
  });
});
