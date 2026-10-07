// ---------------------------------------------------------------------------
// What every tool window (the Board, Coverage, Links and Find) does as it
// boots, written once. The four had grown their own copies of the same lines:
// mount the tooltip host, read the state, apply the theme and follow it, and
// listen for main re-pinning the window (Reset View re-pins every helper window
// and tells the window after the fact, app-shell 0.23.0). Four copies had
// already drifted in the order they did it.
//
// The base stylesheet beside this (base.css) is the same idea for the CSS.
// ---------------------------------------------------------------------------

import { initTooltips } from "@wildwinter/app-shell";
import { applyTheme } from "../src/theme.js";
import type { StudioApi, StudioState } from "../../shared/api.js";

declare global { interface Window { studio: StudioApi; } }

export interface ToolWindowBoot {
  /** Main re-pinned the window (Reset View): reflect it without choosing it. */
  onPinned: (pinned: boolean) => void;
}

/** Mount the tooltip host, apply and follow the theme, wire the pin, and hand
 *  back the app's state for the window's own remembered settings. Call once. */
export async function bootToolWindow(opts: ToolWindowBoot): Promise<StudioState> {
  // Bare, as the tooltip-host guard asks: options would be the app's to pass.
  initTooltips();
  const studio = window.studio;
  studio.onTheme(applyTheme);
  studio.onWindowPinned(opts.onPinned);
  const state = await studio.getState();
  applyTheme(state.theme);
  return state;
}
