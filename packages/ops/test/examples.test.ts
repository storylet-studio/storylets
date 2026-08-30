// The shipped examples compile clean, all of them, every time.
//
// They are the first thing anybody opens - the welcome screen offers all three
// and the Village is the one the sample client plays - so an example with an
// error in it is a broken first impression rather than a broken test.
//
// This is here because of a real one. The Village carried sixteen cards whose
// `redraw` was the STRING "4" rather than the number 4, from its port out of
// the old system. `redraw` is "always" | "never" | number, so a digit string
// matched neither branch in the engine: no cooldown was ever recorded and
// every one of those cards behaved as `redraw: always`. Nothing said a word.
// It surfaced in play, in the browser client, as the same card being dealt
// twice in a row (the author, 2026-08-30).
//
// The compiler REFUSES that now, which is what makes this test worth having:
// the rule and the check on the shipped content have to arrive together, or
// the rule only applies to projects nobody has written yet.

import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadProject } from "../src/load.js";
import { runValidate } from "../src/validate.js";
import { reachabilityIssues } from "../src/reachability.js";

const examples = fileURLToPath(new URL("../../../examples", import.meta.url));

const projects = readdirSync(examples)
  .filter((name) => name.endsWith(".storylets") && statSync(join(examples, name)).isDirectory());

describe("the shipped examples", () => {
  it("are all found (a rename must break this, not silently empty it)", () => {
    expect(projects.length).toBeGreaterThanOrEqual(3);
    expect(projects).toContain("the-village.storylets");
  });

  // Reachability is a WARNING, so it does not fail the compile check above.
  // It is held separately and just as hard: a shipped example is the first
  // thing anybody opens, and a card that can never be dealt in one is a
  // teaching surface teaching the wrong thing.
  //
  // This is here rather than in reachability.test.ts on purpose. That suite
  // pins the CHECK, with synthetic cases that never move; this pins the
  // CONTENT. Asserting a specific fault in a specific example, as the first
  // cut did, breaks the moment the author fixes it - which is exactly what
  // happened, the same afternoon, to the Village's Expose the Conspiracy.
  it.each(projects)("%s has no unreachable conditions", (name) => {
    const source = loadProject(join(examples, name)).source;
    expect(source).toBeDefined();
    expect(reachabilityIssues(source!).map((i) => `${i.where}: ${i.message}`)).toEqual([]);
  });

  it.each(projects)("%s compiles with no errors", (name) => {
    // `checkBundle: false` - whether the committed dist/ bundle is in step is a
    // different question from whether the SOURCE is sound, and the answer to it
    // is "rebuild", not "the example is broken".
    const issues = runValidate(loadProject(join(examples, name)), { checkBundle: false }).issues;
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
