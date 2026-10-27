// The theme axis, applied to a window.
//
// One function, in five windows: the main editor and the four tool windows all
// need the same three lines, and until 2026-08-29 all five carried their own
// byte-identical copy. Small, but it is a CONTRACT with theme.css - "absent
// means follow the OS" is a rule that file states and this one implements -
// and five copies of a contract are five chances to answer a future third
// state differently.
import { themeAttribute } from "@wildwinter/app-shell/theme";
import type { ThemeChoice } from "../../shared/api.js";

/** Stamp the chosen theme on the root element.
 *
 *  `system` REMOVES the attribute rather than writing a value, because the
 *  shell's palette.css follows the OS through `prefers-color-scheme` on the
 *  bare `:root`, and any `data-theme` at all detaches that media query. */
export function applyTheme(theme: ThemeChoice): void {
  const root = document.documentElement;
  const id = themeAttribute(theme);
  if (id) root.setAttribute("data-theme", id);
  else root.removeAttribute("data-theme");
  // The shell's tokens.css gives Windows its larger chrome text off this.
  root.setAttribute("data-platform", platform());
}

/** The platform as Node names it, from the renderer's side (which has no `process`). */
function platform(): string {
  const p = navigator.platform.toUpperCase();
  return p.includes("MAC") ? "darwin" : p.includes("WIN") ? "win32" : "linux";
}
