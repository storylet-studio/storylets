// The address rules are the family's one rule, in `@wildwinter/toolkit` (step 6, Q19): this
// package re-exports the toolkit's, so the compiler, ops, the CLI and the JS runtime shipped to
// game engines address content by exactly what Patter does, with no UI kit behind them.
//
// `@wildwinter/app-shell` exports the rules too, for the shared gameId editor. This is the belt
// that keeps the editor honest: if the two drifted, the editor would accept a name the compiler
// then rejects, or a bundle's addresses would no longer match the ones a host was written against.
import { describe, expect, it } from "vitest";
import { gameIdify, isValidGameId } from "../src/index.js";
import { gameIdify as shellSlug, isValidGameId as shellValid } from "@wildwinter/app-shell";
import { gameIdify as toolkitSlug, isValidGameId as toolkitValid } from "@wildwinter/toolkit";

/** Enough shapes to catch a rule changing on one side: case, punctuation,
 *  apostrophes, accents, collapsing, trimming, and the empty result. */
const CASES = [
  "Arrive at the Village Gate", "Gareth's Debt", "Gareth’s Debt",
  "  --Hello,   World!!  ", "Ünïcode name", "../../etc/passwd",
  "9 lives", "MiXeD Case 42", "a--b", "---", "!!!", "", "already-fine",
  "trailing-", "-leading", "under_score", "UPPER",
];

describe("the model's address rules match the shell's", () => {
  it("are the toolkit's own, re-exported", () => {
    expect(gameIdify).toBe(toolkitSlug);
    expect(isValidGameId).toBe(toolkitValid);
  });

  it("slugifies identically", () => {
    for (const input of CASES) {
      expect(gameIdify(input), `gameIdify(${JSON.stringify(input)})`).toBe(shellSlug(input));
    }
  });

  it("validates identically", () => {
    for (const input of [...CASES, ...CASES.map((c) => gameIdify(c))]) {
      expect(isValidGameId(input), `isValidGameId(${JSON.stringify(input)})`).toBe(shellValid(input));
    }
  });

  it("agrees that a slug is always acceptable, so Tab-to-slugify cannot produce a refusal", () => {
    for (const input of CASES) {
      const slug = gameIdify(input);
      expect(slug === "" || isValidGameId(slug), `${input} -> ${slug}`).toBe(true);
    }
  });
});
