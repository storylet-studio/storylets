// ---------------------------------------------------------------------------
// The canvas camera's eased moves: how long one takes, on what curve, and the
// frame loop that drives it. The arithmetic of each frame is canvas-geometry's
// `tweenCamera`; this is the clock around it.
//
// A command that moves the camera (fit, fit the selection, centre on, reveal,
// back to 100%) EASES there, as the design language asks of any movement the
// author did not make with their own hand: a jump loses the thread of where you
// were. The surface decides WHETHER to ease; this only runs one.
//
// The clock is a parameter so the loop can be driven frame by frame in a test.
// ---------------------------------------------------------------------------

import { cubicBezier, parseCubicBezier, parseDuration, tweenCamera, type Camera } from "./canvas-geometry.js";

/** How long a camera move takes and on what curve. */
export interface CameraMotion { ms: number; curve: (t: number) => number }

/** A camera move's length and curve when the theme's tokens cannot be read:
 *  app-shell's `--dur-panel` and `--ease-standard`, which they normally are. */
export const CAMERA_MS = 260;
const CAMERA_EASE = cubicBezier(0.2, 0, 0, 1);

/** The theme's own motion, read through `token` (a custom property's value),
 *  falling back to app-shell's defaults for anything it cannot read. */
export function cameraMotion(token: (name: string) => string): CameraMotion {
  return {
    ms: parseDuration(token("--dur-panel"), CAMERA_MS),
    curve: parseCubicBezier(token("--ease-standard")) ?? CAMERA_EASE,
  };
}

/** The frames a tween runs on: the browser's, unless a test supplies its own. */
export interface FrameClock {
  request: (step: (now: number) => void) => number;
  cancel: (frame: number) => void;
  now: () => number;
}

const browserClock: FrameClock = {
  request: (step) => requestAnimationFrame(step),
  cancel: (frame) => cancelAnimationFrame(frame),
  now: () => performance.now(),
};

/** A move in flight. */
export interface CameraTween {
  /** Where it is going, for anything that wants the camera's destination. */
  readonly to: Camera;
  /** Stop where it is. No further step is taken. */
  stop: () => void;
}

/**
 * Ease the camera from `from` to `to`: `step` is called once a frame with the
 * camera for that frame, and for the last time with `to` exactly and `done`
 * true. Nothing is called synchronously, so the caller can hold on to the
 * returned handle before the first step arrives. A step that stops the tween
 * (by starting another move, say) ends it there.
 */
export function startCameraTween(
  from: Camera, to: Camera, motion: CameraMotion, view: { width: number; height: number },
  step: (at: Camera, done: boolean) => void, clock: FrameClock = browserClock,
): CameraTween {
  const start = clock.now();
  let stopped = false;
  const tick = (now: number): void => {
    const t = Math.min(1, (now - start) / motion.ms);
    const done = t >= 1;
    step(done ? to : tweenCamera(from, to, motion.curve(t), view), done);
    if (done || stopped) return;
    frame = clock.request(tick);
  };
  let frame = clock.request(tick);
  return {
    to,
    stop: () => { stopped = true; clock.cancel(frame); },
  };
}
