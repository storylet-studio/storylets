// ---------------------------------------------------------------------------
// Canvas furniture, drawn: the frames (design/graphical-views.md 3).
//
// The same two objects on both canvases, so they are drawn once here and the two
// views just include them in their item lists. A node canvas and a map are
// different views of different material, but "put a box round this lot and call
// it act two" is the same thought on either, and it should not look like two
// different features depending on which tab you are on.
//
// Colours come from the theme's twelve-step identity ramp rather than from new
// tokens, because that ramp is already what gives a deck or a speaker its
// colour: furniture picked from a different set would be the one thing on the
// canvas that did not match the lists it was opened from. The SHARD stores a
// name ("amber"), never a hex value, so a project drawn on linen still reads on
// baize.
// ---------------------------------------------------------------------------

import { rgba } from "./map-art.js";
import Konva from "konva";
import type { CanvasItem, DrawContext } from "./canvas-surface.js";
import type { CanvasTokens } from "./canvas-tokens.js";
import type { Frame } from "@storylet-studio/model";


/** The frame's title bar, in world units: the only part of a frame that is
 *  hit-testable (see `drawFrame`). */
export const REGION_BAR = 22;

/** Below this the text goes, like every other label on these canvases: two-pixel
 *  type is worse than none, and the tooltip picks up the slack. */
export const FURNITURE_TEXT_FLOOR = 0.35;

/** Palette name -> a colour from the theme's ramp. "paper" is the absence of a
 *  colour and reads as the surface's own quiet grey, which is what an author who
 *  never picked one should get. */
export function furnitureColour(tokens: CanvasTokens, name: string | undefined): string {
  const ramp = tokens.chars;
  switch (name) {
    case "amber": return ramp[1] ?? tokens.accent;
    case "sage": return ramp[4] ?? tokens.accent;
    case "sky": return ramp[7] ?? tokens.accent;
    case "rose": return ramp[10] ?? tokens.accent;
    case "slate": return tokens.muted;
    default: return tokens.muted;      // "paper", and anything unrecognised
  }
}

/** Whether the palette entry is the default one, which is drawn quieter: a
 *  frame nobody coloured should recede, not shout in grey. */
const isPaper = (name: string | undefined): boolean => name === undefined || name === "paper";

export interface FrameShape extends CanvasItem {
  kind: "frame";
  title?: string;
  colour?: string;
}



/**
 * A frame: a tinted band with a title bar.
 *
 * Only the BAR listens, and that is the whole design of the thing. A frame sits
 * behind the content it describes, so a body that answered the pointer would
 * swallow every click and marquee meant for the cards inside it - the author
 * would draw one box and lose the canvas underneath. The bar is the handle: it
 * selects, it drags, it right-clicks, and everything else passes straight
 * through. Unreal's comment box behaves the same way, and for the same reason.
 */
export const frameShape = (frame: Frame): FrameShape => ({
  kind: "frame",
  id: frame.id,
  x: frame.x, y: frame.y, width: frame.w, height: frame.h,
  cornerRadius: 6,
  ...(frame.title !== undefined ? { title: frame.title } : {}),
  ...(frame.colour !== undefined ? { colour: frame.colour } : {}),
});

export function drawFrame(item: FrameShape, ctx: DrawContext): Konva.Group {
  const { tokens, scale } = ctx;
  const group = new Konva.Group();
  const colour = furnitureColour(tokens, item.colour);
  const quiet = isPaper(item.colour);

  const body = new Konva.Rect({
    x: 0, y: 0, width: item.width, height: item.height,
    cornerRadius: item.cornerRadius ?? 6,
    fill: rgba(colour, quiet ? 0.05 : 0.1),
    stroke: rgba(colour, quiet ? 0.35 : 0.55),
    strokeWidth: Math.max(1, 1.5 / scale),
    listening: false,                 // see the note above: the bar is the handle
  });
  group.add(body);

  const barHeight = Math.min(REGION_BAR, item.height);
  group.add(new Konva.Rect({
    x: 0, y: 0, width: item.width, height: barHeight,
    cornerRadius: [item.cornerRadius ?? 6, item.cornerRadius ?? 6, 0, 0],
    fill: rgba(colour, quiet ? 0.16 : 0.3),
  }));

  if (scale >= FURNITURE_TEXT_FLOOR) {
    const text = new Konva.Text({
      text: item.title !== undefined && item.title !== "" ? item.title : "Frame",
      fontFamily: tokens.fontUi, fontSize: 12 / scale,
      fill: item.title ? tokens.ink : tokens.muted,
      listening: false,
      width: item.width - 12 / scale,
      ellipsis: true, wrap: "none",
    });
    text.position({ x: 6 / scale, y: barHeight / 2 - text.height() / 2 });
    group.add(text);
  }
  return group;
}


