// Finding Patterpad for Edit Scene in Patterpad. The platform is passed in, so
// what each one looks for is tested here without Spotlight or a real install.

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPatterpad, patterpadExecutable } from "./patterpad.js";

describe("findPatterpad", () => {
  it("runs the executable inside a macOS app bundle, never the bundle itself", () => {
    expect(patterpadExecutable("/Applications/Patterpad.app", "darwin")).toBe("/Applications/Patterpad.app/Contents/MacOS/Patterpad");
    expect(patterpadExecutable("C:\\Apps\\Patterpad.exe", "win32")).toBe("C:\\Apps\\Patterpad.exe");
  });

  it("takes the place the author pointed at, when something is there", () => {
    const dir = mkdtempSync(join(tmpdir(), "patterpad-"));
    const app = join(dir, "Patterpad.app");
    mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
    writeFileSync(join(app, "Contents", "MacOS", "Patterpad"), "");
    expect(findPatterpad(app, "darwin")).toBe(join(app, "Contents", "MacOS", "Patterpad"));
    const image = join(dir, "Patterpad.AppImage");
    writeFileSync(image, "");
    expect(findPatterpad(image, "linux")).toBe(image);
  });

  it("finds nothing on Linux unless pointed at, since an AppImage lives wherever it was saved", () => {
    expect(findPatterpad(undefined, "linux")).toBeUndefined();
    expect(findPatterpad(join(tmpdir(), "no-such-patterpad"), "linux")).toBeUndefined();
  });
});
