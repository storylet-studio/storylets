// ---------------------------------------------------------------------------
// The project map's menus that are more than a line or two: a picture's, and
// the drawing-app restack entries a zone and a picture share.
//
// Built as ITEMS, so what each menu offers (and, as much, what it leaves out)
// can be pinned without opening one. The map opens them with the shell's
// context menu, from a right-click on the canvas or from a picture's row in
// the side panel, which is the only handle a LOCKED picture has.
// ---------------------------------------------------------------------------

import { openContextMenu, type ContextItem } from "@wildwinter/app-shell/context-menu";
import type { MapBackgroundDto } from "../../shared/api.js";

export type Restack = "front" | "forward" | "backward" | "back";

/**
 * Drawing-app layering, in a drawing app's words, offered only where it would
 * do something: the same four entries for a zone and a picture, which each
 * built them for themselves. `order` is back to front.
 */
export function restackItems(order: readonly string[], id: string, move: (to: Restack) => void): ContextItem[] {
  const at = order.indexOf(id);
  const canRaise = at >= 0 && at < order.length - 1;
  const canLower = at > 0;
  return [
    ...(canRaise ? [
      { label: "Bring to front", onClick: () => move("front") },
      { label: "Bring forward", onClick: () => move("forward") },
    ] : []),
    ...(canLower ? [
      { label: "Send backward", onClick: () => move("backward") },
      { label: "Send to back", onClick: () => move("back") },
    ] : []),
  ];
}

/** Fading is what makes a tracing base usable: full, then three steps down,
 *  then back to full. */
export const FADE_STEPS: readonly number[] = [1, 0.6, 0.35, 0.15];
/** How near a stored opacity has to be to a step to count as that step: a
 *  value written by hand, or rounded on the way through a shard, is still it. */
const FADE_MATCH = 0.02;

/** The opacity the next press of "Fade" gives. Off the steps, it starts again
 *  from full. */
export function nextFade(opacity: number | undefined): number {
  const now = FADE_STEPS.findIndex((v) => Math.abs(v - (opacity ?? 1)) < FADE_MATCH);
  return FADE_STEPS[(now + 1) % FADE_STEPS.length]!;
}

/** What a picture's menu can tell the map to do. */
export interface PictureMenuActions {
  editBackground: (id: string, edit: { opacity?: number; hidden?: boolean; locked?: boolean }) => void;
  restackBackground: (id: string, move: Restack) => void;
  removeBackground: (id: string) => void;
}

/** Everything a picture can be told to do, in one place. `order` is every
 *  picture's id, back to front. */
export function pictureMenuItems(b: MapBackgroundDto, order: readonly string[], actions: PictureMenuActions): ContextItem[] {
  return [
    b.locked === true
      ? { label: "Unlock", onClick: () => actions.editBackground(b.id, { locked: false }) }
      : { label: "Lock in place", onClick: () => actions.editBackground(b.id, { locked: true }) },
    b.hidden === true
      ? { label: "Show", onClick: () => actions.editBackground(b.id, { hidden: false }) }
      : { label: "Hide", onClick: () => actions.editBackground(b.id, { hidden: true }) },
    { label: `Fade (${Math.round((b.opacity ?? 1) * 100)}%)`, onClick: () => actions.editBackground(b.id, { opacity: nextFade(b.opacity) }) },
    ...restackItems(order, b.id, (to) => actions.restackBackground(b.id, to)),
    { label: "Remove from the map", danger: true, onClick: () => actions.removeBackground(b.id) },
  ];
}

/** A picture's menu, open at a point on screen. Reached from its row (which
 *  works even when locked) and from a right-click on the map. */
export function openPictureMenu(
  b: MapBackgroundDto, order: readonly string[], actions: PictureMenuActions, at: { x: number; y: number },
): void {
  openContextMenu(at.x, at.y, pictureMenuItems(b, order, actions));
}
