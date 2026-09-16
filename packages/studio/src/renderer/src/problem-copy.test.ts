// The problems bar's voice (problem-copy.ts): every shape the compiler raises
// has a code, every code has a sentence, the sentence names the thing by its
// title, and no bracketed id or path ever reaches the bar.
import { describe, expect, it } from "vitest";
import { PROBLEM_CODES, STORYLETTER_PROBLEM_COPY, danglingId, problemCode, problemText } from "./problem-copy.js";
import type { Problem } from "../../shared/api.js";

const problem = (message: string, over: Partial<Problem> = {}): Problem =>
  ({ severity: "error", path: "encounters/decks/docks.storyletdeck", message, ...over });

/** One real message per compiler shape, the way compile.ts / parse.ts /
 *  play-ladder.ts write it. A shape that changes in the compiler fails here
 *  before it reaches an author as raw text. */
const SAMPLES: Record<string, string> = {
  "unparseable": "unparseable JSON5: JSON5: invalid character '}' at 3:1",
  "not-an-object": "shard must be a JSON5 object",
  "wrong-schema": 'schema tag "storylet-deck@1" is not "storylet-box@1"',
  "project-count": "a project has exactly one *.storyletproj at its root; found 2",
  "box-without-shard": "box folder has no box.storyletbox",
  "stale-view-map": "this project's map lives in the view shard; open it in Storyletter or run `storyletengine format` to move it; the view shard's map is ignored after the next release",
  "stray-file": "unexpected file in decks/ (not *.storyletdeck); ignored",
  "duplicate-id": 'duplicate id "c_1" (also in encounters/decks/street.storyletdeck)',
  "duplicate-gameid": 'duplicate card gameId "ambush" (also in encounters/decks/street.storyletdeck)',
  "invalid-gameid": 'card gameId "Am bush" is not a legal address (lower case letters, digits and hyphens; must start and end with a letter or digit)',
  "address-slash": 'card address "a/b" cannot contain "/" (the slash separates a box from a tag in a property address, as in "value.harbour/docks.danger")',
  "quality-no-stages": 'quality "@box.mood" declares no stages - a quality is its ladder',
  "quality-stage-twice": 'quality "@box.mood" lists stage "calm" twice',
  "quality-bad-default": 'quality "@box.mood" defaults to "furious", which is not one of its stages',
  "reserved-property-name": 'property name "Gold" cannot be used (only lower case). Write it as gold.',
  "world-flag": '@world.raining declares "shared" - @world is the game\'s own state and is always shared across flows; the flag belongs on @story, box, deck, hand or tag properties',
  "hand-property-type-clash": "@hand.mood is declared as number on the template street-hands and as string on the hand the-inn; @hand composes them into one name, so they must agree",
  "turn-seconds": 'turn.seconds must be an integer >= 1 (got "x")',
  "reserved-tag-group": '"place" is the reserved tag group and cannot be declared',
  "duplicate-tag-gameid": 'tag gameId "forest" is used by group "zone"',
  "boundby-not-ref": 'boundBy "zone" must be a @world or @story property reference',
  "boundby-undeclared": 'boundBy "@world.zone" is not a declared world property',
  "boundby-type": 'boundBy "@world.zone" is a number property; a state-bound group needs a string or enum, whose value names one of its tags',
  "boundby-never-matches": 'boundBy "@world.zone" can never name a tag in this group (its values are a, b)',
  "boundby-stray-values": 'boundBy "@world.zone" may hold sea, which name no tag here; the group goes unbound then, so every card in the axis is eligible',
  "tag-property-twice": '"danger" is declared both on the group "zone" and on its tag "forest"; declare it once, on the group if every tag has it',
  "tag-value-undeclared": '"danger" has a value here but the group "zone" declares no such property; a tag sets values, its group declares them',
  "tag-value-type": '"danger" is number on the group, so "high" is not a value it can start at',
  "dangling-place": "place tag points at a hand that is not in this box (id h_9)",
  "dangling-tag-group": "points at a tag group that is not in this box (id g_9)",
  "dangling-tag": 'points at a tag that is not in "zone" (id t_9)',
  "unknown-field": 'field "mood" is not in the box\'s fields',
  "field-type": 'field "mood" does not match its declared type "number"',
  "redraw-string": 'redraw is the string "4", so its cooldown never fires: write it as the number 4',
  "redraw-invalid": 'redraw must be "always", "never" or a whole number of turns (got "soon")',
  "copies": 'copies must be an integer >= 1 (got "x")',
  "shared-copies": 'sharedCopies must be an integer >= 1 (got "x")',
  "shared-copies-below": "sharedCopies (1) is below copies (3): the world cannot hold fewer than one participant may",
  "shared-copies-unused": "sharedCopies is set but the card is not shared, so it does nothing",
  "durable-redraw": 'durable, but its redraw is "always": only "never" means anything past the run, since a cooldown is a turn of a clock that resets with it',
  "change-not-ref": 'change target "gold" is not a property reference (@scope.name)',
  "change-chosen-tag": 'change target "@hand.zone" is the chosen tag of group "zone", which cannot be written: it is what the hand asked for, not state it carries',
  "unknown-property": 'change target "@story.gone" is not a declared property',
  "change-read-only": 'change target "@world.time" is read-only to the story (writable: false): the game owns it, and a condition may read it but an outcome may not write it',
  "durable-deck-idle": 'durable, but nothing in it is spent for good: every card here can be dealt again, and only a redraw of "never" means anything past the run',
  "timed-deck-idle": 'timed, but nothing in it rests: every card here says redraw "always", so no cooldown ever reads the clock',
  "place-from-property": '"place" cannot be filled from a property: it is the hand\'s own name, not an axis',
  "hole-not-ref": '"zone" for "zone" must be a @hand, @world or @story property reference',
  "hole-undeclared": '"@world.zone" for "zone" is not a declared world property',
  "hole-type": '"@world.zone" for "zone" is a number property; a hole filled from a property needs a string or enum, whose value names one of the group\'s tags',
  "hole-never-matches": '"@world.zone" for "zone" can never name a tag in that group (its values are a, b)',
  "hole-stray-values": '"@world.zone" for "zone" may hold sea, which name no tag there; the hole goes unbound then, so every card in the axis is eligible',
  "template-binds-ref": 'binds "@world.zone", a property reference; a template\'s own bindings are the same for every instance, so a hole that moves belongs on the hand',
  "template-binds-and-asks": 'binds "zone" and also asks each hand to choose one: a template can do either, not both',
  "hand-template-or-rule": "a hand carries exactly one of template / rule",
  "dangling-template": "uses a hand template that is not in this box (id tpl_9)",
  "hand-hole-unfilled": 'nothing chosen for the tag group "zone": a hand fills every hole its template declares',
  "hand-choice-unasked": 'chooses a tag for "zone", which the template "street-hands" does not ask for',
  "play-ladder": "this project is set to solo play; the deck “Docks” is shared. Change Play in Project Settings, or drop shared from the deck",
  "driver-ref": "coverage driver ref must name a declared @world property (the host seam is the only drivable scope)",
  "driver-kind": 'coverage driver kind must be "initial" or "recurring"',
  "driver-value-type": 'coverage driver value "wet" does not match the property\'s type "number"',
  "expression": "condition: unknown function 'advanc'",
};

