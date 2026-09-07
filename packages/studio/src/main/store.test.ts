import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioStore } from "./store.js";

describe("studio store", () => {
  it("persists theme and recents across instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const store = new StudioStore(dir);
    store.setTheme("baize");
    store.touchProject("/a/one.storylets", "The Hamlet");
    store.touchProject("/a/two.storylets", "Draft");
    store.touchProject("/a/one.storylets");   // re-open: dedupes to the front
    store.setLastPlace({ focus: { kind: "deck", box: "b_1", deck: "k_1" }, tab: "cards" });

    const again = new StudioStore(dir);
    expect(again.get()).toMatchObject({
      theme: "baize",
      // The re-open passed no name, and the name it had SURVIVES: a second open
      // through a route that does not know it must not blank the menu entry.
      recents: [{ path: "/a/one.storylets", name: "The Hamlet" }, { path: "/a/two.storylets", name: "Draft" }],
      lastProject: "/a/one.storylets",
      lastPlace: { focus: { kind: "deck", box: "b_1", deck: "k_1" }, tab: "cards" },
    });
  });

  it("keeps a place per project, so going away and coming back lands where you left", () => {
    // app-shell 0.24.0: a place belongs to a PROJECT, not to the app. It used to
    // be one slot, dropped the moment a different project was opened, so the
    // walk-away-and-return case lost the page every time.
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const store = new StudioStore(dir);
    store.touchProject("/a/one.storylets", "One");
    store.setLastPlace({ focus: { kind: "deck", box: "b_1", deck: "k_1" }, tab: "cards" });
    store.touchProject("/a/two.storylets", "Two");
    expect(store.get().lastPlace).toBeUndefined();   // a project you have not been into yet

    store.touchProject("/a/one.storylets");
    expect(store.get().lastPlace).toEqual({ focus: { kind: "deck", box: "b_1", deck: "k_1" }, tab: "cards" });
  });

  it("keeps the canvas cameras across instances, and takes the renderer's word for the whole set", () => {
    // Rule 13's other half: the app reopens on the page you left, looking where
    // you left it. Which canvases are worth keeping is the renderer's decision
    // (it prunes), so main replaces the set rather than merging into it, or a
    // key the renderer has dropped would live here for ever.
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const store = new StudioStore(dir);
    store.setCanvasCameras({ "node:k_1": { x: 10, y: 20, scale: 0.5 }, "map:b_1:g_1": { x: 0, y: 0, scale: 1 } });
    store.setCanvasCameras({ "node:k_1": { x: 11, y: 20, scale: 0.5 } });

    const again = new StudioStore(dir);
    expect(again.get().canvasCameras).toEqual({ "node:k_1": { x: 11, y: 20, scale: 0.5 } });
  });

  it("remembers the Board's follow choice, which is OFF until asked for", () => {
    // The Board marks rather than navigates; following is the opt-in, so a fresh
    // state file must not have it on.
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    expect(new StudioStore(dir).get().boardFollow).toBe(false);
    const store = new StudioStore(dir);
    store.setBoardFollow(true);
    expect(new StudioStore(dir).get().boardFollow).toBe(true);
  });

  it("keeps which map each box was showing", () => {
    // The map is a box's landing page, so which of its maps is part of where the
    // author was, not a preference they should have to re-pick.
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const store = new StudioStore(dir);
    store.setMapGroups({ b_1: "d_town", b_2: "d_castle" });
    expect(new StudioStore(dir).get().mapGroups).toEqual({ b_1: "d_town", b_2: "d_castle" });
  });

  it("caps recents and forgets unopenable projects", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const store = new StudioStore(dir);
    for (let i = 0; i < 12; i++) store.touchProject(`/p/${i}.storylets`);
    expect(store.get().recents).toHaveLength(8);
    store.forgetProject("/p/11.storylets");
    const state = store.get();
    expect(state.recents).not.toContain("/p/11.storylets");
    expect(state.lastProject).toBeUndefined();
  });
});

