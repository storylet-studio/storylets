// The zone property sentence follows each property's Shared tick-box (the
// round-3 ruling), with the author's own wording.

import { describe, expect, it } from "vitest";
import { zoneShareLine } from "./zone-share.js";

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
