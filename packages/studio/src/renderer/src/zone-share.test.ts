// The zone property sentence follows each property's Shared tick-box (the
// round-3 ruling), with the author's own wording.

import { describe, expect, it } from "vitest";
import { SOLO_SHARE_POINTER, shareLine, zoneShareLine } from "./zone-share.js";

describe("who shares a zone property", () => {
  it("says each guest has their own when it is not shared", () => {
    expect(zoneShareLine(false, false)).toBe("One value for every box. Each guest has their own.");
  });

  it("says every guest shares it when it is", () => {
    expect(zoneShareLine(true, false)).toBe("One value for every box and every guest.");
  });

  it("says only the box half on the Solo rung, unless the property is shared already", () => {
    expect(zoneShareLine(false, true)).toBe("One value for every box.");
    expect(zoneShareLine(true, true)).toBe("One value for every box and every guest.");
  });
});

describe("whose state, on every property row", () => {
  it("says nothing on Solo, one guest, except on a zone", () => {
    for (const scope of ["story", "box", "deck", "hand", "tag"] as const) {
      expect(shareLine(scope, true, true), scope).toBeUndefined();
      expect(shareLine(scope, false, true), scope).toBeUndefined();
    }
    expect(shareLine("zone", false, true)).toBe("One value for every box.");
  });

  it("says who has the value at the Shared world rung, following the tick-box", () => {
    expect(shareLine("story", true, false)).toBe("One value for every guest.");
    expect(shareLine("story", false, false)).toBe("Each guest has their own.");
    expect(shareLine("deck", false, false)).toBe("Each guest has their own.");
    expect(shareLine("hand", false, false)).toBe("One value per hand. Each guest has their own.");
    expect(shareLine("hand", true, false)).toBe("One value per hand, the same for every guest.");
    expect(shareLine("tag", true, false)).toBe("One value per tag, the same for every guest.");
    expect(shareLine("zone", false, false)).toBe(zoneShareLine(false, false));
  });

  it("points Solo at the real setting, and never at anything but the public one", () => {
    expect(SOLO_SHARE_POINTER).toContain("Shared world");
    expect(SOLO_SHARE_POINTER).toContain("Project settings ▸ General");
    expect(SOLO_SHARE_POINTER).not.toMatch(/server|venue|licen[cs]e|commercial/i);
  });
});
