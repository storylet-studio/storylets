// @vitest-environment jsdom
// Version control on Storylet extension shards (Patterpad's model, its tier 1): each extension's data in a box
// is a shard of its own, so somebody else holding one locks that extension's rows, with a sentence naming the
// extension and the holder, and leaves the box's own fields and every other extension's rows editable.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderCardWorkspace } from "./inspector.js";
import { extensionFields, extensionOwner } from "./extension-rows.js";
import { applyExtensionLocks, extensionLockMessage, extensionRowStates, extensionStates, lockControls, vcKeys } from "./vc-view.js";
import { setPlayRung } from "./play-ladder.js";
import { resetDocTabMemory, setDocTab } from "./doc-tab-memory.js";
import type { InspectorHost } from "./inspector.js";
import type { BoxDto, CardDto, DeckDto, ExtensionDto, ProjectDto, VcStatusDto } from "../../shared/api.js";

const card: CardDto = {
  id: "c_bell", gameId: "bell", title: "The bell", priority: "0", redraw: "always",
  tags: [], sharedCopies: "", fields: [{ name: "mood", value: "tense" }], outcomes: [],
};
const deck: DeckDto = { id: "k_rumours", gameId: "rumours", properties: [], cards: [card] };
const box: BoxDto = {
  id: "b_harbour", gameId: "harbour", folder: "harbour", ranking: { specificity: true },
  fields: [{ name: "mood", type: "enum", values: ["calm", "tense"], default: "calm" }], outcomeFields: [],
  properties: [], decks: [deck], templates: [], tagGroups: [], hands: [],
};
const extension = (id: string, name: string, field: string): ExtensionDto => ({
  id, name, version: "1.0.0",
  targets: {
    card: { fields: [{ name: field, type: "text", label: field }, { name: "spare", type: "text", label: "Spare" }] },
    project: { fields: [{ name: "studio", type: "text", label: "Studio" }] },
  },
  values: { c_bell: { [field]: "set" } },
});
const probe = extension("probe", "Probe", "note");
const cues = extension("cues", "Cues", "sound");
const project = {
  boxes: [box], extensions: [probe, cues], projectNode: "proj_probe",
  extensionNodes: { card: [{ id: "c_bell", label: "bell", box: "b_harbour" }], tag: [{ id: "t_dock", label: "map/dock" }] },
} as unknown as ProjectDto;

const host = (): InspectorHost => ({
  openThreads: () => 0, showComments: vi.fn(), saveCard: vi.fn(), saveDeckConfig: vi.fn(), deleteCard: vi.fn(),
  saveBox: vi.fn(), saveTemplate: vi.fn(), saveTagGroup: vi.fn(), saveHand: vi.fn(), deleteTemplate: vi.fn(),
  deleteTagGroup: vi.fn(), deleteHand: vi.fn(), renameStage: vi.fn(), renameProperty: vi.fn(), stageGates: async () => 0, setGroupSpatial: vi.fn(),
  handCards: async () => null, deckCatalogue: async () => [], openCardFromHand: vi.fn(), newCardAtHand: vi.fn(), openHand: vi.fn(),
  extensions: { project: () => project, save: vi.fn() },
} as InspectorHost);

const fieldsTab = (): HTMLElement => {
  const centre = document.createElement("div");
  setDocTab(`card:${deck.id}/${card.id}`, "fields");
  renderCardWorkspace(centre, box, deck, card, [], host());
  return centre;
};
const group = (root: HTMLElement, id: string): HTMLElement => root.querySelector<HTMLElement>(`[data-ext-vc][data-extension="${id}"]`)!;
const controls = (root: HTMLElement): HTMLInputElement[] => [...root.querySelectorAll<HTMLInputElement>("input, select, textarea")];
const held: VcStatusDto["extensions"] = { b_harbour: { probe: { writable: false, lockedBy: ["bo@bo-ws"] } } };

beforeEach(() => {
  setPlayRung("solo");
  resetDocTabMemory();
  Element.prototype.scrollIntoView = (): void => {};
});

