// Main's refusals as the toast says them (the Patterpad review, 2026-10-07):
// a capital and a full stop, as Patterpad's landed() says its own.
import { describe, expect, it } from "vitest";
import { sentence } from "./results.js";

describe("sentence", () => {
  it("capitalises a fragment and stops it", () => {
    expect(sentence("no project open")).toBe("No project open.");
    expect(sentence("that card isn't in the project any more")).toBe("That card isn't in the project any more.");
  });

  it("leaves a sentence as it is", () => {
    expect(sentence("This project already shares its scopes.")).toBe("This project already shares its scopes.");
    expect(sentence("Is the server running?")).toBe("Is the server running?");
  });

  it("keeps the case of a file name or an address that opens it", () => {
    expect(sentence("storylets.server.json is not valid JSON")).toBe("storylets.server.json is not valid JSON.");
    expect(sentence("@story.hour is read-only")).toBe("@story.hour is read-only.");
  });

  it("stops a sentence that ends in a bracket", () => {
    expect(sentence("not while the project uses it (Hands)")).toBe("Not while the project uses it (Hands).");
  });
});
