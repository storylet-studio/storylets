// ---------------------------------------------------------------------------
// The navigation cluster every canvas carries: fit, fit-the-selection, and zoom
// (design/graphical-views.md section 1.1b).
//
// WHY it exists. The gestures underneath are good ones - scroll pans, shift
// makes it horizontal, cmd-scroll or pinch zooms, three separate ways to
// drag-pan - but every one of them is a modifier somebody has to already know,
// and a canvas that only responds to knowledge you do not have reads as a
// canvas that does not respond. So the common moves get a visible control: the
// gestures stay the fast path for people who know them, and the cluster is how
// everybody else finds out they exist (its tooltips name the keys).
//
// DOM, not Konva: it is chrome rather than content, it wants the app's buttons
// and the app's tooltips, and drawing it on the stage would mean it panned away
// with the board. It is mounted by the surface itself, so all three canvases
// (node, map, links) get exactly the same one in exactly the same corner.
// ---------------------------------------------------------------------------

import "./canvas-controls.css";
import { el } from "./dom.js";

/** The four the cluster draws, on the shell's grammar: the 24 grid, the
 *  2.571 stroke (1.5px at 14px), round caps and joins, currentColor, and the
 *  same `data-icon` stamp the vocabulary's nodes carry so one stylesheet rule
 *  governs them. Local because the vocabulary has no word for a fit or a zoom
 *  yet; the geometry is Lucide's (maximize, plus, minus), so when the shell
 *  grows the words these can be deleted with no visible change. Corner
 *  brackets read as "frame this", which is what a fit does; the selection
 *  variant frames a card rather than the whole board. */
const ROOT =
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.571"`
  + ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
const FRAME =
  `<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>`
  + `<path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>`;
const ICON_FIT_ALL = `${ROOT} data-icon="fitAll">${FRAME}</svg>`;
const ICON_FIT_SELECTION = `${ROOT} data-icon="fitSelection">${FRAME}<rect x="9" y="9" width="6" height="6" rx="1"/></svg>`;
const ICON_ZOOM_IN = `${ROOT} data-icon="zoomIn"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;
const ICON_ZOOM_OUT = `${ROOT} data-icon="zoomOut"><path d="M5 12h14"/></svg>`;

export interface CanvasControlActions {
  fitAll: () => void;
  fitSelection: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  actualSize: () => void;
}

/** What the cluster needs to know to say what is available. */
export interface CanvasControlState {
  scale: number;
  hasItems: boolean;
  hasSelection: boolean;
  /** The surface's zoom limits, so the buttons stop offering what will not happen. */
  min: number;
  max: number;
}

export interface CanvasControls {
  update: (state: CanvasControlState) => void;
  destroy: () => void;
}

/** The zoom, as a canvas tool writes it. Whole percent: a readout that flickers
 *  through decimals while you pinch is noise, and nobody zooms to 112.4%. */
export function zoomLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/** Mount the cluster into a canvas host. */
export function mountCanvasControls(host: HTMLElement, actions: CanvasControlActions): CanvasControls {
  // The cluster is placed against its host, so the host has to be a positioning
  // context. Every canvas host in the app is one already (they carry the open
  // chip too), but that rule lives in another stylesheet, and a surface mounted
  // somewhere that had not imported it put its controls against the PAGE: they
  // hung below the canvas, over whatever was underneath. Asked and answered here
  // instead, so the surface carries its own chrome wherever it is mounted.
  if (getComputedStyle(host).position === "static") host.style.position = "relative";

  const bar = el("div", { className: "canvasctl" });
  // Not part of the tab order: these are all reachable by key already (Home, F,
  // cmd +/-/0), and five stops between a canvas and whatever follows it would
  // make keyboard travel through the page worse, not better.
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Canvas navigation");

  const button = (icon: string | undefined, tip: string, onClick: () => void): HTMLButtonElement => {
    const b = el("button", { className: "canvasbtn", tip, onClick: (e) => {
      // A pointer click leaves focus on the button, and the surface's own Space
      // (hold to pan) would then be a second press of it. Keyboard activation
      // arrives with detail 0 and keeps its focus, as it must.
      if (e.detail > 0) b.blur();
      onClick();
    } });
    b.type = "button";
    if (icon !== undefined) b.innerHTML = icon;
    return b;
  };

  const fitAll = button(ICON_FIT_ALL, "Fit everything (Home)", actions.fitAll);
  const fitSel = button(ICON_FIT_SELECTION, "Fit the selection (F)", actions.fitSelection);
  const out = button(ICON_ZOOM_OUT, "Zoom out (⌘−)", actions.zoomOut);
  const inn = button(ICON_ZOOM_IN, "Zoom in (⌘+)", actions.zoomIn);
  // The readout is a control too: the zoom is the one number on a canvas anybody
  // wants to reset, and clicking the thing that displays it is where they try.
  const readout = button(undefined, "Back to 100% (⌘0)", actions.actualSize);
  readout.classList.add("canvaszoom");
  readout.textContent = zoomLabel(1);

  bar.append(fitAll, fitSel, el("span", { className: "canvasctl-sep" }), out, readout, inn);
  host.append(bar);

  return {
    update(state) {
      readout.textContent = zoomLabel(state.scale);
      fitAll.disabled = !state.hasItems;
      fitSel.disabled = !state.hasSelection;
      // A hair of tolerance: a scale that has landed on the limit by repeated
      // multiplication is not exactly equal to it.
      out.disabled = state.scale <= state.min * 1.001;
      inn.disabled = state.scale >= state.max * 0.999;
      readout.disabled = !state.hasItems;
    },
    destroy() { bar.remove(); },
  };
}
