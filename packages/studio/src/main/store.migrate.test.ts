// A one-time migration is the definition of code that runs once and must be
// right the first time: pinned here against the shape the app actually wrote.
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioStore } from "./store.js";

const LEGACY = {
  theme: "linen", recents: ["/p/one.storylets"], panes: { nav: true, inspector: false },
  autoRebuild: false, viewMode: "node", boardPinned: false, boardFollow: true,
  searchPinned: true, coveragePinned: true, linksPinned: true, showResolved: true,
  lastProject: "/p/one.storylets", lastPlace: { focus: { kind: "box", box: "b_1" }, tab: "map" },
  identity: { name: "Ada" }, navExpanded: ["b:b_1"], mapGroups: { b_1: "d_zone" },
  canvasCameras: { "node:k_1": { x: 1, y: 2, scale: 0.5 } },
  searchBounds: { x: 10, y: 20, width: 440, height: 480 },
};

describe("migrating a pre-shell settings file", () => {
  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    writeFileSync(join(dir, "studio-state.json"), JSON.stringify(LEGACY));
    return dir;
  };

  it("keeps every setting the author had chosen", () => {
    const s = new StudioStore(scratch()).get();
    expect(s.theme).toBe("linen");
    expect(s.viewMode).toBe("node");
    expect(s.boardFollow).toBe(true);
    expect(s.showResolved).toBe(true);
    // Bare paths in the old file become { path } entries without names: the
    // shell keeps them rather than blanking the list (app-shell 0.25.0), and a
    // name arrives the next time the project is opened.
    expect(s.recents).toEqual([{ path: "/p/one.storylets" }]);
    expect(s.lastProject).toBe("/p/one.storylets");
    expect(s.lastPlace?.tab).toBe("map");
    expect(s.identity).toEqual({ name: "Ada" });
    expect(s.navExpanded).toEqual(["b:b_1"]);
    expect(s.mapGroups).toEqual({ b_1: "d_zone" });
    expect(s.canvasCameras).toEqual({ "node:k_1": { x: 1, y: 2, scale: 0.5 } });
    expect(s.searchBounds).toEqual({ x: 10, y: 20, width: 440, height: 480 });
    // A pin somebody turned OFF has to survive: defaulting it back to true
    // would be the migration overruling them.
    expect(s.boardPinned).toBe(false);
    expect(s.searchPinned).toBe(true);
  });

  it("rewrites the file in the shell's shape, and runs only once", () => {
    const dir = scratch();
    new StudioStore(dir);
    const after = JSON.parse(readFileSync(join(dir, "studio-state.json"), "utf8")) as Record<string, unknown>;
    expect(after["app"]).toBeDefined();
    expect(after["theme"]).toBeUndefined();          // moved into the slice
    expect((after["windows"] as Record<string, unknown>)["board"]).toEqual({ pinned: false });

    // Second construction sees the new shape and leaves it be.
    new StudioStore(dir).setTheme("baize");
    const twice = JSON.parse(readFileSync(join(dir, "studio-state.json"), "utf8")) as Record<string, Record<string, unknown>>;
    expect(twice["app"]!["theme"]).toBe("baize");
    expect(twice["recents"]).toEqual([{ path: "/p/one.storylets" }]);
  });

  it("a first run with no file at all is defaults, not a crash", () => {
    const s = new StudioStore(mkdtempSync(join(tmpdir(), "studio-store-"))).get();
    expect(s.theme).toBe("system");
    expect(s.recents).toEqual([]);
    expect(s.boardPinned).toBe(true);
  });
});
