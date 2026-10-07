// @vitest-environment jsdom
// Which shard the OPEN document writes, and whether it is the shape (vc-view.ts):
// the two questions the read-only guard and the topbar chip ask of where the
// author is standing.

import { describe, expect, it } from "vitest";
import { docIsShape, docVcKeys } from "./vc-view.js";

describe("the open document's shard", () => {
  it("is the deck's for a card or a deck, the box's own shards for setup", () => {
    expect(docVcKeys({ kind: "deck", box: "b", deck: "k" }, { kind: "card", box: "b", deck: "k", card: "c" })).toBe("deck:k");
    expect(docVcKeys({ kind: "deck", box: "b", deck: "k" }, { kind: "deck", box: "b", deck: "k" })).toBe("deck:k");
    expect(docVcKeys({ kind: "box", box: "b" }, { kind: "template", box: "b", template: "t" })).toBe("hands:b");
    expect(docVcKeys({ kind: "hands", box: "b" }, { kind: "hand", box: "b", hand: "h" })).toBe("hands:b");
    expect(docVcKeys({ kind: "box", box: "b" }, { kind: "tagGroup", box: "b", group: "g" })).toBe("tags:b");
  });

  it("is the page's own for a page, and none for one that edits nothing itself", () => {
    expect(docVcKeys({ kind: "box", box: "b" }, { kind: "box", box: "b" })).toBe("box:b");
    expect(docVcKeys({ kind: "hands", box: "b" }, undefined)).toBe("hands:b");
    expect(docVcKeys({ kind: "project" }, undefined)).toBe("project");
    expect(docVcKeys({ kind: "decks", box: "b" }, undefined)).toBeUndefined();
    expect(docVcKeys({ kind: "story" }, undefined)).toBeUndefined();
    expect(docVcKeys(undefined, undefined)).toBeUndefined();
  });
});

describe("whether the open document is the shape", () => {
  it("leaves cards and decks to the writer", () => {
    expect(docIsShape({ kind: "deck", box: "b", deck: "k" }, { kind: "card", box: "b", deck: "k", card: "c" })).toBe(false);
    expect(docIsShape({ kind: "deck", box: "b", deck: "k" }, { kind: "deck", box: "b", deck: "k" })).toBe(false);
  });

  it("reads setup items, the box, its hands and the project page as the shape", () => {
    expect(docIsShape({ kind: "box", box: "b" }, { kind: "template", box: "b", template: "t" })).toBe(true);
    expect(docIsShape({ kind: "hands", box: "b" }, { kind: "hand", box: "b", hand: "h" })).toBe(true);
    expect(docIsShape({ kind: "box", box: "b" }, { kind: "tagGroup", box: "b", group: "g" })).toBe(true);
    expect(docIsShape({ kind: "box", box: "b" }, { kind: "box", box: "b" })).toBe(true);
    expect(docIsShape({ kind: "hands", box: "b" }, undefined)).toBe(true);
    expect(docIsShape({ kind: "project" }, undefined)).toBe(true);
    expect(docIsShape({ kind: "story" }, undefined)).toBe(false);
    expect(docIsShape(undefined, undefined)).toBe(false);
  });
});
