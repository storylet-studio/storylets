// ---------------------------------------------------------------------------
// Canvas furniture, drawn: the frames (design/graphical-views.md 3).
//
// The same object on both canvases, so it is drawn once here and the two views
// just include frames in their item lists. A node canvas and a map are
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

import Konva from "konva";
import { rescalable, type CanvasItem, type DrawContext } from "./canvas-surface.js";
import { rgba, type CanvasTokens } from "./canvas-tokens.js";
import type { Frame } from "@storylet-studio/model";

/** The frame's title bar, in world units: the only part of a frame that is
 *  hit-testable (see `drawFrame`). */
export const REGION_BAR = 22;

/** Below this the frame's NAME goes, and the hover tip carries it instead.
 *
 *  Higher than the other labels' floors (a card's title at 34%, a pin's name at
 *  35%), and for a reason those do not have: the name sits inside a bar that is
 *  world-sized while the text is screen-sized, so zooming out shrank the bar
 *  under a name that stayed the same size, and by 35% a 12px name hung out of an
 *  8px bar. At 60% the bar is 13 pixels, which still holds the name at 10. The
 *  other way out, a bar with a floor in screen pixels, would have grown the bar
 *  down over the cards the frame is drawn round as the camera pulled back. */
export const FURNITURE_TEXT_FLOOR = 0.6;
/** The name's size on screen, and the room it keeps from the bar's edges. */
const FRAME_TEXT_PX = 12;
const FRAME_TEXT_PAD_PX = 6;
/** What the name leaves of the bar's height when the bar is small, in screen pixels. */
const FRAME_TEXT_CLEARANCE_PX = 3;
/** A frame's corner radius, in world units. */
const FRAME_RADIUS = 6;

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
 *
 * The item says so too (`hitArea`), so a MARQUEE agrees with the pointer: a
 * sweep round the cards inside a frame takes the cards and not the frame, which
 * it used to, so that the next Delete removed the frame along with them.
 */
export const frameShape = (frame: Frame): FrameShape => ({
  kind: "frame",
  id: frame.id,
  x: frame.x, y: frame.y, width: frame.w, height: frame.h,
  cornerRadius: FRAME_RADIUS,
  hitArea: { x: 0, y: 0, width: frame.w, height: Math.min(REGION_BAR, frame.h) },
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
    cornerRadius: item.cornerRadius ?? FRAME_RADIUS,
    fill: rgba(colour, quiet ? 0.05 : 0.1),
    stroke: rgba(colour, quiet ? 0.35 : 0.55),
    listening: false,                 // see the note above: the bar is the handle
  });
  group.add(body);

  const barHeight = Math.min(REGION_BAR, item.height);
  group.add(new Konva.Rect({
    x: 0, y: 0, width: item.width, height: barHeight,
    cornerRadius: [item.cornerRadius ?? FRAME_RADIUS, item.cornerRadius ?? FRAME_RADIUS, 0, 0],
    fill: rgba(colour, quiet ? 0.16 : 0.3),
  }));

  let text: Konva.Text | undefined;
  if (scale >= FURNITURE_TEXT_FLOOR) {
    text = new Konva.Text({
      text: item.title !== undefined && item.title !== "" ? item.title : "Frame",
      fontFamily: tokens.fontUi,
      fill: item.title ? tokens.ink : tokens.muted,
      listening: false,
      ellipsis: true, wrap: "none",
    });
    group.add(text);
  }
  return rescalable(group, scale, (s) => {
    body.strokeWidth(Math.max(1, 1.5 / s));
    if (!text) return;
    // Never taller than the bar can hold: at the floor the bar is 13 pixels.
    const px = Math.min(FRAME_TEXT_PX, barHeight * s - FRAME_TEXT_CLEARANCE_PX);
    text.fontSize(px / s);
    text.width(Math.max(0, item.width - (FRAME_TEXT_PAD_PX * 2) / s));
    text.position({ x: FRAME_TEXT_PAD_PX / s, y: barHeight / 2 - text.height() / 2 });
  }, [FURNITURE_TEXT_FLOOR]);
}

/**
 * A rectangle being dragged out or resized, as a dashed outline that holds its
 * weight on screen: a frame being drawn, a picture being scaled. One drawing
 * for every canvas, which each had its own copy of.
 */
export function paintDraftRect(
  layer: Konva.Container, scale: number, tokens: CanvasTokens,
  rect: { x: number; y: number; width: number; height: number },
): void {
  layer.add(new Konva.Rect({
    x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    stroke: tokens.accent, strokeWidth: 1.5 / scale, dash: [6 / scale, 4 / scale],
    listening: false,
  }));
}
