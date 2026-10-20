// @vitest-environment jsdom
// The Fields window (Pattershot's brief, "a map of records edited in a helper window", H1 to H5): what the
// editor tells it to show, which item it follows, the page's summary and Edit button in place of the field,
// and the edits it sends back landing through the page's own save.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fieldsHint, fieldsNodeLabel, fieldsState, followTarget, recordMapFields, selectedNodes } from "./fields-state.js";
import { createFieldsLink } from "./fields-link.js";
import { extensionSection, sweepExtensionFold } from "./extension-rows.js";
import type { ExtensionHost } from "./extension-rows.js";
import type { ExtensionDto, FieldsEdit, FieldsWinState, ProjectDto, StudioApi } from "../../shared/api.js";

const shot: ExtensionDto = {
  id: "shot", name: "Shot", version: "1.0.0",
  targets: {
    card: { fields: [
      { name: "note", type: "text", label: "Note" },
      { name: "performance", type: "map", label: "Performance", key: { type: "reference", to: "tag" }, of: { type: "record", fields: [
        { name: "look", type: "pick", label: "Look", from: [{ words: ["away"] }, { to: "tag" }, { list: "places" }] },
        { name: "expression", type: "enum", label: "Expression", values: ["", "smile", "frown"] },
      ] } },
    ], claims: [] },
    deck: { fields: [{ name: "pile", type: "number" }], claims: [] },
    project: { fields: [{ name: "places", type: "list", of: { type: "text" } }], claims: [] },
  },
  values: {
    proj: { places: ["Quay"] },
    c_bell: { performance: { t_tam: { look: "t_wren", expression: "smile" }, t_gone: { look: "Quay" } } },
  },
};
const project = {
  boxes: [], extensions: [shot], projectNode: "proj",
  extensionNodes: {
    box: [{ id: "b_harbour", label: "harbour", box: "b_harbour" }],
    deck: [{ id: "k_rumours", label: "rumours", box: "b_harbour" }],
    card: [{ id: "c_bell", label: "bell", box: "b_harbour" }, { id: "c_tide", label: "tide", box: "b_harbour" }],
    outcome: [{ id: "o_ring", label: "bell/ring", box: "b_harbour" }],
    tag: [{ id: "t_tam", label: "cast/TAM" }, { id: "t_wren", label: "cast/WREN" }],
  },
} as unknown as ProjectDto;
const host = (save = vi.fn()): ExtensionHost => ({ project: () => project, save });

const card = { inspected: { kind: "card" as const, box: "b_harbour", deck: "k_rumours", card: "c_bell" } };

describe("which item the window is on", () => {
  it("is the selection's items, deepest first", () => {
    expect(selectedNodes(card)).toEqual([{ kind: "card", id: "c_bell" }, { kind: "deck", id: "k_rumours" }, { kind: "box", id: "b_harbour" }]);
    expect(selectedNodes({ inspected: { kind: "template", box: "b_harbour", template: "ht_stall" } })).toEqual([{ kind: "handTemplate", id: "ht_stall" }, { kind: "box", id: "b_harbour" }]);
    expect(selectedNodes({ focus: { kind: "deck", box: "b_harbour", deck: "k_rumours" }, cursor: "c_tide" }))
      .toEqual([{ kind: "card", id: "c_tide" }, { kind: "deck", id: "k_rumours" }, { kind: "box", id: "b_harbour" }]);
    expect(selectedNodes({ focus: { kind: "story" } })).toEqual([]);
  });

  it("follows to the deepest whose kind has a map of records, else the deepest (H1, H2)", () => {
    expect(recordMapFields([shot], "card").map((f) => f.decl.name)).toEqual(["performance"]);
    expect(followTarget(selectedNodes(card), [shot])).toEqual({ kind: "card", id: "c_bell" });
    expect(followTarget([{ kind: "deck", id: "k_rumours" }, { kind: "box", id: "b_harbour" }], [shot])).toEqual({ kind: "deck", id: "k_rumours" });
  });

  it("says where such fields are when it has none to show, and names an item as the author knows it", () => {
    expect(fieldsHint([shot])).toBe("Select a card to edit Performance here.");
    expect(fieldsHint([])).toBe("");
    expect(fieldsNodeLabel(project, "outcome", "o_ring")).toBe("ring on bell");
    expect(fieldsNodeLabel(project, "card", "c_bell")).toBe("bell");
  });
});

describe("what the window shows", () => {
  it("each map of records the item has, with what its cells need from the project, as data", () => {
    const state = fieldsState({ host: host(), node: { kind: "card", id: "c_bell" }, lock: () => null });
    expect(state).toMatchObject({ hasProject: true, readOnly: false, node: { kind: "card", id: "c_bell", label: "bell" } });
    expect(state.grids).toHaveLength(1);
    const g = state.grids[0]!;
    expect(g).toMatchObject({ extension: "shot", extensionName: "Shot", field: "performance", locked: null, lists: { places: ["Quay"] } });
    expect(g.value).toEqual(shot.values["c_bell"]!["performance"]);
    expect(g.nodes["tag"]).toEqual([{ id: "t_tam", label: "cast/TAM" }, { id: "t_wren", label: "cast/WREN" }]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);   // it crosses to another window
  });

  it("nothing, with the hint, for no item or one the project no longer has; read-only with the lock's sentence", () => {
    expect(fieldsState({ host: host(), node: null, lock: () => null })).toMatchObject({ hasProject: true, node: null, hint: "Select a card to edit Performance here." });
    expect(fieldsState({ host: host(), node: { kind: "card", id: "c_gone" }, lock: () => null }).node).toBeNull();
    expect(fieldsState({ host: { project: () => undefined, save: vi.fn() }, node: null, lock: () => null }).hasProject).toBe(false);
    const locked = fieldsState({ host: host(), node: { kind: "card", id: "c_bell" }, lock: () => "Shot's data here is locked by bo." });
    expect(locked.grids[0]!.locked).toBe("Shot's data here is locked by bo.");
    expect(fieldsState({ host: { ...host(), readOnly: true }, node: { kind: "card", id: "c_bell" }, lock: () => null }).readOnly).toBe(true);
  });
});

