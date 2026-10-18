// Every page carries the family's content security policy (app-shell window-guard.ts `familyCsp`), with only
// the additions its page needs: a page added without one, or with a policy of its own, fails here
// (patterkit design/family-parity-2026-10.md item 12).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cspOfPage, familyCsp } from "@wildwinter/app-shell/window-guard";

const ASSETS = { "img-src": ["storylet-asset:"] };
const EXPECTED: Record<string, string> = {
  "index.html": familyCsp(ASSETS),
  // The table window talks to the live link host on its fixed local port.
  "table.html": familyCsp({ ...ASSETS, "connect-src": ["ws://127.0.0.1:4471"] }),
  "coverage.html": familyCsp(),
  "links.html": familyCsp(),
  "search.html": familyCsp(),
};

describe("each page's content security policy", () => {
  const pages = readdirSync(import.meta.dirname).filter((f) => f.endsWith(".html"));
  it("covers every page", () => { expect(pages.sort()).toEqual(Object.keys(EXPECTED).sort()); });
  for (const page of pages) {
    it(`${page} carries the family's policy`, () => {
      expect(cspOfPage(readFileSync(join(import.meta.dirname, page), "utf8"))).toBe(EXPECTED[page]);
    });
  }
});
