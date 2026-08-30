// ---------------------------------------------------------------------------
// Drawing and editing canvas furniture: the half of REGIONS that
// is gestures rather than pixels (furniture-art.ts is the other half).
//
// One controller, used by both canvases. The two views differ in what they draw
// and what a drag MEANS - a card moving is a card moving, a pin moving rebinds a
// hand - but a frame is a frame on either, so the tools, the menu and the text
// editor live here once and each view hands over the pieces only it knows: its
// surface, its model, and how to save.
//
// The view keeps owning its own strip and its own repaint. This controller
// answers questions ("did you own that drop?", "what should the strip say?")
// rather than reaching into the view, which is what lets two quite different
// views share it without either growing a mode for the other's sake.
// ---------------------------------------------------------------------------

import { openContextMenu } from "./context-menu.js";
import { FURNITURE_COLOURS } from "@storylet-studio/model";
import type { CanvasFurnitureDto, FrameDto } from "../../shared/api.js";
import type { CanvasItem, CanvasSurface } from "./canvas-surface.js";

/** A rectangle being dragged out, for the view's rubber band. */
export interface FurnitureDraft { x: number; y: number; w: number; h: number }

export interface FurnitureDeps {
  surface: () => CanvasSurface<CanvasItem>;
  /** The stage's container, which the text editor is positioned over. */
  container: () => HTMLElement;
  /** The furniture as the view currently holds it. */
  get: () => CanvasFurnitureDto;
  /** Persist. The controller names the gesture and says whether it coalesces;
   *  the view forwards both to main untouched. */
  save: (next: CanvasFurnitureDto, label: string, coalesce?: string) => void;
  /** Rebuild the items and the strip: the controller has changed the model. */
  repaint: () => void;
}

