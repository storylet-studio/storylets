// The tab memory is keyed by PAGE TYPE, not by document (the author's ruling,
// 2026-08-28): picking Outcomes on one card and moving to another card - by
// any road - is usually a comparison, so the choice follows the author across
// matching page types. Expectations hand-written from the ruling.
import { beforeEach, describe, expect, it } from "vitest";
import { currentDocTab, docTabFor, setDocTab } from "./doc-tab-memory.js";

// Module state persists across tests in one file: reset by walking the types
// this file touches back to a known tab is not possible (no delete API, on
// purpose - the session never forgets a choice), so each test uses its own
// type namespace instead.
let n = 0;
let t = "";
beforeEach(() => { t = `type${n++}`; });

describe("doc tab memory (type-level)", () => {
  it("answers the default until the type has ever been switched", () => {
    expect(currentDocTab(`${t}:a`, "dealing")).toBe("dealing");
    expect(docTabFor(`${t}:a`)).toBeUndefined();
  });

  it("a choice on one document answers for every document of the type", () => {
    setDocTab(`${t}:arrival/c_gate`, "outcomes");
    expect(currentDocTab(`${t}:calling/c_tree`, "dealing")).toBe("outcomes");
    expect(docTabFor(`${t}:anything`)).toBe("outcomes");
  });

  it("the most recent choice wins, wherever it was made", () => {
    setDocTab(`${t}:a`, "outcomes");
    setDocTab(`${t}:b`, "fields");
    expect(currentDocTab(`${t}:a`, "dealing")).toBe("fields");
  });

  it("types do not leak into each other", () => {
    setDocTab(`${t}:a`, "outcomes");
    expect(currentDocTab(`other${t}:a`, "cards")).toBe("cards");
  });
});
