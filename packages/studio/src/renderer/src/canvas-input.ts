// ---------------------------------------------------------------------------
// The canvas's input RULES, with no Konva and no DOM: who the keyboard belongs
// to, what each key does, and which cursor shows. canvas-surface.ts reads the
// state and acts on the answer; the answers live here so they can be pinned.
//
// The keyboard is the subtle one. The surface listens on the window, which it
// has to (a canvas element takes no keys of its own), so without a rule Cmd+A
// and Delete acted on the canvas while the author was in the navigator.
// ---------------------------------------------------------------------------

/**
 * What Escape does on a canvas, most local first: abandon the armed tool, drop
 * a marquee being swept, clear the selection. Undefined when it does nothing,
 * which is the one case the canvas leaves the key alone. Whenever it does
 * something, the key is marked handled (`preventDefault`): the editor reads an
 * unhandled Escape as "go up a level", so a canvas that cleared its selection
 * without saying so also sent the author out of the map.
 */
export function escapeTakes(state: { tool: boolean; marquee: boolean; selected: number }): "tool" | "marquee" | "selection" | undefined {
  if (state.tool) return "tool";
  if (state.marquee) return "marquee";
  if (state.selected > 0) return "selection";
  return undefined;
}

/**
 * Does the canvas own the keyboard? While it has focus (a press anywhere on it
 * takes focus), or while NOTHING has focus and the pointer is over it, which is
 * where a person's attention is then. Focus anywhere else (the navigator, a
 * button) is somebody else's keyboard, wherever the pointer happens to rest.
 */
export function ownsKeys(state: { focusInside: boolean; pointerOver: boolean; nothingFocused: boolean }): boolean {
  if (state.focusInside) return true;
  return state.pointerOver && state.nothingFocused;
}

/** What a key press does on a canvas. */
export type CanvasKey =
  | "commitTool" | "cancelTool" | "holdSpace" | "delete" | "dropMarquee" | "clearSelection"
  | "selectAll" | "actualSize" | "zoomIn" | "zoomOut" | "showSelection" | "fitAll"
  | { letter: string };

/**
 * The canvas's key map, in the order it is asked. Undefined is "not ours":
 * the key goes on to whoever else wants it, unhandled.
 *
 * A tool is MODAL: Enter and Escape finish or abandon it wherever the keyboard
 * is, since the strip's own Cancel button may well hold the focus. That is the
 * convention the old system's canvas settled on (Delete / Escape / Enter mean
 * delete, cancel-the-draw, confirm-the-draw). Everything else waits for the
 * canvas to own the keys (`ownsKeys`).
 *
 * Unmodified F and Home are the reflex every node and 3D tool has trained
 * (Unreal focuses the selection on F, Blender and Unreal frame everything on
 * Home). Deliberately NOT Cmd+F: that is Find, app-wide, and the listener is on
 * the window, so binding it here quietly stole it. Any other plain letter is
 * the caller's (`onKey`).
 */
export function canvasKey(
  e: { key: string; metaKey: boolean; ctrlKey: boolean },
  state: { tool: boolean; owns: boolean; marquee: boolean; selected: number },
): CanvasKey | undefined {
  if (state.tool && e.key === "Enter") return "commitTool";
  if (e.key === "Escape" && state.tool) return "cancelTool";
  if (!state.owns) return undefined;
  // Held, not toggled; the surface ignores a key-repeat.
  if (e.key === " ") return "holdSpace";
  const mod = e.metaKey || e.ctrlKey;
  if ((e.key === "Delete" || e.key === "Backspace") && state.selected > 0) return "delete";
  if (e.key === "Escape") {
    const takes = escapeTakes({ tool: false, marquee: state.marquee, selected: state.selected });
    return takes === "marquee" ? "dropMarquee" : takes === "selection" ? "clearSelection" : undefined;
  }
  if (mod && e.key.toLowerCase() === "a") return "selectAll";
  if (mod && e.key === "0") return "actualSize";
  if (mod && (e.key === "=" || e.key === "+")) return "zoomIn";
  if (mod && e.key === "-") return "zoomOut";
  if (!mod && e.key.toLowerCase() === "f") return "showSelection";
  if (!mod && e.key === "Home") return "fitAll";
  if (!mod && e.key.length === 1) return { letter: e.key.toLowerCase() };
  return undefined;
}

/**
 * The cursor, by ONE rule: a pan under way is the closed hand and a held Space
 * the open one, then an item being dragged, then whatever the pointer is over
 * (a handle, a marker, an item that can be dragged), then the armed tool's own,
 * then nothing. Four places used to write the container's cursor without
 * knowing about each other, so a handle rebuilt under the pointer left "move"
 * behind it on empty canvas.
 */
export function cursorFor(state: {
  panning: boolean; spaceHeld: boolean; draggingItem: boolean; over?: string | undefined; tool?: string | undefined;
}): string {
  if (state.panning) return "grabbing";
  if (state.spaceHeld) return "grab";
  if (state.draggingItem) return "grabbing";
  return state.over ?? state.tool ?? "";
}
