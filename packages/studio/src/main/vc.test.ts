// The per-shard version-control state layer: the mapping from simple-vc-lib's
// per-file status onto our shard keys, the remote-round-trip throttle
// (Patterpad's discipline: local bits always fresh, remote bits cached), the
// coalescing of bursty callers, and the best-effort failure path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { REMOTE_STATUS_THROTTLE_MS, resetShardStatus, setStatusReader, shardStatus } from "./vc.js";
import { openProject, shardRefs, vcStatus } from "./project.js";
import type { VCFileStatus } from "@wildwinter/simple-vc-lib";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));

/** A canned per-file status; everything unstated is clean and writable. */
const status = (filePath: string, over: Partial<VCFileStatus> = {}): VCFileStatus =>
  ({ filePath, system: "perforce", writable: true, ...over });

const refs = [
  { key: "project", path: "/p/saltmarsh.storyletproj" },
  { key: "box:b1", path: "/p/encounters/box.storyletbox" },
  { key: "deck:d1", path: "/p/encounters/decks/docks.storyletdeck" },
];

describe("shard version-control state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T10:00:00Z"));
    resetShardStatus();
  });
  afterEach(() => {
    setStatusReader(null);
    vi.useRealTimers();
  });

  it("maps writable / lockedBy / outOfDate onto the shard keys", async () => {
    setStatusReader(async (paths) => paths.map((p) =>
      p.endsWith(".storyletdeck")
        ? status(p, { writable: false, lockedBy: ["bo@bo-ws"] })
        : p.endsWith(".storyletbox") ? status(p, { outOfDate: true }) : status(p)));

    const { system, states } = await shardStatus(refs);
    expect(system).toBe("perforce");
    expect(states.get("project")).toEqual({ writable: true });
    expect(states.get("box:b1")).toEqual({ writable: true, outOfDate: true });
    expect(states.get("deck:d1")).toEqual({ writable: false, lockedBy: ["bo@bo-ws"] });
  });

  it("reports every shard writable when the query throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setStatusReader(() => Promise.reject(new Error("p4: command not found")));
    const { states } = await shardStatus(refs);
    expect([...states.values()].every((s) => s.writable && !s.lockedBy)).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ignores statuses for paths it did not ask about", async () => {
    setStatusReader(async () => [status("/p/somewhere/else.txt", { writable: false })]);
    const { states } = await shardStatus(refs);
    expect(states.get("project")).toEqual({ writable: true });
  });

  describe("the remote round-trip throttle", () => {
    it("asks for remote bits on the first call, then not again inside the window", async () => {
      const seen: (boolean | undefined)[] = [];
      setStatusReader(async (paths, options) => {
        seen.push(options?.remote);
        return paths.map((p) => status(p, p.endsWith(".storyletdeck") ? { lockedBy: ["bo@bo-ws"] } : {}));
      });

      await shardStatus(refs);
      vi.setSystemTime(Date.now() + 1_000);
      await shardStatus(refs);
      vi.setSystemTime(Date.now() + 1_000);
      await shardStatus(refs);
      expect(seen).toEqual([true, false, false]);
    });

    it("keeps showing the cached holder while the window holds, and refreshes after it", async () => {
      let holders: string[] | undefined = ["bo@bo-ws"];
      setStatusReader(async (paths, options) => paths.map((p) =>
        (p.endsWith(".storyletdeck") && options?.remote && holders
          ? status(p, { lockedBy: holders })
          : status(p))));

      expect((await shardStatus(refs)).states.get("deck:d1")?.lockedBy).toEqual(["bo@bo-ws"]);
      // Inside the window: no server hit, but the badge must not blink off.
      vi.setSystemTime(Date.now() + REMOTE_STATUS_THROTTLE_MS - 1);
      expect((await shardStatus(refs)).states.get("deck:d1")?.lockedBy).toEqual(["bo@bo-ws"]);
      // Bo releases it; only a fresh remote read may drop the badge.
      holders = undefined;
      vi.setSystemTime(Date.now() + 1);
      expect((await shardStatus(refs)).states.get("deck:d1")?.lockedBy).toBeUndefined();
    });

    it("still refreshes the LOCAL writable bit inside the window", async () => {
      let writable = true;
      setStatusReader(async (paths) => paths.map((p) =>
        status(p, p.endsWith(".storyletbox") ? { writable } : {})));

      expect((await shardStatus(refs)).states.get("box:b1")?.writable).toBe(true);
      writable = false;
      vi.setSystemTime(Date.now() + 100);   // well inside the throttle window
      expect((await shardStatus(refs)).states.get("box:b1")?.writable).toBe(false);
    });

    it("resets the window when a project opens", async () => {
      const seen: (boolean | undefined)[] = [];
      setStatusReader(async (paths, options) => { seen.push(options?.remote); return paths.map((p) => status(p)); });
      await shardStatus(refs);
      await shardStatus(refs);
      resetShardStatus();
      await shardStatus(refs);
      expect(seen).toEqual([true, false, true]);
    });
  });

  it("coalesces a burst of callers into one query", async () => {
    let calls = 0;
    let release = (): void => {};
    setStatusReader(async (paths) => {
      calls++;
      await new Promise<void>((resolve) => { release = resolve; });
      return paths.map((p) => status(p));
    });
    const a = shardStatus(refs);
    const b = shardStatus(refs);
    const c = shardStatus(refs);
    release();
    await Promise.all([a, b, c]);
    expect(calls).toBe(1);
    // ...and the next caller after it settles does get a fresh query.
    setStatusReader(async (paths) => { calls++; return paths.map((p) => status(p)); });
    await shardStatus(refs);
    expect(calls).toBe(2);
  });
});

