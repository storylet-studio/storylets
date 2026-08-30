// Native OPEN dialogs say what they are for, enforced rather than remembered.
//
// The bug this came from, 2026-08-30: clicking a worked example on the welcome
// screen popped a folder chooser with no explanation. The handler DID set a
// title - "Where should your copy of the example go?" - but macOS open panels
// IGNORE `title`. The line macOS actually renders is `message`, and the button
// says "Open" unless `buttonLabel` names the act. So the dialog carried its
// whole explanation in the one field nobody sees.
//
// Patterpad's convention (patterpad main/index.ts: Open a Patter project, Open
// a Patterpack, the merge pair, New Project) is title + message + buttonLabel
// on every open dialog. This holds us to it. SAVE dialogs are deliberately out
// of scope in both apps: a save panel shows a filename field and the extension
// filter, which already say what is about to happen.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

/** Each `showOpenDialog(...)` call's options block, with the line it starts on. */
function openDialogs(): { line: number; body: string }[] {
  const found: { line: number; body: string }[] = [];
  const marker = "showOpenDialog(";
  for (let at = SOURCE.indexOf(marker); at !== -1; at = SOURCE.indexOf(marker, at + 1)) {
    const brace = SOURCE.indexOf("{", at);
    // Walk to the matching close, so a nested object (filters) does not end it early.
    let depth = 0;
    let end = brace;
    for (; end < SOURCE.length; end++) {
      if (SOURCE[end] === "{") depth++;
      else if (SOURCE[end] === "}" && --depth === 0) break;
    }
    found.push({ line: SOURCE.slice(0, at).split("\n").length, body: SOURCE.slice(brace, end + 1) });
  }
  return found;
}

describe("native open dialogs", () => {
  it("are found at all (a rename must break this test, not silently empty it)", () => {
    expect(openDialogs().length).toBeGreaterThanOrEqual(6);
  });

  it("every one carries a message and a buttonLabel, not a macOS-invisible title alone", () => {
    const bare = openDialogs()
      .filter((d) => !d.body.includes("message:") || !d.body.includes("buttonLabel:"))
      .map((d) => `main/index.ts:${d.line}`);
    expect(bare).toEqual([]);
  });
});
