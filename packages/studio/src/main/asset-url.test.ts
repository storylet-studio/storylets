// A picture's URL carries its file's modified time, so a picture replaced on
// disk under the same name is fetched afresh by the renderers' URL-keyed caches
// (Storyletter review 2026-10, canvas item 6).
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assetUrl } from "../shared/api.js";
import { stampedAssetUrl } from "./mutate.js";

describe("a picture's URL", () => {
  it("is stamped with its file's modified time, and changes when the file does", () => {
    const dir = mkdtempSync(join(tmpdir(), "asset-url-"));
    const full = join(dir, "plan.jpg");
    writeFileSync(full, "a");
    utimesSync(full, 1000, 1000);
    const first = stampedAssetUrl("box", "plan.jpg", full);
    expect(first).toBe(`${assetUrl("box", "plan.jpg")}?v=1000000`);
    utimesSync(full, 2000, 2000);
    expect(stampedAssetUrl("box", "plan.jpg", full)).not.toBe(first);
  });

  it("is left plain for a missing file or a name refused as unsafe", () => {
    expect(stampedAssetUrl("box", "gone.jpg", join(tmpdir(), "no-such-file.jpg"))).toBe(assetUrl("box", "gone.jpg"));
    expect(stampedAssetUrl("box", "../x.jpg", undefined)).toBe(assetUrl("box", "../x.jpg"));
  });
});