export interface FurnitureController {
  /** Arm the frame tool: click one corner, then the opposite one. */
  drawFrame: () => void;
  /** What the strip should say while a furniture tool is armed. */
  hint: () => string | undefined;
  cancel: () => void;
  /** Take the furniture out of a drop and return what is left for the view. */
  absorbMoves: (moves: { id: string; x: number; y: number }[]) => { id: string; x: number; y: number }[];
  /** Take the furniture out of a delete and return what is left. */
  absorbDelete: (ids: string[]) => string[];
  /** A right-click landed on `id`: did it belong to furniture? */
  menu: (id: string, e: MouseEvent) => boolean;
  /** A double-click landed on `id`: did it belong to furniture? */
  activate: (id: string) => boolean;
  /** The rectangle being dragged out, for the view to draw. */
  draft: () => FurnitureDraft | undefined;
  /** Is this id a piece of furniture? For a view deciding whose item it is. */
  owns: (id: string) => boolean;
  destroy: () => void;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** An id in the same family as the rest of the project's, minted here because
 *  furniture never goes near main until it is saved. */
function furnitureId(prefix: string): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return prefix + [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * A piece of furniture just created, waiting to be typed into.
 *
 * Module scope, and it has to be: creating one saves, saving remounts the view,
 * and the controller that opened the tool is gone by the time the item exists.
 * The NEXT controller picks this up and opens the editor, which is what makes
 * "draw a frame and name it" one gesture rather than two.
 */
let awaitingText: string | undefined;

export function createFurniture(deps: FurnitureDeps): FurnitureController {
  let armed: "frame" | undefined;
  let corner: { x: number; y: number } | undefined;
  let rubber: FurnitureDraft | undefined;
  let editor: HTMLTextAreaElement | undefined;
  let editing: string | undefined;

  const model = (): CanvasFurnitureDto => deps.get();
  const frames = (): FrameDto[] => model().frames;
  const owns = (id: string): boolean =>
    frames().some((r) => r.id === id);

  const commit = (next: CanvasFurnitureDto, label: string, coalesce?: string): void => {
    deps.save(next, label, coalesce);
  };

  function stop(): void {
    armed = undefined;
    corner = undefined;
    rubber = undefined;
    deps.surface().setTool(undefined);
    deps.repaint();
  }

  // --- drawing ------------------------------------------------------------------

  function drawFrame(): void {
    closeEditor();
    armed = "frame";
    corner = undefined;
    rubber = undefined;
    deps.surface().setTool({
      cursor: "crosshair",
      onClick: (at) => {
        // The strip has to move on with the gesture: without this repaint it
        // still reads "click one corner" while the author is looking for the
        // second, which is the tool lying about where it has got to.
        if (!corner) { corner = { x: at.x, y: at.y }; deps.repaint(); return; }
        const rect = normalise(corner, at);
        stop();
        // A flick rather than a drag: too small to see and impossible to grab.
        // Abandoned rather than saved, the same call the zone tracer makes when
        // it has fewer than three points.
        if (rect.w < 12 || rect.h < 12) return;
        const frame: FrameDto = { id: furnitureId("r_"), x: rect.x, y: rect.y, w: rect.w, h: rect.h };
        // Straight into naming it: a frame with no title is a coloured box, and
        // an author who drew one meant to call it something. The flag is set
        // BEFORE the save, because the save is what remounts the view.
        awaitingText = frame.id;
        commit({ ...model(), frames: [...frames(), frame] }, "Draw a frame");
      },
      onMove: (at) => {
        if (!corner) return;
        rubber = normalise(corner, at);
        deps.repaint();
      },
      onCancel: () => stop(),
    });
    deps.repaint();
  }

  const hint = (): string | undefined => {
    if (armed === "frame") {
      return corner ? "Frame: click the opposite corner" : "Frame: click one corner";
    }
    return undefined;
  };

  // --- moving, deleting ---------------------------------------------------------

  function absorbMoves(moves: { id: string; x: number; y: number }[]): { id: string; x: number; y: number }[] {
    const mine = moves.filter((m) => owns(m.id));
    if (mine.length === 0) return moves;
    const by = new Map(mine.map((m) => [m.id, m]));
    const next: CanvasFurnitureDto = {
      frames: frames().map((r) => { const m = by.get(r.id); return m ? { ...r, x: Math.round(m.x), y: Math.round(m.y) } : r; }),
    };
    // One undo step for the whole sweep, however many frames it took: the drag is
    // the gesture (the rule the backgrounds wrote down).
    commit(next, mine.length > 1 ? "Move furniture" : "Move", "furniture:move");
    return moves.filter((m) => !owns(m.id));
  }

  function absorbDelete(ids: string[]): string[] {
    const mine = ids.filter(owns);
    if (mine.length === 0) return ids;
    removeAll(mine);
    return ids.filter((id) => !owns(id));
  }

  function removeAll(ids: string[]): void {
    const gone = new Set(ids);
    if (editing !== undefined && gone.has(editing)) closeEditor({ discard: true });
    commit({
      frames: frames().filter((r) => !gone.has(r.id)),
    }, ids.length > 1 ? "Remove furniture" : "Remove");
  }

  // --- the menu -----------------------------------------------------------------

  function menu(id: string, e: MouseEvent): boolean {
    if (!owns(id)) return false;
    const isRegion = frames().some((r) => r.id === id);
    const list: { id: string; z?: number }[] = frames();
    const at = list.findIndex((entry) => entry.id === id);

    openContextMenu(e.clientX, e.clientY, [
      { label: isRegion ? "Rename…" : "Edit text…", onClick: () => openEditor(id) },
      ...FURNITURE_COLOURS.map((colour) => ({
        label: `Colour: ${colour}`, onClick: () => setColour(id, colour),
      })),
      ...(at < list.length - 1 ? [{ label: "Bring to front", onClick: () => restack(id, "front") }] : []),
      ...(at > 0 ? [{ label: "Send to back", onClick: () => restack(id, "back") }] : []),
      { label: "Remove", danger: true, onClick: () => removeAll([id]) },
    ]);
    return true;
  }

  function setColour(id: string, colour: string): void {
    // "paper" is the default, and a default is written as ABSENT: a shard says
    // what somebody chose, and a key nobody set is noise in a diff.
    const apply = <T extends { id: string; colour?: string }>(entry: T): T => {
      if (entry.id !== id) return entry;
      const next = { ...entry };
      if (colour === "paper") delete next.colour; else next.colour = colour;
      return next;
    };
    commit({ frames: frames().map(apply) }, "Recolour");
  }

  /** Front and back only, not the four-way move the zones and backgrounds have.
   *  Furniture overlaps rarely and a stack of two has no middle; the two ends are
   *  the whole of what anybody reaches for. */
  function restack(id: string, move: "front" | "back"): void {
    const isRegion = frames().some((r) => r.id === id);
    const list = frames();
    const zs = list.map((entry, i) => entry.z ?? i);
    const z = move === "front" ? Math.max(...zs) + 1 : Math.min(...zs) - 1;
    const apply = <T extends { id: string; z?: number }>(entry: T): T =>
      (entry.id === id ? { ...entry, z } : entry);
    commit({ ...model(), frames: frames().map(apply) },
      move === "front" ? "Bring to front" : "Send to back");
  }

  // --- the text editor ----------------------------------------------------------
  //
  // A real textarea, positioned over the item. Konva cannot take typing, and the
  // alternative - a dialog - would make a sticky cost two clicks and a context
  // switch to write one line, which is the opposite of the point of it.

  function openEditor(id: string): void {
    closeEditor();
    const surface = deps.surface();
    const rect = surface.screenRect(id);
    if (!rect) return;
    const frame = frames().find((r) => r.id === id);
    if (!frame) return;

    editing = id;
    const box = document.createElement("textarea");
    box.className = "furniture-edit";
    box.value = frame.title ?? "";
    box.placeholder = "<frame name>";
    // A frame is named in its BAR, so the editor is one line tall and sits where
    // the bar is rather than over the whole area.
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${Math.max(80, rect.width)}px`;
    box.style.height = "22px";
    box.rows = 1;

    box.addEventListener("keydown", (e) => {
      e.stopPropagation();                       // the canvas must not read this as a shortcut
      if (e.key === "Escape") { closeEditor({ discard: true }); return; }
      // Enter commits: a frame's name is one line.
      if (e.key === "Enter") {
        e.preventDefault();
        closeEditor();
      }
    });
    box.addEventListener("blur", () => closeEditor());

    deps.container().append(box);
    editor = box;
    box.focus();
    box.select();
  }

  function closeEditor(opts: { discard?: boolean } = {}): void {
    const box = editor;
    const id = editing;
    editor = undefined;
    editing = undefined;
    if (!box) return;
    const text = box.value;
    box.remove();
    if (opts.discard === true || id === undefined) return;

    const frame = frames().find((r) => r.id === id);
    if (frame) {
      if ((frame.title ?? "") === text) return;
      const next = { ...frame };
      if (text.trim() === "") delete next.title; else next.title = text;
      commit({ ...model(), frames: frames().map((r) => (r.id === id ? next : r)) }, "Rename a frame");
      return;
    }
  }

  // A piece created by the previous incarnation of this view: open it for
  // typing now that it exists and has a rectangle on screen.
  if (awaitingText !== undefined && owns(awaitingText)) {
    const id = awaitingText;
    awaitingText = undefined;
    window.setTimeout(() => openEditor(id), 0);
  }

  return {
    drawFrame,
    hint,
    cancel: () => { closeEditor({ discard: true }); if (armed) stop(); },
    absorbMoves,
    absorbDelete,
    menu,
    activate: (id) => { if (!owns(id)) return false; openEditor(id); return true; },
    draft: () => rubber,
    owns,
    destroy: () => { closeEditor({ discard: true }); },
  };
}

/** Two clicked corners into a rectangle, whichever way round they came. */
function normalise(a: { x: number; y: number }, b: { x: number; y: number }): FurnitureDraft {
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    w: Math.round(Math.abs(b.x - a.x)),
    h: Math.round(Math.abs(b.y - a.y)),
  };
}
