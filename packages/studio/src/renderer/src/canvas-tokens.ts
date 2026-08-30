// ---------------------------------------------------------------------------
// The theme, in a form Konva can use.
//
// Konva paints to a canvas, so it cannot read CSS custom properties: it wants
// resolved colour strings. This reads the live tokens once and hands them over,
// which is the whole cost of choosing Konva over DOM (design/graphical-views.md
// section 1.1) - twenty lines, not an architecture.
//
// Re-read on theme change. The editor's theme switch flips `data-theme` on the
// root, so a canvas subscribes and repaints rather than being reloaded.
// ---------------------------------------------------------------------------

import { colourIndex, PALETTE_SIZE } from "../../shell/colour.js";

/** The tokens a canvas surface needs. Names match theme.css so a reader can
 *  grep from one to the other. */
export interface CanvasTokens {
  bg: string;
  surface: string;
  card: string;
  ink: string;
  muted: string;
  line: string;
  lineSoft: string;
  accent: string;
  accentSoft: string;
  ok: string;
  warn: string;
  danger: string;
  fontUi: string;
  fontRead: string;
  fontMono: string;
  /** The twelve-step identity ramp, in order. What the editor already uses to
   *  give a deck or a speaker a stable colour, so a canvas agrees with the lists
   *  it was opened from. */
  chars: string[];
}

/** One entry per `--char-N` in theme.css, taken from the shell's palette rather
 *  than counted again here. */
const CHAR_STEPS = PALETTE_SIZE;

const TOKEN: Record<Exclude<keyof CanvasTokens, "chars">, string> = {
  bg: "--bg", surface: "--surface", card: "--card", ink: "--ink", muted: "--muted",
  line: "--line", lineSoft: "--line-soft", accent: "--accent", accentSoft: "--accent-soft",
  ok: "--ok", warn: "--warn", danger: "--danger",
  fontUi: "--font-ui", fontRead: "--font-read", fontMono: "--font-mono",
};

/** Read the theme as it stands. `--accent-soft` is a translucent colour in the
 *  stylesheet; Konva copes with rgba(), so it is passed through unchanged. */
export function readCanvasTokens(from: Element = document.documentElement): CanvasTokens {
  const style = getComputedStyle(from);
  const out = {} as Record<string, unknown>;
  for (const [key, name] of Object.entries(TOKEN)) {
    out[key] = style.getPropertyValue(name).trim();
  }
  out.chars = Array.from({ length: CHAR_STEPS }, (_, i) => style.getPropertyValue(`--char-${i}`).trim());
  return out as unknown as CanvasTokens;
}

/** A name's identity colour, resolved. The SAME hash the identity dots in the
 *  nav and the inspector use (app-shell's `colourIndex`), so a deck is the same
 *  colour on a canvas as it is in the list the canvas was opened from. Never
 *  hash it again locally: two hashes would drift the moment one changed. */
export function charColour(tokens: CanvasTokens, name: string): string {
  const ramp = tokens.chars;
  return ramp[colourIndex(name) % ramp.length] ?? tokens.accent;
}

/** Call `onChange` whenever the theme changes: the editor's own switch (which
 *  sets `data-theme` on the root) and the OS preference behind `system`.
 *  Returns a teardown. */
export function watchCanvasTokens(onChange: (tokens: CanvasTokens) => void): () => void {
  const fire = (): void => onChange(readCanvasTokens());
  const observer = new MutationObserver(fire);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // `system` follows the OS, which changes without touching data-theme at all.
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", fire);
  return () => { observer.disconnect(); media.removeEventListener("change", fire); };
}
