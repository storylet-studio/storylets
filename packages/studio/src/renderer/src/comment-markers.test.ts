// Where a marker SITS: the one piece of arithmetic in the marker layer, and the
// place the two anchor kinds differ (design/annotation.md 3). Drawing and
// gestures need a stage and belong to the interactive pass; this is the part a
// test can hold still.
import { describe, expect, it } from "vitest";
import { markerPoint } from "./comment-markers.js";
import type { CommentMarkerDto } from "../../shared/api.js";

type Item = { id: string; x: number; y: number; width: number; height: number };

const items: Item[] = [
  { id: "c_gate", x: 100, y: 200, width: 180, height: 90 },
];
const at = (id: string): Item | undefined => items.find((i) => i.id === id);

const marker = (over: Partial<CommentMarkerDto>): CommentMarkerDto =>
  ({ id: "cmt_1", x: 0, y: 0, open: 1, gist: "", author: "Ada", ...over });

describe("where a marker sits", () => {
  it("a canvas marker is at its own coordinates", () => {
    expect(markerPoint(marker({ x: 40, y: 60 }), at)).toEqual({ x: 40, y: 60 });
  });

  it("an item marker is its item's origin plus the offset", () => {
    // The offset is what preserves where an author put it RELATIVE to the card,
    // so it keeps sitting beside the thing rather than jumping onto it.
    expect(markerPoint(marker({ x: 12, y: -8, item: "c_gate" }), at))
      .toEqual({ x: 112, y: 192 });
  });

  it("follows its item, because the position is read live", () => {
    const m = marker({ x: 12, y: -8, item: "c_gate" });
    items[0]!.x = 500;
    expect(markerPoint(m, at)).toEqual({ x: 512, y: 192 });
    items[0]!.x = 100;
  });

  it("is not drawn when its item has gone", () => {
    // The THREAD survives: it is still on that item's editor if the item comes
    // back, and undo restores both together. Only the marker is absent.
    expect(markerPoint(marker({ x: 0, y: 0, item: "c_deleted" }), at)).toBeUndefined();
  });

  it("a negative offset is honoured, so a marker can sit above and left", () => {
    expect(markerPoint(marker({ x: -20, y: -20, item: "c_gate" }), at))
      .toEqual({ x: 80, y: 180 });
  });
});
