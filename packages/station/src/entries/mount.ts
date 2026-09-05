// ---------------------------------------------------------------------------
// The one line of glue every entry shares: find `#app`, start the app, and put
// a refusal on screen if it cannot start at all.
//
// An app never throws at a visitor. Whatever went wrong, a station shows a
// sentence: an unprovisioned kiosk in a foyer with a stack trace on it is the
// venue's problem for the whole of the run.
// ---------------------------------------------------------------------------
/// <reference lib="dom" />
import { APP_CSS } from "../shell.js";

export function mount(start: (root: HTMLElement) => Promise<void>): void {
  const go = (): void => {
    const style = document.createElement("style");
    style.textContent = APP_CSS;
    document.head.append(style);
    const root = document.getElementById("app");
    if (root === null) return;
    void start(root).catch((err: unknown) => {
      root.replaceChildren();
      const p = document.createElement("p");
      p.className = "sk-error";
      p.textContent = err instanceof Error ? err.message : String(err);
      root.append(p);
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
  else go();
}