describe("on the page", () => {
  beforeEach(() => { sweepExtensionFold(); sweepExtensionFold(); });

  it("a map of records is a line per key and an Edit button that opens the window on the item (H3)", () => {
    const open = vi.fn();
    const sec = extensionSection({ ...host(), openFields: open }, shot, "card", "c_bell");
    // The summary is the field to the fold: the map holds keys, so it is set and shows folded.
    expect(sec.querySelector(".shell-fold-cap")?.textContent).toBe("Shot (1 set)");
    const lines = [...sec.querySelectorAll(".ext-summary-line")].map((l) => l.textContent);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^cast\/TAM: /);
    expect(lines.join(" ")).not.toMatch(/[—·]/);
    sec.querySelector<HTMLButtonElement>(".ext-edit")!.click();
    expect(open).toHaveBeenCalledWith("card", "c_bell");
    // No grid in the page.
    expect(sec.querySelector(".shell-recordgrid-table")).toBeNull();
  });

  it("no keys: the Edit button alone", () => {
    const sec = extensionSection({ ...host(), openFields: vi.fn() }, shot, "card", "c_tide");
    sec.querySelector<HTMLButtonElement>(".shell-fold-cap")!.click();
    try {
      expect(sec.querySelector(".ext-summary-line")).toBeNull();
      expect(sec.querySelector(".ext-edit")).not.toBeNull();
    } finally { sec.querySelector<HTMLButtonElement>(".shell-fold-cap")!.click(); }
  });
});

describe("the editor's half", () => {
  const studio = () => {
    const sent: FieldsWinState[] = [];
    let commit: ((e: FieldsEdit) => void) | undefined;
    let follow: ((on: boolean) => void) | undefined;
    const api = {
      sendFieldsState: vi.fn(async (s: FieldsWinState) => { sent.push(s); }),
      openFields: vi.fn(async () => undefined),
      onFieldsCommit: (h: (e: FieldsEdit) => void) => { commit = h; },
      onFieldsFollow: (h: (on: boolean) => void) => { follow = h; },
    } as unknown as StudioApi;
    return { api, sent, commit: (e: FieldsEdit) => commit!(e), follow: (on: boolean) => follow!(on) };
  };

  it("sends what to show only when it changed, follows the selection, and holds its item with follow off", () => {
    const s = studio();
    let sel: Parameters<typeof selectedNodes>[0] = card;
    const link = createFieldsLink({ studio: s.api, host: host(), selection: () => sel, lockedBy: () => undefined, follow: () => true, redraw: vi.fn() });
    link.push(); link.push();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.node?.id).toBe("c_bell");
    sel = { inspected: { kind: "card", box: "b_harbour", deck: "k_rumours", card: "c_tide" } };
    link.push();
    expect(s.sent.at(-1)!.node?.id).toBe("c_tide");
    s.follow(false);
    sel = card;
    link.push();
    expect(s.sent.at(-1)!.node?.id).toBe("c_tide");
    s.follow(true);
    expect(s.sent.at(-1)!.node?.id).toBe("c_bell");
  });

  it("an Edit button shows its own item until the selection moves on, and brings the window forward", () => {
    const s = studio();
    let sel: Parameters<typeof selectedNodes>[0] = card;
    const link = createFieldsLink({ studio: s.api, host: host(), selection: () => sel, lockedBy: () => undefined, follow: () => true, redraw: vi.fn() });
    link.openOn("outcome", "o_ring");
    expect(s.sent.at(-1)!.node).toMatchObject({ kind: "outcome", id: "o_ring", label: "ring on bell" });
    expect(s.api.openFields).toHaveBeenCalled();
    link.push();
    expect(s.sent.at(-1)!.node?.id).toBe("o_ring");
    sel = { inspected: { kind: "card", box: "b_harbour", deck: "k_rumours", card: "c_tide" } };
    link.push();
    expect(s.sent.at(-1)!.node?.id).toBe("c_tide");
  });

  it("applies the window's edit through the page's save, and shows it as made before the write lands (H4)", () => {
    const s = studio();
    const save = vi.fn();
    const redraw = vi.fn();
    const link = createFieldsLink({ studio: s.api, host: host(save), selection: () => card, lockedBy: () => undefined, follow: () => true, redraw: () => { redraw(); link.push(); } });
    link.push();
    const value = { t_tam: { expression: "frown" } };
    s.commit({ nodeId: "c_bell", extension: "shot", field: "performance", value });
    expect(save).toHaveBeenCalledWith("shot", "c_bell", "performance", value, expect.any(Function));
    // The page redraws, so its summary says what the window did.
    expect(redraw).toHaveBeenCalled();
    expect(s.sent.at(-1)!.grids[0]!.value).toEqual(value);
    save.mock.calls[0]![4]();   // the write landed
  });

  it("words a held shard's lock for the grid", () => {
    const s = studio();
    const link = createFieldsLink({ studio: s.api, host: host(), selection: () => card,
      lockedBy: (key) => (key === "ext:b_harbour:shot" ? ["bo@bo-ws"] : undefined), follow: () => true, redraw: vi.fn() });
    link.push();
    expect(s.sent[0]!.grids[0]!.locked).toBe("Shot's data here is locked by bo@bo-ws.");
  });
});
