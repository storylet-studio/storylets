// Wiring in main that cannot run outside Electron, held by reading the source
// (the dialog-copy test's method). Each names the fault it came from in the
// Storyletter review of 2026-10.
import { describe, expect, it } from "vitest";
import { mainSource } from "./main-source.js";

const SOURCE = mainSource();

/** The body of the handler registered on `channel`, up to the next one. */
function handler(channel: string): string {
  const at = SOURCE.search(new RegExp(`ipc\\.(handle|write)\\("${channel}"`));
  if (at < 0) return "";
  const next = SOURCE.slice(at + 1).search(/ipc\.(handle|write)\(/);
  return SOURCE.slice(at, next < 0 ? undefined : at + 1 + next);
}

/** The body of a named function or method, up to its closing brace at the
 *  same indentation (a `}` alone on a line, or `},` for a method). */
function body(start: string): string {
  const at = SOURCE.indexOf(start);
  if (at < 0) return "";
  const indent = SOURCE.slice(SOURCE.lastIndexOf("\n", at) + 1, at).match(/^ */)![0];
  const end = SOURCE.slice(at).search(new RegExp(`\\n${indent}\\},?\\n`));
  return SOURCE.slice(at, end < 0 ? undefined : at + end);
}

describe("update prompts (item 10)", () => {
  it("go to the editor first, which is the window that answers them (Patterpad's order)", () => {
    const configured = SOURCE.slice(SOURCE.indexOf("configureUpdater({"), SOURCE.indexOf("startBackgroundUpdateCheck, 10_000"));
    expect(configured).toMatch(/activeWindow: \(\) => \(?window/);
  });
});

describe("a coverage sweep across a project change (item 9)", () => {
  it("is cancelled when the project changes or closes", () => {
    const row = SOURCE.slice(SOURCE.indexOf('{ name: "coverage"'), SOURCE.indexOf("], {", SOURCE.indexOf('{ name: "coverage"')));
    expect(row).toContain("jobs.cancel(COVERAGE_JOB)");
  });

  it("is not kept as the last report once the project it ran on has gone", () => {
    const job = SOURCE.slice(SOURCE.indexOf("async function coverageJob"), SOURCE.indexOf("lastCoverage = report;"));
    expect(job).toMatch(/session !== (started|ran)/);
  });
});

describe("Links (item 8, main side)", () => {
  it("hears a project change on a channel of its own, not on its focus channel", () => {
    const row = SOURCE.slice(SOURCE.indexOf('{ name: "links"'), SOURCE.indexOf('{ name: "coverage"'));
    expect(row).toContain('channel: "links:reset"');
  });
});

describe("Live Link's pending push (smaller items)", () => {
  it("is cleared when the link stops and when the project closes", () => {
    expect(handler("liveLink:stop")).toContain("clearTimeout(livePushTimer)");
    // Closing the project stops Live Link, and stopping it clears the push.
    expect(handler("project:close")).toContain("deps.closeProject()");
    expect(body("function closeProject")).toContain("live.stop()");
    expect(body("stop: () => {")).toContain("clearTimeout(livePushTimer)");
  });
});

describe("ruling P, main side", () => {
  it("starts no coverage sweep of its own: the only caller is the window's Run", () => {
    const calls = SOURCE.match(/coverageJob\(/g) ?? [];
    // The definition, the Run handler and Add drivers (which the author asked for).
    expect(calls.length).toBe(3);
  });
});

describe("opening a pack (item 14)", () => {
  it("has one route: a double-clicked pack lands through landPack, with no second unpacker", () => {
    expect(SOURCE).not.toContain("unpackToChosenDir");
    const launch = body("async function resolveLaunchPath");
    expect(launch).toContain("landPack(");
  });
});

describe("closing the Board (ruling Q)", () => {
  it("stops a close the Board did not start and hands it to the Board's own question", () => {
    const guard = SOURCE.slice(SOURCE.indexOf("function guardBoardClose"), SOURCE.indexOf("}\n", SOURCE.indexOf("function guardBoardClose") + 200) + 2);
    expect(guard).toContain("event.preventDefault()");
    expect(guard).toContain('"board:askClose"');
    // Quitting and installing an update are never stood in the way of.
    expect(guard).toMatch(/boardMayClose \|\| leaving \|\| installingUpdate/);
    expect(SOURCE).toMatch(/if \(name === "board"\) guardBoardClose\(win\)/);
  });

  it("lets the Board's own confirmed close through", () => {
    expect(handler("board:close")).toContain("allowBoardClose()");
    expect(SOURCE).toContain("allowBoardClose: () => { boardMayClose = true; }");
  });
});

describe("Links following the editor (2026-10-07)", () => {
  it("is told the selection moved with NO id, so the lens keeps its own Follow state", () => {
    const setFocus = handler("links:setFocus");
    expect(setFocus).toContain("linkFocus = cardId");
    expect(setFocus).toContain('"links:focus", undefined');
    expect(setFocus).not.toMatch(/"links:focus", cardId/);
  });

  it("is sent the id only by Links..., the explicit request to re-centre and follow", () => {
    expect(handler("links:open")).toMatch(/"links:focus", cardId/);
  });
});

describe("undoing a pull (2026-10-07)", () => {
  it("puts the server record and its base back with the shards, outside version control", () => {
    const pull = SOURCE.slice(SOURCE.indexOf("const bookkeeping = [join(ctx.dir, REMOTE_FILE), join(ctx.dir, BASE_FILE)]"),
      SOURCE.indexOf('"Pull from server"') + 400);
    // Both sides of the history entry carry the bookkeeping, marked local.
    expect(pull).toMatch(/const before = \[[^\n]*local\(captureBefore\(bookkeeping\)\)/);
    expect(pull).toMatch(/history\.record\("Pull from server"[\s\S]*local\(captureBefore\(bookkeeping\)\)/);
    // Written before the entry is recorded, so its "after" is the pulled revision.
    expect(pull.indexOf("writeBase(")).toBeLessThan(pull.indexOf('"Pull from server"'));
  });
});

describe("Show Scene in Patterpad (the Patterpad review, 2026-10-07)", () => {
  it("hands the can't-find question to the window instead of a native message box", () => {
    const edit = handler("patter:edit");
    expect(edit).toContain("Storyletter can't find Patterpad");
    expect(edit).not.toContain("showMessageBox");
  });
});
