// Text contrast in every palette Storyletter paints in (patterkit design/patterpad-text-contrast-2026-10.md). Since
// the October 2026 UI review the palettes are the family's, in app-shell's palette.css, and app-shell's own test
// holds them to AA; this one checks them as Storyletter loads them (the shell's palette, then theme.css), so
// nothing Storyletter adds can take a text token under AA. A source scan, as palette-scheme.test.ts.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  EDGE_CONTRAST, TEXT_CONTRAST, contrastShortfalls, themePalettes, withHighContrast,
} from "@wildwinter/app-shell/contrast";

const require = createRequire(import.meta.url);
// The built palette.css has its selectors' quotes dropped, which 0.64.0's reader can't parse; put them back.
// app-shell's next release reads both, and this line can go when Storyletter moves to it.
const shared = readFileSync(require.resolve("@wildwinter/app-shell/palette.css"), "utf8")
  .replace(/\[data-theme=([\w-]+)\]/g, '[data-theme="$1"]');
const own = readFileSync(new URL("./src/theme.css", import.meta.url), "utf8");
const palettes = themePalettes(`${shared}\n${own}`);
const GROUNDS = ["--bg", "--surface", "--card"];
const TEXT = ["--ink", "--muted", "--danger", "--warn", "--ok", "--accent"];
const fmt = (s: { palette: string; token: string; ground: string; ratio: number }): string =>
  `${s.palette} ${s.token} on ${s.ground}: ${s.ratio}`;

describe("text contrast", () => {
  it("paints in the family's palettes, and reads every token", () => {
    expect(Object.keys(palettes).sort()).toEqual(["dark", "default", "light", "parchment", "system-dark"]);
    expect(contrastShortfalls(palettes, TEXT, GROUNDS, TEXT_CONTRAST).unresolved).toEqual([]);
  });

  it("passes AA for every text token on every ground", () => {
    expect(contrastShortfalls(palettes, TEXT, GROUNDS, TEXT_CONTRAST).shortfalls.map(fmt)).toEqual([]);
  });

  it("under Increase Contrast, grey text reaches 5:1 and edges 3:1", () => {
    const high = Object.fromEntries(Object.entries(palettes).map(([n, p]) => [n, withHighContrast(p)]));
    expect(contrastShortfalls(high, ["--muted"], GROUNDS, 5).shortfalls.map(fmt)).toEqual([]);
    expect(contrastShortfalls(high, ["--line", "--line-soft"], GROUNDS, EDGE_CONTRAST).shortfalls.map(fmt)).toEqual([]);
  });
});