describe("the remembered page", () => {
  it("survives reopening the SAME project, and is dropped for a different one", () => {
    // Rule 13 could never work otherwise: reopening at launch goes through
    // touchProject, so clearing unconditionally would wipe the page every time.
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const store = new StudioStore(dir);
    store.touchProject("/a/one.storylets");
    store.setLastPlace({ focus: { kind: "box", box: "b_1" }, tab: "map" });

    store.touchProject("/a/one.storylets");
    expect(store.get().lastPlace).toEqual({ focus: { kind: "box", box: "b_1" }, tab: "map" });

    store.touchProject("/a/two.storylets");
    expect(store.get().lastPlace).toBeUndefined();
  });
});

describe("the Board's List | Map choice belongs to a PROJECT", () => {
  // The choice used to be one app-wide slot, so preferring List in one project
  // decided another project's first impression - the exact leak the per-project
  // places rule exists to prevent, reported when a brand-new project's Board
  // opened on List (2026-08-28). A project never asked about answers "map":
  // the Board itself falls back to List when there is no map to show.
  it("keys the choice by the open project, and a fresh project answers map", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const store = new StudioStore(dir);
    store.touchProject("/a/one.storylets", "One");
    store.setBoardView("list");
    store.touchProject("/a/two.storylets", "Two");
    expect(store.get().boardView).toBe("map");     // two never chose; map is the default
    store.touchProject("/a/one.storylets");
    expect(store.get().boardView).toBe("list");    // one's choice survived the trip

    const again = new StudioStore(dir);
    expect(again.get().boardView).toBe("list");    // and persists
  });

  it("remembers WHICH BOX the Board was watching, per project, Everything included", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const store = new StudioStore(dir);
    store.touchProject("/a/one.storylets", "One");
    store.setBoardBox("news");
    store.touchProject("/a/two.storylets", "Two");
    store.setBoardBox("");                          // Everything, chosen explicitly
    expect(store.get().boardBox).toBe("");
    store.touchProject("/a/one.storylets");
    expect(store.get().boardBox).toBe("news");
    store.touchProject("/a/three.storylets", "Three");
    expect(store.get().boardBox).toBeUndefined();   // never chose: the Board's default rule decides

    const again = new StudioStore(dir);
    expect(again.get().boardBox).toBeUndefined();   // three is still current, still unchosen
  });

  it("keeps the box and the view in one entry, so the prune covers both", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const store = new StudioStore(dir);
    store.touchProject("/a/one.storylets", "One");
    store.setBoardView("list");
    store.setBoardBox("codex");
    expect(store.get()).toMatchObject({ boardView: "list", boardBox: "codex" });
    store.forgetProject("/a/one.storylets");
    store.touchProject("/a/one.storylets", "One");
    expect(store.get().boardView).toBe("map");
    expect(store.get().boardBox).toBeUndefined();
  });

  it("drops a choice when its project ages off recents, like places do", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const store = new StudioStore(dir);
    store.touchProject("/a/one.storylets", "One");
    store.setBoardView("list");
    store.forgetProject("/a/one.storylets");
    store.touchProject("/a/one.storylets", "One");
    expect(store.get().boardView).toBe("map");
  });
});

