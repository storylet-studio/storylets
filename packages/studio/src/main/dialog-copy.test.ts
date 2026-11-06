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
//
// One open dialog takes its options from app-shell rather than writing them
// out: Show Scene in Patterpad's file picker, inside locateApp's `pick`, is
// handed `locateDialogOptions`, whose type requires a message and a
// buttonLabel. That call is held to passing those options straight through.
import { describe, expect, it } from "vitest";
import { mainFiles } from "./main-source.js";

/** Each `showOpenDialog(...)` call's options block in main, with where it is. */
function openDialogs(): { line: string; body: string; passed?: { args: string; before: string } }[] {
  return mainFiles().flatMap(({ path, text }) => dialogsIn(text).map((d) => ({ ...d, line: `main/${path}:${d.line}` })));
}

/** Each `showOpenDialog(...)` call's options block in one module, with the line it starts on. A call passed
 *  options made elsewhere (no object written out) gives its arguments, and the code just before it, instead. */
function dialogsIn(SOURCE: string): { line: number; body: string; passed?: { args: string; before: string } }[] {
  const found: { line: number; body: string; passed?: { args: string; before: string } }[] = [];
  const marker = "showOpenDialog(";
  for (let at = SOURCE.indexOf(marker); at !== -1; at = SOURCE.indexOf(marker, at + 1)) {
    const brace = SOURCE.indexOf("{", at);
    const close = SOURCE.indexOf(");", at);
    if (close !== -1 && (brace === -1 || close < brace)) {
      const args = SOURCE.slice(at + marker.length, close);
      found.push({ line: SOURCE.slice(0, at).split("\n").length, body: "", passed: { args, before: SOURCE.slice(Math.max(0, at - 400), at) } });
      continue;
    }
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
      .filter((d) => d.passed === undefined)
      .filter((d) => !d.body.includes("message:") || !d.body.includes("buttonLabel:"))
      .map((d) => d.line);
    expect(bare).toEqual([]);
  });

  it("take options made elsewhere only from locateApp's pick, which is handed app-shell's locateDialogOptions", () => {
    const passed = openDialogs().filter((d) => d.passed !== undefined);
    expect(passed.map((d) => d.line)).toEqual([expect.stringMatching(/^main\/ipc\/project\.ts:/)]);
    for (const d of passed) {
      expect(d.passed!.args.trim()).toMatch(/, options$/);
      expect(d.passed!.before).toMatch(/locateApp\(\{[\s\S]*pick: async \(options\) => \{\s*const picked = await dialog\.$/);
    }
  });
});
