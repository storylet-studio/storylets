// ---------------------------------------------------------------------------
// Where each canvas was looking, remembered.
//
// A camera is UI memory: it belongs to the person, not to the project, so it
// lives in the user's state beside the pane widths and the last page, and never
// in a shard. Two authors sharing a repo do not share a viewpoint, and a
// viewpoint in a shard would be a merge conflict over nothing.
//
// Both canvases in the editor window kept a Map of their own, which survived a
// re-render but not a relaunch: the app now reopens on the page you left
// (structure rule 13), and reopening the map you were reading zoomed out to the
// whole island rather defeats it. So the same store, one key space, written
// through to disk.
//
// The write is DEBOUNCED because the source is a camera: onCamera fires on every
// frame of a pan, and a settings file rewritten sixty times a second would be a
// remarkable way to spend a disk.
// ---------------------------------------------------------------------------

import type { Camera } from "./canvas-surface.js";

const studio = window.studio;

/** Everything we have been told, this session and last. */
const cameras = new Map<string, Camera>();

/** How many canvases are worth remembering. Old entries drop off the front: a
 *  project with three hundred decks should not carry three hundred cameras
 *  around, and nobody returns to the four hundredth-most-recent one. */
const KEEP = 40;
const WRITE_DELAY = 400;

let timer: number | undefined;
let dirty = false;

/** The key for a deck's node canvas / a box's map. Prefixed by view, because a
 *  box's map and a deck of the same id are different places to be looking. */
export const nodeCameraKey = (deckId: string): string => `node:${deckId}`;
export const mapCameraKey = (boxId: string, groupId: string | undefined): string =>
  `map:${boxId}:${groupId ?? ""}`;

/** Seed from the user's saved state, once, at boot. */
export function hydrateCameras(saved: Record<string, Camera> | undefined): void {
  if (!saved) return;
  for (const [key, camera] of Object.entries(saved)) {
    if (isCamera(camera)) cameras.set(key, camera);
  }
}

/** Where this canvas was, or undefined for one we have never seen. */
export function recallCamera(key: string): Camera | undefined {
  return cameras.get(key);
}

/** Remember where a canvas is looking. Cheap to call on every frame. */
export function rememberCamera(key: string, camera: Camera): void {
  // Re-inserted rather than updated in place, so the most recently used key is
  // the youngest and the cap sheds the ones nobody has looked at.
  cameras.delete(key);
  cameras.set(key, camera);
  while (cameras.size > KEEP) {
    const oldest = cameras.keys().next();
    if (oldest.done) break;
    cameras.delete(oldest.value);
  }
  dirty = true;
  if (timer !== undefined) return;
  timer = window.setTimeout(flushCameras, WRITE_DELAY);
}

/** Write now rather than in a moment: for the app going away. */
export function flushCameras(): void {
  if (timer !== undefined) { window.clearTimeout(timer); timer = undefined; }
  if (!dirty) return;
  dirty = false;
  void studio.setCanvasCameras(Object.fromEntries(cameras));
}

// A relaunch is the case this exists for, so the last pan before quitting has to
// land. `pagehide` fires on the window going away, which the debounce might not
// have beaten.
window.addEventListener("pagehide", flushCameras);

/** Read back from a file an older or newer version may have written. */
function isCamera(v: unknown): v is Camera {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return ["x", "y", "scale"].every((k) => typeof c[k] === "number" && Number.isFinite(c[k] as number));
}
