// The one part of the canvas token adapter that is testable without a browser,
// and the part most likely to rot: a canvas must colour a deck the same way the
// lists do. Reading CSS custom properties and repainting on a theme change are
// judged in the canvas lab (packages/studio/dev), because a canvas cannot be
// proven by assertion.

import { describe, expect, it } from "vitest";
import { colourIndex, PALETTE_SIZE } from "../../shell/colour.js";
import { charColour, readableOn, type CanvasTokens } from "./canvas-tokens.js";

const ramp = Array.from({ length: PALETTE_SIZE }, (_, i) => `#char${i}`);
const tokens = { chars: ramp, accent: "#accent" } as CanvasTokens;

describe("charColour", () => {
  it("agrees with the shell's identity hash", () => {
    // The point of the whole function: one hash for the app, so a deck's dot in
    // the nav and its stripe on a canvas are the same colour.
    for (const name of ["the-inn", "the-forge", "the-market", "a", ""]) {
      expect(charColour(tokens, name)).toBe(ramp[colourIndex(name)]);
    }
  });

  it("falls back to the accent when the theme has no ramp", () => {
    // A stylesheet that has not loaded yet reads every property as "": better a
    // flat accent than `undefined` reaching a canvas fill.
    expect(charColour({ chars: [], accent: "#accent" } as unknown as CanvasTokens, "the-inn")).toBe("#accent");
  });
});

describe("readableOn", () => {
  const light = { ink: "#1f2328", surface: "#fbfaf7", accent: "#3a5a8c", chars: [] } as unknown as CanvasTokens;
  const dark = { ink: "#e8e6e1", surface: "#1d2026", accent: "#8fb0e0", chars: [] } as unknown as CanvasTokens;

  it("puts the light surface on a dark disc and the ink on a pale one", () => {
    expect(readableOn(light, "#a84a38")).toBe(light.surface);
    expect(readableOn(light, "#f0e6c8")).toBe(light.ink);
  });

  it("follows the theme: on the dark theme's pastel discs the dark surface reads", () => {
    expect(readableOn(dark, "#d97f74")).toBe(dark.surface);
  });

  it("reads a three-digit hex, and falls back to the ink on a colour it cannot read", () => {
    expect(readableOn(light, "#000")).toBe(light.surface);
    expect(readableOn(light, "rgb(10, 10, 10)")).toBe(light.ink);
  });
});
