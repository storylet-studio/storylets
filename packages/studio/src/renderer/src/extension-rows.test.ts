// @vitest-environment jsdom
// Storylet extensions on Storyletter's pages (tier 1, on the internal test extension "probe"): the card's
// values after the box's own on Fields, the outcome's values in its block, a tab named for the extension on a box's page, values saved through the host,
// and a problem in an extension shard landing on the node it names.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderBoxTabBody, renderCardWorkspace } from "./inspector.js";
import { adapterOf, extensionFields, extensionSection, extensionTabs, knownTab, sweepExtensionFold } from "./extension-rows.js";
import { problemTarget } from "./problems.js";
import { setPlayRung } from "./play-ladder.js";
import { resetDocTabMemory, setDocTab } from "./doc-tab-memory.js";
import type { InspectorHost } from "./inspector.js";
import type { BoxDto, CardDto, DeckDto, ExtensionDto, ProjectDto } from "../../shared/api.js";

const card: CardDto = {
  id: "c_bell", gameId: "bell", title: "The bell", priority: "0", redraw: "always",
  tags: [], copies: "", sharedCopies: "", fields: [{ name: "mood", value: "tense" }],
  outcomes: [{ id: "o_ring", gameId: "ring", title: "Ring", changes: [], fields: [] }],
};
const deck: DeckDto = { id: "k_rumours", gameId: "rumours", properties: [], cards: [card] };
const box: BoxDto = {
  id: "b_harbour", gameId: "harbour", folder: "harbour", ranking: { specificity: true },
  fields: [{ name: "mood", type: "enum", values: ["calm", "tense"], default: "calm" }], outcomeFields: [],
  properties: [], decks: [deck], templates: [], tagGroups: [], hands: [],
};
const probe: ExtensionDto = {
  id: "probe", name: "Probe", version: "1.1.0",
  targets: {
    card: {
      fields: [
        { name: "note", type: "text", label: "Note", help: "A line for the crew." },
        { name: "act", type: "quality", stages: ["setup", "turn"], renamedStages: { opening: "setup" } },
        { name: "cue", type: "record", label: "Cue", group: "Sound", fields: [{ name: "sound", type: "text" }, { name: "gain", type: "number" }] },
      ],
    },
    outcome: { fields: [{ name: "line", type: "text", label: "Line" }] },
    box: { fields: [{ name: "theme", type: "text", label: "Theme" }] },
  },
  values: { c_bell: { note: "Ring it twice.", act: "opening", cue: { sound: "bell" } }, o_ring: { line: "The bell rings." }, b_harbour: { theme: "salt" } },
};
const project = { boxes: [box], extensions: [probe], extensionNodes: { card: [{ id: "c_bell", label: "bell" }] }, projectNode: "proj_probe" } as unknown as ProjectDto;

const host = (save = vi.fn()): InspectorHost => ({
  openThreads: () => 0, showComments: vi.fn(), saveCard: vi.fn(), saveDeckConfig: vi.fn(), deleteCard: vi.fn(),
  saveBox: vi.fn(), saveTemplate: vi.fn(), saveTagGroup: vi.fn(), saveHand: vi.fn(), deleteTemplate: vi.fn(),
  deleteTagGroup: vi.fn(), deleteHand: vi.fn(), renameStage: vi.fn(), renameProperty: vi.fn(), stageGates: async () => 0, setGroupSpatial: vi.fn(),
  handCards: async () => null, deckCatalogue: async () => [], openCardFromHand: vi.fn(), newCardAtHand: vi.fn(), openHand: vi.fn(),
  extensions: { project: () => project, save },
} as InspectorHost);

beforeEach(() => {
  setPlayRung("solo");
  resetDocTabMemory();
  Element.prototype.scrollIntoView = (): void => {};
});