describe("the pack exchange's keys", () => {
  // One venue, two jobs, two keys (design/engine-server.md 9.1 point 5). Keyed
  // by address alone until 2026-09-07: pairing a second project as a designer
  // overwrote the author key for the same server, and the author's project then
  // pulled as a designer with its sidecar flipped and the read-only rule gone.
  const AT = "https://the-park.example";

  const store = (dir: string): StudioStore => new StudioStore(dir);

  it("keeps one key per role at one address, and hands each project its own", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const s = store(dir);
    s.setServerKey(AT, { key: "author-key", role: "author", installation: "the-park" });
    s.setServerKey(AT, { key: "designer-key", role: "designer", installation: "the-park" });

    // Each project asks with the role its own sidecar records.
    expect(s.serverKey(AT, "author")).toMatchObject({ key: "author-key", role: "author" });
    expect(s.serverKey(AT, "designer")).toMatchObject({ key: "designer-key", role: "designer" });
    expect(s.serverRoles(AT).sort()).toEqual(["author", "designer"]);

    // And across instances, because the whole point is that neither pairing
    // costs the other one its key.
    const again = store(dir);
    expect(again.serverKey(AT, "author")!.key).toBe("author-key");
    expect(again.serverKey(AT, "designer")!.key).toBe("designer-key");
  });

  it("pairing the same role again replaces that key and leaves the other", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const s = store(dir);
    s.setServerKey(AT, { key: "author-key", role: "author" });
    s.setServerKey(AT, { key: "designer-key", role: "designer" });
    s.setServerKey(AT, { key: "author-again", role: "author" });
    expect(s.serverKey(AT, "author")!.key).toBe("author-again");
    expect(s.serverKey(AT, "designer")!.key).toBe("designer-key");
  });

  it("forgets ONE slot when a role is named, and the address when none is", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const s = store(dir);
    s.setServerKey(AT, { key: "author-key", role: "author" });
    s.setServerKey(AT, { key: "designer-key", role: "designer" });

    // What Forget this server does with a project open: the key that project
    // uses goes, and the other job is left alone.
    s.forgetServer(AT, "author");
    expect(s.serverKey(AT, "author")).toBeUndefined();
    expect(s.serverKey(AT, "designer")!.key).toBe("designer-key");

    // With no project to narrow it by, the address goes whole.
    s.setServerKey(AT, { key: "author-key", role: "author" });
    s.forgetServer(AT);
    expect(s.serverRoles(AT)).toEqual([]);
    expect(store(dir).serverRoles(AT)).toEqual([]);
  });

  it("answers with nothing when no role is named and there are two", () => {
    // A pack offering an address before anything is open has no role to match
    // by, and one of two at random is the bug this keying exists to stop.
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const s = store(dir);
    s.setServerKey(AT, { key: "author-key", role: "author" });
    expect(s.serverKey(AT)!.key).toBe("author-key");
    s.setServerKey(AT, { key: "designer-key", role: "designer" });
    expect(s.serverKey(AT)).toBeUndefined();
  });

  it("reads a file written before the split as the one slot its role names", () => {
    // The pre-split shape is a single key at the address. It keeps working, and
    // is written into its own slot the next time anything is paired.
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const file = join(dir, "studio-state.json");
    writeFileSync(file, `${JSON.stringify({
      recents: [], panes: {}, windows: {},
      app: { servers: { [AT]: { key: "old-key", role: "author", installation: "the-park" } } },
    }, null, 2)}\n`, "utf8");

    const s = store(dir);
    expect(s.serverKey(AT, "author")!.key).toBe("old-key");
    expect(s.serverKey(AT, "designer")).toBeUndefined();
    s.setServerKey(AT, { key: "designer-key", role: "designer" });
    expect(s.serverKey(AT, "author")!.key).toBe("old-key");
    expect(s.serverKey(AT, "designer")!.key).toBe("designer-key");
  });

  it("holds a key sealed, and reads a key it cannot unseal as none at all", () => {
    // The host seals with the OS's own store where there is one. A key that will
    // not unseal (a keychain that moved machines) is a key that is gone: the
    // author is offered the dialog rather than a call that would be refused.
    const dir = mkdtempSync(join(tmpdir(), "studio-store-"));
    const sealed = new StudioStore(dir, {
      seal: (plain) => `sealed:${plain}`,
      unseal: (s) => (s.startsWith("sealed:") ? s.slice("sealed:".length) : undefined),
    });
    sealed.setServerKey(AT, { key: "author-key", role: "author" });
    expect(sealed.serverKey(AT, "author")!.key).toBe("author-key");
    // The same file read by a host whose keychain says no.
    const lost = new StudioStore(dir, { seal: (p) => p, unseal: () => undefined });
    expect(lost.serverKey(AT, "author")).toBeUndefined();
    // ...and it is still THERE, so "forget this server" still has something to
    // forget rather than silently doing nothing.
    expect(lost.serverRoles(AT)).toEqual(["author"]);
  });
});