describe("problemCode", () => {
  it("classifies every shape the compiler raises", () => {
    for (const [code, message] of Object.entries(SAMPLES)) expect(problemCode(message), message).toBe(code);
  });

  it("has a sample for every code, and an entry for every code", () => {
    for (const code of PROBLEM_CODES) {
      expect(SAMPLES[code], `sample for ${code}`).toBeDefined();
      expect(STORYLETTER_PROBLEM_COPY[code], `entry for ${code}`).toBeTypeOf("function");
    }
  });

  it("also carries the shell's shared codes", () => {
    for (const code of ["duplicate-gameid", "invalid-gameid", "dangling-reference", "unknown-property", "missing-name", "empty", "stale-build", "merge-conflict"]) {
      expect(STORYLETTER_PROBLEM_COPY[code]).toBeTypeOf("function");
    }
  });

  it("sends an unresolved expression reference to unknown-property, and the rest to expression", () => {
    expect(problemCode("change @story.gold: unresolved story property reference '@story.gold'")).toBe("unknown-property");
    expect(problemCode("condition: unresolved property reference '@gold'")).toBe("unknown-property");
    expect(problemCode("outcome condition: '+' requires a number on the left, got string")).toBe("expression");
  });

  it("does not know a message it has never seen", () => {
    expect(problemCode("something entirely new")).toBeUndefined();
  });
});

