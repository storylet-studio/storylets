// Chrome has its own scale (design-language.md section 4, ruled 2026-09-16):
// the chrome is sized in pixels off a 14px base, never off the root, so a
// reading-size control can never inflate the navigator, inspector, top bar,
// status bars or tool windows. Storyletter has no reading root today, so the
// whole renderer is chrome and no stylesheet in it may use `rem`.
//
// Written as a source scan for the same reason as placeholder-style.test.ts:
// a new `0.85rem` is one token in one file, and it is exactly the kind of
// thing that drifts back without a gate. `em` is left alone on purpose: it
// scales with the element's own font-size, not the root.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("./", import.meta.url).pathname;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return name.endsWith(".css") ? [path] : [];
  });

// A number followed by the unit, not the letters inside a word ("theorem")
// or a custom property name ("--chrome-rem" would be a name, not a length).
const REM = /(?<![\w.-])\d*\.?\d+rem\b/g;

describe("chrome scale", () => {
  it("finds the stylesheets at all (the scan is the test's own load-bearing part)", () => {
    expect(walk(SRC).length).toBeGreaterThan(5);
  });

  it("uses no rem unit anywhere in the renderer stylesheets", () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const m of line.matchAll(REM)) hits.push(`${file.slice(SRC.length)}:${i + 1}: ${m[0]}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("pins the chrome containers at the 14px base", () => {
    const theme = readFileSync(join(SRC, "src/theme.css"), "utf8");
    for (const host of [".topbar", ".pane-nav", ".pane-inspector", ".welcome", ".swin-head", ".stepbar"]) {
      expect(theme).toMatch(new RegExp(`:where\\([^)]*${host.replace(".", "\\.")}[^)]*\\)\\s*\\{\\s*font-size:\\s*14px`));
    }
  });
});
