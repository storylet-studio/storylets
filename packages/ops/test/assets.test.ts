// ---------------------------------------------------------------------------
// Where a box's binary assets live, and the containment rule that guards them.
//
// The rule exists because an asset's name arrives from a SHARD, which is
// untrusted input: a pack, a merge or a hand edit can put anything in that
// field, and `join(dir, name)` with "../../../.ssh/id_rsa" resolves happily.
// Same lesson the unpack path learnt; pinned here so it cannot be un-learnt.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from "vitest";
import type { SourceBox } from "@storylet-studio/compiler";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSETS_DIR, assetPath, assetUse, freeAssetName, imageSize, isSafeAssetName, orphanAssetPaths,
} from "../src/assets.js";

const box = { path: "village" } as unknown as SourceBox;

describe("resolving an asset", () => {
  it("puts it in the box's own assets folder", () => {
    expect(assetPath("/p", box, "site-plan.png")).toBe(`/p/village/${ASSETS_DIR}/site-plan.png`);
  });

  it("refuses anything that is not a plain file name", () => {
    for (const bad of [
      "../secrets.png", "../../etc/passwd", "sub/dir.png", "sub\\dir.png",
      "/absolute.png", "C:/windows.png", ".hidden", "", "with\0null",
      "CON", "nul.png", "lpt1.txt",
    ]) {
      expect(isSafeAssetName(bad)).toBe(false);
      expect(assetPath("/p", box, bad)).toBeUndefined();
    }
  });

  it("allows the names people actually use", () => {
    for (const good of ["site-plan.png", "Ground Floor.jpg", "map_2.webp", "plan.v2.png", "café.png"]) {
      expect(isSafeAssetName(good)).toBe(true);
    }
  });

  it("refuses a name long enough to break a filesystem", () => {
    expect(isSafeAssetName(`${"a".repeat(256)}.png`)).toBe(false);
  });
});

describe("naming an import", () => {
  it("keeps the name it came with when nothing else has it", () => {
    expect(freeAssetName("plan.png", new Set())).toBe("plan.png");
  });

  it("suffixes rather than replacing a picture somebody is still using", () => {
    expect(freeAssetName("plan.png", new Set(["plan.png"]))).toBe("plan-2.png");
    expect(freeAssetName("plan.png", new Set(["plan.png", "plan-2.png"]))).toBe("plan-3.png");
  });

  it("keeps the extension where an extension belongs", () => {
    expect(freeAssetName("archive.tar.gz", new Set(["archive.tar.gz"]))).toBe("archive.tar-2.gz");
    expect(freeAssetName("noextension", new Set(["noextension"]))).toBe("noextension-2");
  });
});

describe("an image's size, from its header", () => {
  // Main reads this so a dropped picture is placed in ONE act. Tested against
  // REAL files wherever there is one to hand: a hand-written header proves the
  // parser reads what I wrote, not what an encoder writes.

  it("reads a real PNG, including a 2816-wide one", () => {
    // The site plan in dev/local when there is one (gitignored, so skipped in CI);
    // otherwise the repo's own PNGs, which are real encoder output either way.
    const local = fileURLToPath(new URL("../../studio/dev/local/site.png", import.meta.url));
    if (existsSync(local)) {
      expect(imageSize(readFileSync(local))).toEqual({ width: 2816, height: 1536 });
    }
    const icon = fileURLToPath(new URL("../../studio/build/icon.png", import.meta.url));
    if (existsSync(icon)) {
      const size = imageSize(readFileSync(icon));
      expect(size?.width).toBeGreaterThan(0);
      expect(size?.height).toBe(size?.width);   // an app icon is square
    }
  });

  it("reads a PNG whose dimensions are written where the spec says", () => {
    const png = Buffer.alloc(30);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.writeUInt32BE(1920, 16);
    png.writeUInt32BE(1080, 20);
    expect(imageSize(png)).toEqual({ width: 1920, height: 1080 });
  });

  it("walks a JPEG past its EXIF to the frame", () => {
    // The case that catches a naive parser: a phone photo has kilobytes of APP1
    // before the only place the size is written.
    const exif = 2000;
    const jpeg = Buffer.alloc(2 + 4 + exif + 12);
    let i = 0;
    jpeg.writeUInt16BE(0xffd8, i); i += 2;             // SOI
    jpeg.writeUInt16BE(0xffe1, i); i += 2;             // APP1
    jpeg.writeUInt16BE(exif + 2, i); i += 2 + exif;    // its length, then its payload
    jpeg.writeUInt16BE(0xffc0, i); i += 2;             // SOF0
    jpeg.writeUInt16BE(11, i); i += 2;
    jpeg.writeUInt8(8, i); i += 1;                     // precision
    jpeg.writeUInt16BE(768, i); i += 2;                // height FIRST, in JPEG
    jpeg.writeUInt16BE(1024, i);
    expect(imageSize(jpeg)).toEqual({ width: 1024, height: 768 });
  });

  it("reads a GIF and each flavour of WebP", () => {
    const gif = Buffer.from("474946383961", "hex");
    const gifFull = Buffer.concat([gif, Buffer.alloc(8)]);
    gifFull.writeUInt16LE(640, 6);
    gifFull.writeUInt16LE(480, 8);
    expect(imageSize(gifFull)).toEqual({ width: 640, height: 480 });

    const webp = Buffer.alloc(40);
    webp.write("RIFF", 0); webp.write("WEBP", 8); webp.write("VP8X", 12);
    webp.writeUIntLE(1599, 24, 3);   // stored as one less
    webp.writeUIntLE(899, 27, 3);
    expect(imageSize(webp)).toEqual({ width: 1600, height: 900 });
  });

  it("says nothing rather than guessing, for a file it cannot measure", () => {
    // Undefined is not a refusal: the picture still imports, it just gets a
    // square placement. A format we cannot measure is a bad reason to reject
    // somebody's map.
    expect(imageSize(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeUndefined();
    expect(imageSize(Buffer.alloc(0))).toBeUndefined();
    expect(imageSize(Buffer.from("not an image at all"))).toBeUndefined();
    // A truncated JPEG must stop, not spin.
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00, 0xff]))).toBeUndefined();
  });
});