describe("a held extension shard", () => {
  it("locks that extension's rows alone, saying whose and by whom", () => {
    const centre = fieldsTab();
    expect(applyExtensionLocks(centre, extensionStates(held))).toEqual(["bo@bo-ws"]);
    const locked = group(centre, "probe");
    expect(controls(locked).length).toBeGreaterThan(0);
    expect(controls(locked).every((c) => c.disabled)).toBe(true);
    expect(locked.querySelector(".ext-lock")?.textContent).toBe("Probe's data here is locked by bo@bo-ws.");
    // The other extension and the box's own fields stay editable.
    expect(controls(group(centre, "cues")).every((c) => !c.disabled)).toBe(true);
    expect(group(centre, "cues").querySelector(".ext-lock")).toBeNull();
    const own = controls(centre).filter((c) => !c.closest(".ext-section"));
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((c) => !c.disabled)).toBe(true);
  });

  it("says so under the folded section's caption, leaves the caption live, and locks the rows opening it draws", () => {
    const centre = fieldsTab();
    applyExtensionLocks(centre, extensionStates(held));
    const locked = group(centre, "probe");
    expect(locked.children[1]?.classList.contains("ext-lock")).toBe(true);
    const caption = locked.querySelector<HTMLButtonElement>(".shell-fold-cap")!;
    expect(caption.disabled).toBe(false);
    // The card sets one of Probe's two fields, so the other shows only once the fold opens.
    expect(controls(locked).length).toBe(1);
    caption.click();
    try {
      expect(controls(locked).length).toBe(2);
      expect(controls(locked).every((c) => c.disabled)).toBe(true);
      expect(locked.querySelector(".ext-lock")).not.toBeNull();
    } finally { caption.click(); }
  });

  it("hands the rows back when the holder lets go, and says it only once while held", () => {
    const centre = fieldsTab();
    applyExtensionLocks(centre, extensionStates(held));
    const sentence = group(centre, "probe").querySelector(".ext-lock");
    applyExtensionLocks(centre, extensionStates(held));
    expect(group(centre, "probe").querySelector(".ext-lock")).toBe(sentence);   // a quiet poll moves nothing
    applyExtensionLocks(centre, extensionStates(undefined));
    expect(group(centre, "probe").querySelector(".ext-lock")).toBeNull();
    expect(controls(group(centre, "probe")).every((c) => !c.disabled)).toBe(true);
  });

  it("does not hand back rows inside a page locked for its own reasons", () => {
    const centre = fieldsTab();
    lockControls(centre, true);   // the whole card's deck held
    applyExtensionLocks(centre, extensionStates(undefined));
    expect(controls(group(centre, "cues")).every((c) => c.disabled)).toBe(true);
  });

  it("is a box's lock only for that box: the same extension elsewhere stays editable", () => {
    const centre = fieldsTab();
    applyExtensionLocks(centre, extensionStates({ b_other: { probe: { writable: false, lockedBy: ["bo@bo-ws"] } } }));
    expect(controls(group(centre, "probe")).every((c) => !c.disabled)).toBe(true);
  });
});

describe("whose shard a node's values are in", () => {
  it("is its box's, or the project's own for the project and the map's tags", () => {
    expect(extensionOwner(project, "card", "c_bell")).toBe("b_harbour");
    expect(extensionOwner(project, "tag", "t_dock")).toBe("@project");
    expect(extensionOwner(project, "project", "proj_probe")).toBe("@project");
  });

  it("is what the rows say they write, so Project Settings locks by the root's shard", () => {
    const rows = extensionFields({ project: () => project, save: vi.fn() }, probe, "project", "proj_probe");
    expect(rows.dataset["extVc"]).toBe("ext:@project:probe");
    const root = document.createElement("div");
    root.append(rows);
    applyExtensionLocks(root, extensionStates({ "@project": { probe: { writable: false, lockedBy: ["al"] } } }));
    expect(rows.querySelector(".ext-lock")?.textContent).toBe("Probe's data here is locked by al.");
    expect(controls(rows).every((c) => c.disabled)).toBe(true);
  });
});

describe("the badges", () => {
  it("fold a box's extension shards into its row, never as new", () => {
    expect(vcKeys.box("b_harbour").split(" ")).toContain("ext:b_harbour");
    expect(vcKeys.projectRow.split(" ")).toEqual(["project", "ext:@project"]);
    expect(extensionRowStates({
      b_harbour: { probe: { writable: true, dirty: true, untracked: true }, cues: { writable: true, checkedOutByMe: true } },
    })).toEqual([{ key: "ext:b_harbour", writable: true, dirty: true, checkedOutByMe: true }]);
  });

  it("word the lock as Patterpad does", () => {
    expect(extensionLockMessage("Probe", ["bo", "al"])).toBe("Probe's data here is locked by bo, al.");
    expect(extensionLockMessage("Probe", [])).toBe("Probe's data here is locked by someone else.");
  });
});
