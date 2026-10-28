// A view extension's host in the editor (patterkit design/view-extensions.md): Storyletter's adapter on the
// internal "probe" extension's project (ops' fixture; never published, documented, or shipped), its nodes,
// children, host fields and selection, the edits still waiting laid over them, and the shell's `hostView`
// answering a view over a real MessageChannel from it, end to end through main's write.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostView } from "@wildwinter/app-shell";
import { VIEW_API } from "@wildwinter/app-shell/view-protocol";
import type { HostToView, ViewNode } from "@wildwinter/app-shell/view-protocol";
import type { VCFileStatus } from "@wildwinter/simple-vc-lib";
import { openProject, shardRefs } from "../../main/project.js";
import { undo } from "../../main/mutate.js";
import { setExtensionValues } from "../../main/mutate/extensions.js";
import { resetShardStatus, setStatusReader } from "../../main/vc.js";
import type { ProjectSession } from "../../main/project.js";
import { cardAsTyped, selectionOf, viewAdapter, viewSetup } from "./view-host.js";
import type { ViewHostContext } from "./view-host.js";
import { commitExtensionValue } from "./extension-rows.js";
import type { FieldsSelection } from "./fields-state.js";
import type { CardEdit, ReviewAt, StudioApi } from "../../shared/api.js";
import type { Session } from "./session.js";

const probeDir = fileURLToPath(new URL("../../../../ops/test/fixtures/probe-extension.storylets", import.meta.url));

