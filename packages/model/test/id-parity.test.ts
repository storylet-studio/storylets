// The address rules exist TWICE on purpose, and this is the belt that keeps the
// two copies honest.
//
// `@wildwinter/app-shell` owns them for the family: the gameId editor is shared,
// and a new app in the collection should get working rules on day one. This
// package owns them for the Node side - the compiler, ops, the CLI and the JS
// runtime shipped to game engines all address content by them, and none of those
// should carry a dependency on a UI kit to do it.
//
// Two copies that agree today drift tomorrow, and the failure would be quiet and
// nasty: the editor accepting a name the compiler then rejects, or a bundle whose
// addresses no longer match the ones a host was written against.
import { describe, expect, it } from "vitest";
import { gameIdify, isValidGameId } from "../src/index.js";
import { gameIdify as shellSlug, isValidGameId as shellValid } from "@wildwinter/app-shell";

/** Enough shapes to catch a rule changing on one side: case, punctuation,
 *  apostrophes, accents, collapsing, trimming, and the empty result. */
const CASES = [
  "Arrive at the Village Gate", "Gareth's Debt", "Gareth’s Debt",
  "  --Hello,   World!!  ", "Ünïcode name", "../../etc/passwd",
  "9 lives", "MiXeD Case 42", "a--b", "---", "!!!", "", "already-fine",
  "trailing-", "-leading", "under_score", "UPPER",
];

describe("the model's address rules match the shell's", () => {
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
