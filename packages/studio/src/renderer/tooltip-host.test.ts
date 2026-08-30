// ---------------------------------------------------------------------------
// Every renderer mounts the tooltip host, and none of these calls is redundant.
//
// app-shell 0.28.0 made `el` self-mount whenever it sets a tip, which makes the
// five explicit `initTooltips()` calls in this app look like leftovers. They are
// not. We set `data-tip` BY HAND in places that involve no shell component at all
// (card-open.ts's chip, renderer.ts's health chip), and nothing mounts on their
// behalf - so a window that lost its call would have live tips in the parts built
// through `el` and dead ones everywhere else, which is the worst of the three
// possible states because it looks like it works.
//
// The shell ships a dev-mode warning for exactly this, and it is the right shape,
// but it fires at RUNTIME in a window somebody has opened. A tool window nobody
// happened to open during a session would keep its dead tips all the way to a
// release. This is the same guard at build time, and it costs one grep.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));

/** Every renderer entry point: the editor, and one per tool window. Discovered
 *  rather than listed, so a window added tomorrow is covered the day it appears
 *  (the same lesson as the tsconfig include: name the parent, not the children). */
function entryPoints(): { name: string; source: string }[] {
  const out: { name: string; source: string }[] = [];
  for (const html of readdirSync(here).filter((f) => f.endsWith(".html"))) {
    const page = readFileSync(join(here, html), "utf8");
    // <script type="module" src="./src/renderer.ts"> and friends.
    const src = /src="\.\/([^"]+\.ts)"/.exec(page)?.[1];
    if (src) out.push({ name: html, source: code(readFileSync(join(here, src), "utf8")) });
  }
  return out;
}

/**
 * Source with comments stripped, so a call that has been COMMENTED OUT does not
 * satisfy the checks below.
 *
 * The Patter side found this hole by probing their copy of this guard the way we
 * probe ours: `// initTooltips();` contains `initTooltips(`, so the guard stayed
 * green on the exact edit it exists to catch. Commenting a line out is a likelier
 * way to lose it than deleting it - it is what a bisect leaves behind and what a
 * hurried revert forgets - so the guard has to read past comments.
 *
 * Crude on purpose: it only has to be right about `initTooltips(` calls, not
 * about parsing TypeScript, so a `//` inside a string literal is a trade worth
 * making (patterkit to-storylets, tooltip-guard-matches-comments).
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\n]*?\/\/.*$/gm, (line) => (line.includes("//") ? line.slice(0, line.indexOf("//")) : line));
}

describe("the tooltip host", () => {
  it("is mounted by every renderer, and there is more than one of them", () => {
    const entries = entryPoints();
    expect(entries.length).toBeGreaterThanOrEqual(5);   // the editor plus four tool windows
    for (const { name, source } of entries) {
      expect(source, `${name} never calls initTooltips(), so its hand-set data-tips are dead`)
        .toMatch(/initTooltips\(/);
    }
  });

  it("mounts it BARE, so nothing claims the options", () => {
    // 0.28.0's other half: options used to be "first call wins" and are now "the
    // last explicit call wins". We pass none today; if a `suppressed` predicate
    // is ever added, it must be the app that passes it, from one place.
    for (const { name, source } of entryPoints()) {
      const calls = [...source.matchAll(/initTooltips\(([^)]*)\)/g)].map((m) => m[1]!.trim());
      expect(calls.filter((c) => c !== ""), `${name} passes tooltip options`).toEqual([]);
    }
  });
});
