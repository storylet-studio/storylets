// ---------------------------------------------------------------------------
// `storyletengine licences`. The Storylet Engine's own MIT licence, and a line saying where its libraries'
// licences are. A standalone binary embeds those libraries' notices instead; build-standalone.mjs's smoke
// run checks them, since only a standalone build has them. (Patter's CLI does the same.)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { run } from "../src/main.js";

describe("storyletengine licences", () => {
  for (const spelling of ["licences", "licenses"]) {
    it(`prints its own licence (${spelling})`, async () => {
      const out: string[] = [];
      expect(await run([spelling], { log: (l) => out.push(l), error: () => {}, write: () => {} })).toBe(0);
      const text = out.join("\n");
      expect(text).toMatch(/is free software under the MIT License:\n\nMIT License\n\nCopyright \(c\) \d{4} Ian Thomas/);
      expect(text).toContain("Its libraries are in node_modules beside it");
    });
  }
});
