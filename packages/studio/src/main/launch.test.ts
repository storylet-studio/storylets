// ---------------------------------------------------------------------------
// Launching from a shell. Expectations hand-written from what the docs promise:
// `storyletter <path>` opens the project, `--at <where>` (or `--at=<where>`)
// names an item, a bare `--at` carries no path, Electron's own switches are
// never paths, and the dev runner's app-path argument is not a project.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "@storylet-studio/ops";
import { launchLocation, launchLocationFromArgv, launchPathFromArgv, sameProject } from "./launch.js";

const village = fileURLToPath(new URL("../../../../examples/the-hamlet.storylets", import.meta.url));
const shard = join(village, "village", "decks", "arrival.storyletdeck");

describe("launchPathFromArgv", () => {
  it("finds the project folder after the executable in a packaged run", () => {
    expect(launchPathFromArgv(["/Applications/Storyletter", village], true)).toBe(village);
  });

  it("skips the app path the dev runner passes, so `.` is never opened", () => {
    expect(launchPathFromArgv(["electron", ".", village], false)).toBe(village);
    expect(launchPathFromArgv(["electron", "."], false)).toBeUndefined();
  });

  it("takes a shard inside the project, and a pack, as ways in", () => {
    expect(launchPathFromArgv(["storyletter", shard], true)).toBe(shard);
    const dir = mkdtempSync(join(tmpdir(), "launch-"));
    const pack = join(dir, "village.storyletpack");
    writeFileSync(pack, "");
    expect(launchPathFromArgv(["storyletter", pack], true)).toBe(pack);
  });

  it("ignores switches, the `--at` value, and a folder that is not a project", () => {
    const plain = mkdtempSync(join(tmpdir(), "not-a-project-"));
    mkdirSync(join(plain, "sub"));
    expect(launchPathFromArgv(["storyletter", "--remote-debugging-port=9222", "--at", village, plain], true)).toBeUndefined();
    expect(launchPathFromArgv(["storyletter", "--at=gate", "-psn_0_1", "missing.storylets"], true)).toBeUndefined();
  });
});

describe("launchLocationFromArgv", () => {
  it("reads `--at <where>` and `--at=<where>`", () => {
    expect(launchLocationFromArgv(["storyletter", village, "--at", "arrive-at-the-gate"], true)).toBe("arrive-at-the-gate");
    expect(launchLocationFromArgv(["storyletter", "--at=The Inn", village], true)).toBe("The Inn");
  });

  it("a bare `--at` with no path still names the item; no `--at` names nothing", () => {
    expect(launchLocationFromArgv(["electron", ".", "--at", "the-inn"], false)).toBe("the-inn");
    expect(launchLocationFromArgv(["storyletter", village], true)).toBeUndefined();
    expect(launchLocationFromArgv(["storyletter", "--at"], true)).toBeUndefined();
  });
});

describe("sameProject", () => {
  it("is true for the open project's folder or any shard inside it, false otherwise", () => {
    expect(sameProject(village, village)).toBe(true);
    expect(sameProject(shard, village)).toBe(true);
    expect(sameProject(village, undefined)).toBe(false);
    expect(sameProject(village, join(village, "..", "saltmarsh.storylets"))).toBe(false);
  });

  it("a pack is never the open project, even one sitting inside its folder", () => {
    expect(sameProject(join(village, "sent.storyletpack"), village)).toBe(false);
  });
});

describe("launchLocation", () => {
  const loaded = loadProject(village);

  it("lands a card as the Find window would, and an outcome on its card", () => {
    expect(launchLocation(loaded, "arrive-at-the-gate")).toEqual({ kind: "card", box: "b_village", deck: "k_arrival", card: "c_arrive" });
    expect(launchLocation(loaded, "step-through")).toEqual({ kind: "outcome", box: "b_village", deck: "k_arrival", card: "c_arrive", outcome: "c_arrive_o" });
  });

  it("covers every item kind with a document", () => {
    expect(launchLocation(loaded, "village")?.kind).toBe("box");
    expect(launchLocation(loaded, "arrival")).toEqual({ kind: "deck", box: "b_village", deck: "k_arrival" });
    expect(launchLocation(loaded, "the-inn")).toEqual({ kind: "hand", box: "b_village", hand: "h_inn" });
    expect(launchLocation(loaded, "whats-happening")).toEqual({ kind: "template", box: "b_village", template: "t_whats_happening" });
    expect(launchLocation(loaded, "area")).toEqual({ kind: "tagGroup", box: "b_village", group: "d_zone" });
  });

  it("is undefined when nothing matches", () => {
    expect(launchLocation(loaded, "no_such_thing_xyz")).toBeUndefined();
  });
});
