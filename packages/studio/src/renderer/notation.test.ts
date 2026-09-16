// Typed notation is drawn now (design-language.md section 4, "Icons are
// drawn, and so are separators" and "One casing rule, and platform-true key
// hints", both 2026-09-16): metadata goes through the shell's `metaLine`, a
// trail through `breadcrumb`, a key hint through `keyLabel` / `tipWithKey` /
// `keyHint`, and the journal's "becomes" through the icon vocabulary. None of
// the glyphs below may be typed into a string the renderer shows again.
//
// A source scan, like chrome-scale.test.ts and for the same reason: the Find,
// Coverage and Board windows mount at import, so their rows cannot be built in
// a unit test, and a new `" · "` is one token in one file. Comments are
// skipped; the multiplication sign in "dealt 3×" is notation and allowed; the
// arrow in an ASCII text export ("->") is not a glyph.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../", import.meta.url).pathname;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|html)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });

/** Source with its comments blanked, so a comment may still say "·" to
 *  explain why the code no longer does. */
const withoutComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (_m, lead: string) => lead);

const TYPED: [RegExp, string][] = [
  [/ · /, "a middle-dot separator (use metaLine)"],
  [/ › /, "a typed chevron trail (use breadcrumb)"],
  [/↑↓|↵|\(↑\)|\(↓\)/, "a typed key glyph (use keyHint / tipWithKey)"],
  [/⌘/, "a Mac-only modifier glyph (use keyLabel / tipWithKey)"],
  [/Cmd\+/, "a hard-coded Cmd combo in a label (use keyLabel / tipWithKey)"],
  [/\((Esc|Enter|Home|F\d{1,2}|Shift\+F\d{1,2})\)/, "a key typed into a tooltip (use tipWithKey)"],
  [/→/, "a typed arrow (use iconNode(\"arrowRight\"))"],
];

describe("typed notation", () => {
  const files = [...walk(join(ROOT, "renderer")), ...walk(join(ROOT, "main")), ...walk(join(ROOT, "shared"))];

  it("finds the sources at all", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("is never typed into a string the renderer shows", () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = withoutComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        for (const [re, why] of TYPED) {
          if (re.test(line)) hits.push(`${file.slice(ROOT.length)}:${i + 1}: ${why}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it("draws the separator and the chevron from CSS and the icon set, not from a symbol font", () => {
    // The stylesheets may not type them either: a `content: "·"` is the same
    // glyph one file over.
    const css = readdirSync(join(ROOT, "renderer"), { recursive: true })
      .map(String).filter((n) => n.endsWith(".css")).map((n) => join(ROOT, "renderer", n));
    const hits: string[] = [];
    for (const file of css) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/content:\s*"[^"]*(·|›|→|\\00b7|\\203a|\\2192)/i.test(line)) hits.push(`${file.slice(ROOT.length)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
