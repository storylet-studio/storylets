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

/** A token colour at partial alpha. Tokens are hex or rgb(); Konva takes rgba. */
export function rgba(colour: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(colour.trim());
  if (rgb) {
    const parts = rgb[1]!.split(",").map((p) => p.trim());
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }
  return colour;
}

/** Which of the theme's ink or surface reads better on `fill`: the one with
 *  the higher WCAG contrast. For a number drawn on a coloured disc, where the
 *  disc is one of twelve stored box colours in either theme, so neither ink
 *  nor white can be assumed. A colour it cannot read (not #rgb or #rrggbb)
 *  gets the ink. */
export function readableOn(tokens: CanvasTokens, fill: string): string {
  const lf = luminance(fill), li = luminance(tokens.ink), ls = luminance(tokens.surface);
  if (lf === undefined || li === undefined || ls === undefined) return tokens.ink;
  const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return contrast(lf, ls) > contrast(lf, li) ? tokens.surface : tokens.ink;
}

function luminance(colour: string): number | undefined {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim())?.[1];
  if (hex === undefined) return undefined;
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
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