describe("a card's Fields tab", () => {
  const fieldsTab = (h: InspectorHost): HTMLElement => {
    const centre = document.createElement("div");
    setDocTab(`card:${deck.id}/${card.id}`, "fields");
    renderCardWorkspace(centre, box, deck, card, [], h);
    return centre;
  };

  it("shows the box's fields, then the extension's under its name, grouped as the manifest says", () => {
    const centre = fieldsTab(host());
    expect(centre.querySelector(".ext-heading")?.textContent).toBe("Probe (3 set)");
    expect(centre.querySelector(".ext-group")?.textContent).toBe("Sound");
    const captions = [...centre.querySelectorAll(".shell-fieldrow-label")].map((c) => c.textContent);
    expect(captions.slice(0, 4)).toEqual(["mood", "Note", "act", "Cue"]);
    expect(centre.textContent).toContain("A line for the crew.");
    // The tab counts the extension's values with the box's.
    expect([...centre.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Fields"))?.textContent).toContain("4");
    // A stage the extension has renamed says so, in place of the row's own "not one of the stages".
    const act = [...centre.querySelectorAll(".shell-fieldrow")].find((r) => r.querySelector(".shell-fieldrow-label")?.textContent === "act")!;
    expect(act.querySelector(".shell-fieldrow-problem")?.textContent).toBe("Probe has since renamed this stage “setup”. Pick “setup” to update it.");
  });

  it("saves an extension value through the host, by node and field", () => {
    const save = vi.fn();
    const centre = fieldsTab(host(save));
    const note = [...centre.querySelectorAll<HTMLInputElement>(".ext-section input")][0]!;
    note.value = "Ring it once.";
    note.dispatchEvent(new Event("input", { bubbles: true }));
    expect(save).toHaveBeenLastCalledWith("probe", "c_bell", "note", "Ring it once.", expect.any(Function));
    const sound = [...centre.querySelectorAll<HTMLInputElement>(".ext-section input")][1]!;
    sound.value = "gong";
    sound.dispatchEvent(new Event("input", { bubbles: true }));
    expect(save).toHaveBeenLastCalledWith("probe", "c_bell", "cue", { sound: "gong" }, expect.any(Function));
  });
});

describe("an outcome's block", () => {
  it("carries the extension's values under its name", () => {
    const centre = document.createElement("div");
    setDocTab(`card:${deck.id}/${card.id}`, "outcomes");
    renderCardWorkspace(centre, box, deck, card, [], host());
    if (!centre.querySelector(".outcome-body")) centre.querySelector<HTMLButtonElement>("button.outcome-row")!.click();
    const body = centre.querySelector(".outcome-body")!;
    expect(body.textContent).toContain("Probe");
    expect([...body.querySelectorAll<HTMLInputElement>(".ext-section input")][0]!.value).toBe("The bell rings.");
  });
});

describe("a tab named for the extension", () => {
  it("is offered on a box's page, counted, and draws the box's values", () => {
    expect(extensionTabs(project, "box", box.id)).toEqual([{ key: "ext:probe", label: "Probe", count: 1 }]);
    expect(extensionTabs(project, "deck", deck.id)).toEqual([]);
    const centre = document.createElement("div");
    renderBoxTabBody(centre, box, "ext:probe", host());
    expect(centre.querySelector<HTMLInputElement>(".ext-section input")!.value).toBe("salt");
  });

  it("a remembered tab for an extension the page does not have falls back", () => {
    expect(knownTab(project, "deck", "ext:probe", "cards")).toBe("cards");
    expect(knownTab(project, "box", "ext:probe", "contents")).toBe("ext:probe");
    expect(knownTab(project, "box", "dealing", "contents")).toBe("dealing");
  });
});

describe("a problem in an extension shard", () => {
  it("lands on the node it names", () => {
    const at = (message: string) => problemTarget({ severity: "error", path: "harbour/probe.storyletextension", message }, [box]);
    expect(at("entries.card.c_bell.weight: too heavy")).toEqual({ kind: "card", box: "b_harbour", deck: "k_rumours", card: "c_bell", tab: "fields" });
    expect(at("entries.outcome.o_ring.line: wrong")).toMatchObject({ kind: "card", card: "c_bell", tab: "outcomes", outcome: "o_ring" });
    expect(at("entries.project.proj_probe.studio: wrong")).toEqual({ kind: "settings" });
    expect(problemTarget({ severity: "error", path: "extensions/probe.extension.json", message: "manifest x" }, [box])).toEqual({ kind: "settings" });
  });
});

describe("a pick", () => {
  const shot: ExtensionDto = {
    id: "shot", name: "Shot", version: "1.0.0",
    targets: {
      card: { fields: [{ name: "to", type: "pick", label: "To", from: [{ words: ["all"] }, { to: "card" }, { list: "places" }] }] },
      project: { fields: [{ name: "places", type: "list", of: { type: "text" } }] },
    },
    values: { proj_probe: { places: ["Quay"] }, c_bell: { to: "Quay" } },
  };
  const withShot = { ...project, extensions: [shot] } as unknown as ProjectDto;

  it("reads the extension's project lists off its saved values, or the host's values as they stand", () => {
    expect(adapterOf({ project: () => withShot, save: vi.fn() }, shot).list!("places")).toEqual(["Quay"]);
    expect(adapterOf({ project: () => withShot, save: vi.fn(), projectEntry: () => ({ places: ["Quay", "Gate"] }) }, shot).list!("places"))
      .toEqual(["Quay", "Gate"]);
    expect(adapterOf({ project: () => withShot, save: vi.fn() }, shot).list!("nowhere")).toBeUndefined();
  });

  it("offers its words, the cards and the list's entries on a card's Fields tab", () => {
    const h = { ...host(), extensions: { project: () => withShot, save: vi.fn() } } as InspectorHost;
    const centre = document.createElement("div");
    setDocTab(`card:${deck.id}/${card.id}`, "fields");
    renderCardWorkspace(centre, box, deck, card, [], h);
    const row = [...centre.querySelectorAll(".shell-fieldrow")].find((r) => r.querySelector(".shell-fieldrow-label")?.textContent === "To")!;
    const options = [...row.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["all", "bell", "Quay"]));
    expect(row.querySelector<HTMLElement>(".shell-fieldrow-problem")?.hidden ?? true).toBe(true);
  });
});

describe("the fold", () => {
  const spare: ExtensionDto = {
    id: "spare", name: "Spare", version: "1.0.0",
    targets: {
      card: { fields: [
        { name: "line", type: "text", label: "Line" },
        { name: "weight", type: "number", label: "Weight", default: 1 },
        { name: "loud", type: "boolean", label: "Loud" },
        { name: "cue", type: "record", label: "Cue", group: "Sound", fields: [{ name: "sound", type: "text", label: "Sound" }] },
      ] },
      deck: { fields: [{ name: "pile", type: "number", label: "Pile" }] },
      project: { fields: [{ name: "studio", type: "text", label: "Studio" }] },
    },
    // A value at its default, false, and a record of defaults are all unset (F1).
    values: { c_bell: { line: "Hush.", weight: 1, loud: false, cue: { sound: "" } }, c_tide: {}, k_rumours: { pile: 0 } },
  };
  const withSpare = { ...project, extensions: [spare], extensionNodes: { card: [{ id: "c_bell", label: "bell" }, { id: "c_tide", label: "tide" }] } } as unknown as ProjectDto;
  const xhost = { project: () => withSpare, save: vi.fn() };
  const labels = (el: HTMLElement): string[] => [...el.querySelectorAll(".shell-fieldrow-label")].map((c) => c.textContent ?? "");
  const caption = (el: HTMLElement): HTMLButtonElement => el.querySelector<HTMLButtonElement>(".shell-fold-cap")!;

  it("shows only the fields a node sets, and counts them in the caption (F1, F2)", () => {
    const sec = extensionSection(xhost, spare, "card", "c_bell");
    expect(caption(sec).textContent).toBe("Spare (1 set)");
    expect(caption(sec).getAttribute("aria-expanded")).toBe("false");
    expect(labels(sec)).toEqual(["Line"]);
    // No group heading above a group with nothing shown.
    expect(sec.querySelector(".ext-group")).toBeNull();
    // Nothing set: the caption alone.
    const bare = extensionSection(xhost, spare, "card", "c_tide");
    expect(caption(bare).textContent).toBe("Spare");
    expect(labels(bare)).toEqual([]);
  });

  it("opens to every field, and stays open from node to node (F3, F4)", () => {
    const sec = extensionSection(xhost, spare, "card", "c_bell");
    caption(sec).click();
    try {
      expect(caption(sec).getAttribute("aria-expanded")).toBe("true");
      expect(labels(sec)).toEqual(["Line", "Weight", "Loud", "Cue", "Sound"]);
      expect(sec.querySelector(".ext-group")?.textContent).toBe("Sound");
      expect(labels(extensionSection(xhost, spare, "card", "c_tide"))).toEqual(["Line", "Weight", "Loud", "Cue", "Sound"]);
    } finally { caption(sec).click(); }
    expect(labels(extensionSection(xhost, spare, "card", "c_tide"))).toEqual([]);
  });

  it("keeps a value cleared while folded until the author leaves the node (F5)", () => {
    sweepExtensionFold(); sweepExtensionFold();
    extensionSection(xhost, spare, "card", "c_bell");
    sweepExtensionFold();
    const cleared = { ...withSpare, extensions: [{ ...spare, values: { ...spare.values, c_bell: { weight: 1 } } }] } as unknown as ProjectDto;
    const chost = { project: () => cleared, save: vi.fn() };
    // Redrawn on the same node: Line stays, now empty.
    expect(labels(extensionSection(chost, cleared.extensions![0]!, "card", "c_bell"))).toEqual(["Line"]);
    sweepExtensionFold();
    // Another node drawn, then back: only what is set.
    extensionSection(chost, cleared.extensions![0]!, "card", "c_tide");
    sweepExtensionFold();
    expect(labels(extensionSection(chost, cleared.extensions![0]!, "card", "c_bell"))).toEqual([]);
  });

  it("folds an extension's own tab too, and the tab counts what the caption counts", () => {
    const deckSpare = { ...project, extensions: [spare] } as unknown as ProjectDto;
    expect(extensionTabs(deckSpare, "deck", deck.id)).toEqual([{ key: "ext:spare", label: "Spare", count: 0 }]);
    expect(extensionTabs({ ...deckSpare, extensions: [{ ...spare, values: { k_rumours: { pile: 3 } } }] } as unknown as ProjectDto, "deck", deck.id)[0]!.count).toBe(1);
  });

  it("leaves Project Settings unfolded: every field", () => {
    const rows = extensionFields(xhost, spare, "card", "c_tide");
    expect(rows.querySelector(".shell-fold-cap")).toBeNull();
    expect(labels(rows)).toEqual(["Line", "Weight", "Loud", "Cue", "Sound"]);
  });
});