describe("problemText", () => {
  it("names the item by its title, in a sentence with a next step", () => {
    expect(problemText(problem(SAMPLES["copies"]!), { title: "Ambush at the ford" }))
      .toBe("“Ambush at the ford”’s copies must be a whole number, at least 1.");
    expect(problemText(problem(SAMPLES["unknown-property"]!), { title: "Flee" }))
      .toBe("“Flee” changes @story.gone, which isn’t set up yet. Declare it in the project settings, or fix the name.");
    expect(problemText(problem(SAMPLES["duplicate-gameid"]!), { title: "Ambush" }))
      .toBe("The Game ID “ambush” on “Ambush” is already used in encounters/decks/street.storyletdeck. Each one must be unique; change one of them.");
  });

  it("speaks for every code without a bracket or a raw compiler tell", () => {
    for (const [code, message] of Object.entries(SAMPLES)) {
      const text = problemText(problem(message, { where: "ambush" }), { title: "Ambush" });
      expect(text, code).not.toContain("[");
      expect(text, code).not.toMatch(/gameId|sharedCopies|boundBy|JSON5 object|>= 1/);
      expect(text, code).toMatch(/[.!)]$/);
    }
  });

  it("shows an id only for a dangling reference, and then the reference's, not the holder's", () => {
    expect(danglingId(SAMPLES["dangling-tag"]!)).toBe("t_9");
    expect(danglingId(SAMPLES["copies"]!)).toBeUndefined();
    const text = problemText(problem(SAMPLES["dangling-tag"]!, { where: "ambush" }), { title: "Ambush" });
    expect(text).toBe("“Ambush” points at a tag that’s no longer in “zone” (id t_9). Pick one of the group’s tags.");
    expect(text).not.toContain("ambush");
    const untitled = problemText(problem(SAMPLES["dangling-template"]!, { where: "the-inn" }));
    expect(untitled).toBe("This uses a hand template that’s no longer in this box (id tpl_9). Choose a template.");
    // A titled, non-dangling problem never shows its holder's id.
    expect(problemText(problem(SAMPLES["field-type"]!, { where: "ambush" }), { title: "Ambush" })).not.toContain("(id");
  });

  it("falls back to the raw message, titled, with the [where] tail stripped", () => {
    expect(problemText(problem("something entirely new [ambush]"), { title: "Ambush" })).toBe("Ambush: something entirely new");
    expect(problemText(problem("something entirely new"))).toBe("something entirely new");
  });

  it("says what the expression validator said, on the field the editor names", () => {
    expect(problemText(problem("deck gate: unknown function 'advanc'"), { title: "Docks" }))
      .toBe("“Docks”’s gate doesn’t hold up: unknown function 'advanc'. Open it in the expression editor.");
    expect(problemText(problem("hand condition: unresolved world property reference '@world.zone'"), { title: "The Inn" }))
      .toBe("“The Inn”’s rule uses @world.zone, which isn’t set up yet. Declare it in the project settings, or fix the name.");
  });
});
