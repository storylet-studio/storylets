// Storyletter's colours are the family's (app-shell's palette.css, since the October 2026 UI review), and every
// palette block there declares its --color-scheme (app-shell's own test holds that). What this file holds is
// Storyletter's side: theme.css loads the palette straight after the grammar, so the app's own sheets come
// later and win, and declares no palette or colour scheme of its own, so nothing here can undo the palette's
// (Linen under a dark OS once drew unticked checkboxes as dark filled squares).
// A source scan, as chrome-scale.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./src/theme.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const imports = [...css.matchAll(/@import "([^"]+)";/g)].map((m) => m[1]!);

describe("Storyletter takes the family palette", () => {
  it("imports the palette straight after the shell's tokens", () => {
    expect(imports.slice(0, 2)).toEqual(["@wildwinter/app-shell/tokens.css", "@wildwinter/app-shell/palette.css"]);
  });

  it("declares no palette, colour, or colour scheme of its own", () => {
    expect(css).not.toMatch(/data-theme/);
    expect(css).not.toMatch(/--(color-scheme|bg|surface|card|ink|muted|line|line-soft|accent|on-accent|accent-soft|danger|warn|ok|char-\d+)\s*:/);
  });
});
