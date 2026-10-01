// ---------------------------------------------------------------------------
// Glyphs the shell's icon set has no word for: the project map's own (a folded
// map, on the navigator's Map row and on each box row that uses it) and the
// layer list's eye. Drawn on the shell's grid and stroke so they sit beside its
// icons as one set: 24-unit box, round caps, currentColor (canvas-controls.ts
// draws its camera icons the same way, for the same reason).
// ---------------------------------------------------------------------------

const ROOT = (name: string, size: number): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"`
  + ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-icon="${name}">`;

const SVG = {
  map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5"/><path d="M15 6.5V20"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M2 12s3.6-7 10-7c1.9 0 3.6.6 5 1.5"/><path d="M22 12s-3.6 7-10 7c-1.9 0-3.6-.6-5-1.5"/><path d="M4 20 20 4"/>',
} as const;

export type MapGlyph = keyof typeof SVG;

/** A glyph as a span, ready to append. */
export function mapGlyph(name: MapGlyph, size = 13, className = "map-glyph"): HTMLElement {
  const span = document.createElement("span");
  span.className = className;
  span.innerHTML = `${ROOT(name, size)}${SVG[name]}</svg>`;
  return span;
}
