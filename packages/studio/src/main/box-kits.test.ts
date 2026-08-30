// The kit list is one list, and the picker has to show all of it.
//
// `BOX_KITS` in ops is the source: the type derives from it, and the CLI
// validates and prints its usage from it. The editor's picker cannot IMPORT it
// - the renderer would pull ops, and node, into its bundle - so it carries the
// ids alongside a name and a blurb, and this holds the two together.
//
// It is here because the list has already drifted twice: withdrawing `barks`
// was a four-file edit, and the CLI's usage line still offered two kits of
// three afterwards. A picker silently missing a kit is the same failure with
// no error to notice.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BOX_KITS } from "@storylet-studio/ops";

describe("the box kit picker", () => {
  it("offers exactly the kits ops defines", () => {
    const renderer = readFileSync(
      fileURLToPath(new URL("../renderer/src/renderer.ts", import.meta.url)), "utf8");
    // The picker's block, so a `kits:` array elsewhere in the file cannot stand in.
    const start = renderer.indexOf("function openBoxKitPicker");
    expect(start, "openBoxKitPicker not found - has it been renamed?").toBeGreaterThan(-1);
    const block = renderer.slice(start, renderer.indexOf("\n}", start));
    const offered = [...block.matchAll(/\{\s*id:\s*"([a-z-]+)"/g)].map((m) => m[1]!);

    expect(offered, "the New Box picker and ops' BOX_KITS have drifted")
      .toEqual([...BOX_KITS]);
  });

  it("gives every kit a name and a blurb", () => {
    // A kit with no blurb is a card an author cannot choose between.
    const renderer = readFileSync(
      fileURLToPath(new URL("../renderer/src/renderer.ts", import.meta.url)), "utf8");
    const start = renderer.indexOf("function openBoxKitPicker");
    const block = renderer.slice(start, renderer.indexOf("\n}", start));
    const entries = [...block.matchAll(/\{\s*id:\s*"([a-z-]+)",\s*name:\s*"([^"]+)",\s*blurb:\s*"([^"]{20,})"/g)];
    expect(entries.length).toBe(BOX_KITS.length);
  });
});