describe("orphans: files no map uses", () => {
  // Ordinary work makes these, which is why they are reported rather than acted
  // on: undoing an import keeps the file on purpose, and so does removing a
  // background. An undo that deleted somebody's only site plan would be worse
  // than any amount of tidying.
  const box = (groups: unknown[]): SourceBox => ({
    path: "village",
    tags: { schema: "storylets/tags@0", groups },
  } as unknown as SourceBox);

  const mapWith = (...files: string[]): unknown => ({
    id: "d_zone", gameId: "zone", tags: [],
    templates: {
      spatial: {
        map: true,
        backgrounds: files.map((file, i) => ({ id: `g_${i}`, file, x: 0, y: 0, width: 10, height: 10 })),
      },
    },
  });

  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "orphans-"));
    mkdirSync(join(dir, "village", ASSETS_DIR), { recursive: true });
    for (const name of ["used.png", "also-used.jpg", "left-over.png"]) {
      writeFileSync(join(dir, "village", ASSETS_DIR, name), "bytes");
    }
  });

  it("tells used from unused", () => {
    const use = assetUse(dir, box([mapWith("used.png", "also-used.jpg")]));
    expect(use.used).toEqual(["also-used.jpg", "used.png"]);
    expect(use.orphans).toEqual(["left-over.png"]);
  });

  it("counts a file referenced by ANY of the box's groups as used", () => {
    const use = assetUse(dir, box([mapWith("used.png"), mapWith("left-over.png")]));
    expect(use.orphans).toEqual(["also-used.jpg"]);
  });

  it("treats everything as an orphan when no map uses anything", () => {
    const use = assetUse(dir, box([]));
    expect(use.used).toEqual([]);
    expect(use.orphans).toHaveLength(3);
  });

  it("says nothing about a box with no assets folder, which is the normal state", () => {
    const empty = mkdtempSync(join(tmpdir(), "orphans-none-"));
    expect(assetUse(empty, box([mapWith("used.png")]))).toEqual({ used: [], orphans: [] });
  });

  it("ignores dotfiles, which are the filesystem's business and not ours", () => {
    writeFileSync(join(dir, "village", ASSETS_DIR, ".DS_Store"), "junk");
    expect(assetUse(dir, box([mapWith("used.png")])).orphans).not.toContain(".DS_Store");
  });

  it("does not call a PLACED picture an orphan just because the file is gone", () => {
    // A pack that travelled without its assets leaves exactly this: an entry
    // whose file is missing. That is validation's warning to give, not a tidy's.
    const use = assetUse(dir, box([mapWith("used.png", "never-arrived.png")]));
    expect(use.orphans).toEqual(["also-used.jpg", "left-over.png"]);
    expect(use.used).toEqual(["used.png"]);
  });
});

describe("sweeping orphans", () => {
  // They are OURS to delete: the project folder is internal, import copied the
  // file from somewhere else, and version control has the history. The one reason
  // to keep an orphan is the live undo chain, which is why the studio sweeps at
  // the end of a session rather than mid-work.
  it("names every orphan in the project, and nothing that is used", () => {
    const dir = mkdtempSync(join(tmpdir(), "sweep-"));
    for (const box of ["village", "castle"]) {
      mkdirSync(join(dir, box, ASSETS_DIR), { recursive: true });
      writeFileSync(join(dir, box, ASSETS_DIR, "used.png"), "bytes");
      writeFileSync(join(dir, box, ASSETS_DIR, "dropped.png"), "bytes");
    }
    const boxes = ["village", "castle"].map((path) => ({
      path,
      tags: {
        schema: "storylets/tags@0",
        groups: [{
          id: "d_zone", gameId: "zone", tags: [],
          templates: { spatial: { map: true, backgrounds: [{ id: "g_1", file: "used.png", x: 0, y: 0, width: 1, height: 1 }] } },
        }],
      },
    })) as unknown as SourceBox[];

    expect(orphanAssetPaths(dir, boxes)).toEqual([
      join(dir, "castle", ASSETS_DIR, "dropped.png"),
      join(dir, "village", ASSETS_DIR, "dropped.png"),
    ]);
  });

  it("finds nothing in a project with no pictures at all", () => {
    const dir = mkdtempSync(join(tmpdir(), "sweep-none-"));
    expect(orphanAssetPaths(dir, [{ path: "village", tags: { groups: [] } } as unknown as SourceBox])).toEqual([]);
  });
});