function scratch(): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-view-host-")), "copy.storylets");
  cpSync(probeDir, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

/** The editor's side over a project main opened: a session, a save queue, a selection, and what was asked of it. */
function editor(main: ProjectSession = scratch()) {
  const asked = { goTo: [] as ReviewAt[], project: 0, selected: [] as string[][], undo: [] as string[], redraws: 0, flushes: 0 };
  const pendingCards = new Map<string, CardEdit>();
  let structural = false;
  let selection: FieldsSelection = {};
  const studio = {
    setExtensionValues: (extension: string, label: string, edits: { node: string; field: string; value?: unknown }[]) =>
      setExtensionValues(main, extension, label, edits),
  } as unknown as StudioApi;
  const session: Session = { studio, project: main.dto, remote: undefined, state: {} as Session["state"] };
  const ctx: ViewHostContext = {
    session,
    saves: {
      pendingCard: (id) => pendingCards.get(id),
      get structuralPending() { return structural; },
      flush: async () => { asked.flushes++; structural = false; },
    },
    selection: () => selection,
    goTo: (at) => { asked.goTo.push(at); },
    focusProject: () => { asked.project++; },
    selectCards: (ids) => { asked.selected.push(ids); },
    applyResult: (r) => { session.project = r.project; },
    redraw: () => { asked.redraws++; },
    undoRedo: (which) => { asked.undo.push(which); },
  };
  return {
    main, session, ctx, asked, adapter: viewAdapter(ctx),
    select: (s: FieldsSelection) => { selection = s; },
    typeCard: (id: string, edit: CardEdit) => { pendingCards.set(id, edit); },
    holdStructural: () => { structural = true; },
  };
}

afterEach(() => { setStatusReader(null); resetShardStatus(); });

describe("the adapter's nodes", () => {
  it("are the project, its boxes, and each box's decks, tag groups, hand templates and hands, in order", async () => {
    const { adapter } = editor();
    const project = await adapter.project();
    expect([project.id, project.kind, project.parent, project.label]).toEqual(["proj_probe", "project", null, "Probe"]);
    expect(project.host).toEqual({ name: "Probe" });
    expect(project.ext["probe"]).toBeDefined();
    expect(project.children?.map((n) => [n.id, n.kind])).toEqual([["b_harbour", "box"]]);

    const box = (await adapter.node("b_harbour", true))!;
    expect(box.host).toEqual({ gameId: "harbour", title: null, purpose: null });
    expect(box.ext["probe"]).toEqual({ theme: "salt" });
    expect(box.children?.map((n) => `${n.kind}:${n.id}`)).toEqual([
      "deck:k_rumours", "tagGroup:d_quarter", "handTemplate:ht_stall", "hand:h_watch", "hand:h_stall",
    ]);
    expect(box.children?.every((n) => n.children === undefined && n.parent === "b_harbour")).toBe(true);
  });

  it("give a card its own fields as the model names them, its deck and box, and its outcomes as children", async () => {
    const { adapter } = editor();
    const card = (await adapter.node("c_bell", true))!;
    expect([card.kind, card.parent, card.label]).toEqual(["card", "k_rumours", "bell"]);
    expect(card.host).toEqual({
      gameId: "bell", title: null, purpose: null, condition: null, priority: 2, redraw: "always", 
      tags: {}, fields: { mood: "tense" }, deck: "k_rumours", box: "b_harbour",
    });
    expect(card.ext["probe"]?.["note"]).toBe("Ring it twice.");
    expect(card.children?.map((n) => [n.id, n.kind, n.parent])).toEqual([["o_ring", "outcome", "c_bell"], ["o_wait", "outcome", "c_bell"]]);
    const outcome = (await adapter.node("o_ring", false))!;
    expect(outcome.host).toEqual({ gameId: "ring", title: null, purpose: null, gate: null, fields: {}, card: "c_bell", deck: "k_rumours", box: "b_harbour" });
    const deck = (await adapter.node("k_rumours", true))!;
    expect(deck.host).toEqual({ gameId: "rumours", title: null, purpose: null, gate: null, box: "b_harbour" });
    expect(deck.children?.map((n) => n.id)).toEqual(["c_bell", "c_tide"]);
  });

  it("give tag groups their tags, hands and templates their bindings, and say null for a node that isn't there", async () => {
    const { adapter } = editor();
    const group = (await adapter.node("d_quarter", true))!;
    expect(group.host).toEqual({ gameId: "quarter", tags: ["docks", "market"], spatial: false, box: "b_harbour" });
    expect(group.children?.map((n) => [n.id, n.kind, n.label, n.host])).toEqual([
      ["v_docks", "tag", "docks", { gameId: "docks", group: "d_quarter" }],
      ["v_market", "tag", "market", { gameId: "market", group: "d_quarter" }],
    ]);
    expect((await adapter.node("ht_stall", false))!.host).toMatchObject({ gameId: "stall", slots: "1", box: "b_harbour" });
    expect((await adapter.node("h_stall", false))!.host).toMatchObject({ gameId: "stall-docks", template: "ht_stall", tags: { quarter: "docks" } });
    expect(await adapter.node("c_nowhere", true)).toBeNull();
  });

  it("read the edits still waiting as the writer sees them: a card's typing, and an extension value typed", async () => {
    const { adapter, typeCard } = editor();
    typeCard("c_bell", { title: "The bell", fields: [{ name: "mood", value: "calm" }], outcomes: [{ id: "o_ring", gameId: "ring", changes: [] }] });
    let landed: (() => void) | undefined;
    commitExtensionValue({ project: () => undefined, save: (_x, _n, _f, _v, done) => { landed = done; } }, "probe", "c_tide", "note", "As typed.");
    const card = (await adapter.node("c_bell", true))!;
    expect(card.label).toBe("The bell");
    expect(card.host["fields"]).toEqual({ mood: "calm" });
    expect(card.children?.map((n) => n.id)).toEqual(["o_ring"]);
    expect((await adapter.node("c_tide", false))!.ext["probe"]).toEqual({ note: "As typed." });
    landed?.();
    expect(cardAsTyped({ id: "c", gameId: "c", priority: 1, redraw: "always", tags: [], sharedCopies: "", fields: [], outcomes: [] }, undefined).gameId).toBe("c");
  });

  it("write a structural edit still waiting before reading, so a read never misses it", async () => {
    const e = editor();
    e.holdStructural();
    await e.adapter.node("c_bell", false);
    expect(e.asked.flushes).toBe(1);
    await e.adapter.node("c_bell", false);
    expect(e.asked.flushes).toBe(1);
  });
});

describe("missing requirements", () => {
  it("says which extensions the view's manifest requires that the project doesn't take, from the project's facts", () => {
    const e = editor();
    expect(e.adapter.missing?.("probe")).toEqual([]);
    e.session.project = { ...e.session.project!, extensions: e.session.project!.extensions!.map((x) => ({ ...x, missing: ["stage"] })) };
    expect(e.adapter.missing?.("probe")).toEqual(["stage"]);
    expect(e.adapter.missing?.("nope")).toEqual([]);
  });
});

describe("the selection, and selecting", () => {
  it("is innermost first: a card, its deck, its box; the project alone on its own page; empty elsewhere", () => {
    const e = editor();
    e.select({ inspected: { kind: "card", box: "b_harbour", deck: "k_rumours", card: "c_bell" } } as FieldsSelection);
    expect(selectionOf(e.ctx).path).toEqual([{ id: "c_bell", kind: "card" }, { id: "k_rumours", kind: "deck" }, { id: "b_harbour", kind: "box" }]);
    e.select({ focus: { kind: "deck", box: "b_harbour", deck: "k_rumours" }, cursor: "c_tide" } as FieldsSelection);
    expect(selectionOf(e.ctx).path.map((n) => n.id)).toEqual(["c_tide", "k_rumours", "b_harbour"]);
    e.select({ focus: { kind: "project" } } as FieldsSelection);
    expect(selectionOf(e.ctx).path).toEqual([{ id: "proj_probe", kind: "project" }]);
    e.select({ focus: { kind: "map" } } as FieldsSelection);
    expect(selectionOf(e.ctx).path).toEqual([]);
  });

  it("reveals each kind where the editor shows it: an outcome on its card, a tag on its group's page", async () => {
    const e = editor();
    expect(await e.adapter.select("o_wait")).toBe(true);
    expect(await e.adapter.select("v_market")).toBe(true);
    expect(await e.adapter.select("c_tide")).toBe(true);
    expect(await e.adapter.select("proj_probe")).toBe(true);
    expect(await e.adapter.select("c_nowhere")).toBe(false);
    expect(e.asked.goTo).toEqual([
      { kind: "outcome", box: "b_harbour", deck: "k_rumours", card: "c_bell", outcome: "o_wait" },
      { kind: "tagGroup", box: "b_harbour", group: "d_quarter" },
      { kind: "card", box: "b_harbour", deck: "k_rumours", card: "c_tide" },
    ]);
    expect(e.asked.selected).toEqual([["c_tide"]]);
    expect(e.asked.project).toBe(1);
  });

  it("passes the view's Mod+Z and Mod+Shift+Z to the project's undo and redo", () => {
    const e = editor();
    e.adapter.key?.("Mod+Z");
    e.adapter.key?.("Mod+Shift+Z");
    e.adapter.key?.("Mod+Y");
    e.adapter.key?.("Mod+K");
    expect(e.asked.undo).toEqual(["undo", "redo", "redo"]);
  });
});

/** A view's end of a MessageChannel: say hello, then ask, with each answer awaited in order. */
function viewEnd(port: MessagePort) {
  const got: HostToView[] = [];
  const waiters: ((m: HostToView) => void)[] = [];
  port.addEventListener("message", (e) => {
    const msg = (e as MessageEvent).data as HostToView;
    const w = waiters.shift();
    if (w) w(msg); else got.push(msg);
  });
  port.start();
  const next = (): Promise<HostToView> => new Promise((resolve) => { const m = got.shift(); if (m) resolve(m); else waiters.push(resolve); });
  let id = 0;
  return {
    hello: async (api = VIEW_API) => { port.postMessage({ t: "hello", api }); return next(); },
    ask: async (op: string, args: unknown) => { port.postMessage({ t: "request", id: ++id, op, args }); return next(); },
    next,
  };
}

describe("hostView over the adapter, end to end", () => {
  const open: MessagePort[] = [];
  afterEach(() => { for (const p of open.splice(0)) p.close(); });

  function connect(e = editor()) {
    // Another extension's values on a card, which the probe view mustn't see.
    e.session.project = { ...e.session.project!, extensions: [...e.session.project!.extensions!, {
      id: "secret", name: "Secret", version: "1.0.0", targets: {}, values: { c_bell: { plan: "hidden" } },
    }] };
    const { port1, port2 } = new MessageChannel();
    open.push(port1, port2);
    const meta = { window: 7, extension: "probe", view: "inspect", version: "1.1.0", pinned: "1.1.0" };
    const setup = viewSetup(e.ctx, meta)!;
    hostView(port2, setup.adapter, {
      meta, reads: setup.reads, ...(setup.names ? { names: setup.names } : {}),
      theme: () => ({ scheme: "light", tokens: { "--ink": "#222" } }), debounceMs: 1,
    });
    return { e, view: viewEnd(port1) };
  }

  it("welcomes the view with the host and its extension, and answers a node with its own data only", async () => {
    const { view } = connect();
    expect(await view.hello()).toEqual({
      t: "welcome", api: VIEW_API, host: "storylets", extension: { id: "probe", version: "1.1.0", pinned: "1.1.0" }, view: "inspect",
      theme: { scheme: "light", tokens: { "--ink": "#222" } }, writable: { readOnly: false }, missing: [],
    });
    const reply = await view.ask("node", { id: "c_bell", children: true });
    const node = (reply as { value: ViewNode }).value;
    expect(Object.keys(node.ext)).toEqual(["probe"]);
    expect(node.children?.map((c) => c.id)).toEqual(["o_ring", "o_wait"]);
  });

  it("refuses a view built for another API with a sentence", async () => {
    const { view } = connect();
    expect(await view.hello(2)).toEqual({ t: "refused", message: "Probe's Probe view was built for view API 2; this app serves 1." });
  });

  it("writes through main as one undo step, redraws, and refuses a held write and media whole", async () => {
    const { e, view } = connect();
    await view.hello();
    const wrote = await view.ask("write", { label: "Probe every note", edits: [
      { node: "c_bell", field: "note", value: "one" }, { node: "c_tide", field: "note", value: "two" },
    ] });
    expect(wrote).toEqual({ t: "reply", id: 1, ok: true, value: { written: 2 } });
    expect(e.asked.redraws).toBe(1);
    expect(e.asked.flushes).toBe(1);
    expect(e.session.project!.extensions!.find((x) => x.id === "probe")!.values["c_tide"]).toEqual({ note: "two" });
    expect(e.main.history.undoLabel).toBe("Probe every note");
    await undo(e.main);
    expect(e.main.dto.extensions!.find((x) => x.id === "probe")!.values["c_tide"]).toBeUndefined();

    const held = new Set(shardRefs(e.main).filter((r) => r.key === "ext:b_harbour:probe").map((r) => r.path));
    resetShardStatus();
    setStatusReader(async (all) => all.map((p): VCFileStatus => ({
      filePath: p, system: "perforce", writable: !held.has(p), ...(held.has(p) ? { lockedBy: ["bo"] } : {}),
    })));
    const refused = await view.ask("write", { label: "Probe note", edits: [{ node: "c_bell", field: "note", value: "x" }] });
    expect(refused).toMatchObject({ ok: false, refusal: { code: "held", message: expect.stringContaining("is locked by bo") } });
    const bad = await view.ask("write", { label: "Probe note", edits: [{ node: "c_bell", field: "weight", value: "heavy" }] });
    expect(bad).toMatchObject({ ok: false, refusal: { code: "bad-request" } });
    const media = await view.ask("media", { ids: ["c_bell"] });
    expect(media).toMatchObject({ ok: false, refusal: { code: "unsupported" } });
  });

  it("refuses a write mixing the project with other nodes, before it reaches main (one rule for both hosts)", async () => {
    const e = editor();
    const write = vi.spyOn(e.session.studio, "setExtensionValues");
    const { view } = connect(e);
    await view.hello();
    const mixed = await view.ask("write", { label: "Probe", edits: [
      { node: "proj_probe", field: "studio", value: "WW" }, { node: "c_bell", field: "note", value: "x" },
    ] });
    expect(mixed).toMatchObject({ ok: false, refusal: { code: "bad-request" } });
    expect(write).not.toHaveBeenCalled();
    expect(await view.ask("write", { label: "Probe", edits: [{ node: "proj_probe", field: "studio", value: "WW" }] }))
      .toMatchObject({ ok: true, value: { written: 1 } });
  });

  it("marks a node held, with the page's lock sentence, when somebody else holds its extension data", async () => {
    const e = editor();
    e.ctx.lockedBy = (key) => (key === "ext:b_harbour:probe" ? ["bo"] : undefined);
    const { view } = connect(e);
    await view.hello();
    const card = ((await view.ask("node", { id: "c_bell", children: true })) as { value: ViewNode }).value;
    expect(card.held).toBe("Probe's data here is locked by bo.");
    expect(card.children?.every((c) => c.held === "Probe's data here is locked by bo.")).toBe(true);
    const project = ((await view.ask("node", { id: "proj_probe" })) as { value: ViewNode }).value;
    expect(project.held).toBeUndefined();
  });

  it("refuses a view whose extension the project doesn't take", () => {
    const e = editor();
    expect(viewSetup(e.ctx, { window: 1, extension: "other", view: "x", version: "1.0.0" })).toBeNull();
  });

  it("refuses a write as read-only under an author's key, before it reaches main", async () => {
    const e = editor();
    e.session.remote = { role: "author" } as Session["remote"];
    const write = vi.spyOn(e.session.studio, "setExtensionValues");
    const { view } = connect(e);
    expect(((await view.hello()) as { writable: unknown }).writable).toMatchObject({ readOnly: true });
    const refused = await view.ask("write", { label: "Probe note", edits: [{ node: "c_bell", field: "note", value: "x" }] });
    expect(refused).toMatchObject({ ok: false, refusal: { code: "read-only" } });
    expect(write).not.toHaveBeenCalled();
  });
});
