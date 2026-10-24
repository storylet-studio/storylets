// Text contrast in every Storyletter palette (patterkit design/patterpad-text-contrast-2026-10.md): each text
// token passes WCAG AA (4.5) on the board, the panels and a card, and under Increase Contrast (app-shell's
// `prefers-contrast: more` block) the greys and edges rise further. A source scan, as palette-scheme.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EDGE_CONTRAST, TEXT_CONTRAST, contrastShortfalls, themePalettes, withHighContrast,
} from "@wildwinter/app-shell/contrast";

const palettes = themePalettes(readFileSync(new URL("./src/theme.css", import.meta.url), "utf8"));
const GROUNDS = ["--bg", "--surface", "--card"];
const TEXT = ["--ink", "--muted", "--danger", "--warn", "--ok"];
const fmt = (s: { palette: string; token: string; ground: string; ratio: number }): string =>
  `${s.palette} ${s.token} on ${s.ground}: ${s.ratio}`;

/** Known shortfalls not yet fixed. Each entry must still fail, so fixing one means taking it off this list. Empty since the
 *  light --ok went to #3a7544 (2026-10-24). */
const PENDING: string[] = [];

describe("text contrast", () => {
  it("reads every palette and every token", () => {
    expect(Object.keys(palettes).sort()).toEqual(["baize", "chambray", "default", "indigo", "linen", "system-dark"]);
    expect(contrastShortfalls(palettes, TEXT, GROUNDS, TEXT_CONTRAST).unresolved).toEqual([]);
  });

  it("passes AA for every text token on every ground, but the pending ones", () => {
    const failing = contrastShortfalls(palettes, TEXT, GROUNDS, TEXT_CONTRAST).shortfalls.map(fmt);
    expect(failing.filter((f) => !PENDING.some((p) => f.startsWith(p)))).toEqual([]);
    expect(PENDING.filter((p) => !failing.some((f) => f.startsWith(p))), "pending entries that now pass").toEqual([]);
  });

  it("under Increase Contrast, grey text reaches 5:1 and edges 3:1", () => {
    const high = Object.fromEntries(Object.entries(palettes).map(([n, p]) => [n, withHighContrast(p)]));
    expect(contrastShortfalls(high, ["--muted"], GROUNDS, 5).shortfalls.map(fmt)).toEqual([]);
    expect(contrastShortfalls(high, ["--line", "--line-soft"], GROUNDS, EDGE_CONTRAST).shortfalls.map(fmt)).toEqual([]);
  });
});