describe("the project's shard refs + DTO", () => {
  beforeEach(() => resetShardStatus());
  afterEach(() => setStatusReader(null));

  it("keys every shard of the example project", () => {
    const opened = openProject(exampleDir);
    if ("error" in opened) throw new Error(opened.error);
    const keys = shardRefs(opened.session).map((r) => r.key);
    const boxId = opened.session.dto.boxes[0]!.id;
    const deckId = opened.session.dto.boxes[0]!.decks[0]!.id;
    expect(keys).toContain("project");
    expect(keys).toContain(`box:${boxId}`);
    expect(keys).toContain(`tags:${boxId}`);
    expect(keys).toContain(`hands:${boxId}`);
    expect(keys).toContain(`deck:${deckId}`);
    // Every path is absolute and inside the project.
    expect(shardRefs(opened.session).every((r) => r.path.startsWith(opened.session.loaded.dir))).toBe(true);
  });

  it("trims the DTO to the shards with something to say", async () => {
    const opened = openProject(exampleDir);
    if ("error" in opened) throw new Error(opened.error);
    const deckId = opened.session.dto.boxes[0]!.decks[0]!.id;
    const locked = shardRefs(opened.session).find((r) => r.key === `deck:${deckId}`)!.path;
    setStatusReader(async (paths) => paths.map((p) => status(p, p === locked ? { writable: false, lockedBy: ["bo@bo-ws"] } : {})));

    const dto = await vcStatus(opened.session);
    expect(dto.system).toBe("perforce");
    expect(dto.shards).toEqual([{ key: `deck:${deckId}`, writable: false, lockedBy: ["bo@bo-ws"] }]);
  });

  it("carries the three states the port had dropped, rather than trimming them away", async () => {
    // app-shell 0.26.0 restored checkedOutByMe / dirty / untracked to the shared
    // grammar. The DTO is trimmed to shards with something to SAY, and the old
    // test for that predates these three: left alone it would have carried them
    // across the wire and then dropped them on the floor here.
    const opened = openProject(exampleDir);
    if ("error" in opened) throw new Error(opened.error);
    const deckId = opened.session.dto.boxes[0]!.decks[0]!.id;
    const boxId = opened.session.dto.boxes[0]!.id;
    const refs2 = shardRefs(opened.session);
    const deck = refs2.find((r) => r.key === `deck:${deckId}`)!.path;
    const box = refs2.find((r) => r.key === `box:${boxId}`)!.path;
    setStatusReader(async (paths) => paths.map((p) =>
      // `openedByMe` is simple-vc-lib's word; `checkedOutByMe` is the shell's
      // shard state. The two are not the same name and the mapping is the point.
      p === deck ? status(p, { openedByMe: true, dirty: true })
        : p === box ? status(p, { tracked: false })
        : status(p)));

    const dto = await vcStatus(opened.session);
    expect(dto.shards).toEqual(expect.arrayContaining([
      { key: `deck:${deckId}`, writable: true, checkedOutByMe: true, dirty: true },
      { key: `box:${boxId}`, writable: true, untracked: true },
    ]));
  });

  it("decides `untracked` from the PRIMARY shard only", async () => {
    // A box whose own shard is committed and whose tags sidecar has never been
    // written is an EDITED box, not a new one. The nav's box row folds all three
    // keys, so the seam that stops it reading "new" is which ref is primary.
    const opened = openProject(exampleDir);
    if ("error" in opened) throw new Error(opened.error);
    const boxId = opened.session.dto.boxes[0]!.id;
    const refs2 = shardRefs(opened.session);
    expect(refs2.find((r) => r.key === `box:${boxId}`)?.primary).toBe(true);
    expect(refs2.find((r) => r.key === `tags:${boxId}`)?.primary).toBeUndefined();

    const tags = refs2.find((r) => r.key === `tags:${boxId}`)!.path;
    setStatusReader(async (paths) => paths.map((p) => status(p, p === tags ? { tracked: false } : {})));
    const dto = await vcStatus(opened.session);
    expect(dto.shards).toEqual([]);   // nothing to say: an uncommitted sidecar is not a new box
  });
});
