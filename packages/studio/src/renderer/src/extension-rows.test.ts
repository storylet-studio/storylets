// @vitest-environment jsdom
// Storylet extensions on Storyletter's pages (tier 1, on the internal test extension "probe"): the card's
// values after the box's own on Fields, a field the extension claims drawn with its label and help, the
// outcome's values in its block, a tab named for the extension on a box's page, values saved through the host,
// and a problem in an extension shard landing on the node it names.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderBoxTabBody, renderCardWorkspace } from "./inspector.js";
import { adapterOf, extensionTabs, knownTab } from "./extension-rows.js";
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
      claims: [{ field: "mood", decl: { name: "mood", type: "enum", values: ["calm", "tense"], label: "Mood", help: "The card's mood, as the probe reads it.", valueHelp: { tense: "Clipped." } } }],
    },
    outcome: { fields: [{ name: "line", type: "text", label: "Line" }], claims: [] },
    box: { fields: [{ name: "theme", type: "text", label: "Theme" }], claims: [] },
  },
  values: { c_bell: { note: "Ring it twice.", act: "opening", cue: { sound: "bell" } }, o_ring: { line: "The bell rings." }, b_harbour: { theme: "salt" } },
};
const project = { boxes: [box], extensions: [probe], extensionNodes: { card: [{ id: "c_bell", label: "bell" }] }, projectNode: "proj_probe" } as unknown as ProjectDto;

const host = (save = vi.fn()): InspectorHost => ({
  openThreads: () => 0, showComments: vi.fn(), saveCard: vi.fn(), saveDeckConfig: vi.fn(), deleteCard: vi.fn(),
  saveBox: vi.fn(), saveTemplate: vi.fn(), saveTagGroup: vi.fn(), saveHand: vi.fn(), deleteTemplate: vi.fn(),
  deleteTagGroup: vi.fn(), deleteHand: vi.fn(), renameStage: vi.fn(), stageGates: async () => 0, setGroupSpatial: vi.fn(),
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
    expect(centre.querySelector(".ext-heading")?.textContent).toBe("Probe");
    expect(centre.querySelector(".ext-group")?.textContent).toBe("Sound");
    const captions = [...centre.querySelectorAll(".shell-fieldrow-label")].map((c) => c.textContent);
    expect(captions.slice(0, 4)).toEqual(["Mood", "Note", "act", "Cue"]);
    expect(centre.textContent).toContain("A line for the crew.");
    // The tab counts the extension's values with the box's.
    expect([...centre.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Fields"))?.textContent).toContain("4");
    // A stage the extension has renamed says so, in place of the row's own "not one of the stages".
    const act = [...centre.querySelectorAll(".shell-fieldrow")].find((r) => r.querySelector(".shell-fieldrow-label")?.textContent === "act")!;
    expect(act.querySelector(".shell-fieldrow-problem")?.textContent).toBe("Probe has since renamed this stage “setup”. Pick “setup” to update it.");
  });

  it("draws a claimed field with the extension's label and help, keeping the box's value", () => {
    const centre = fieldsTab(host());
    const mood = [...centre.querySelectorAll(".shell-fieldrow")].find((r) => r.querySelector(".shell-fieldrow-label")?.textContent === "Mood")!;
    expect(mood.textContent).toContain("The card's mood, as the probe reads it.");
    expect(mood.querySelector("select")!.value).toBe("tense");
    // The chosen value's own help, from the claim, under the control.
    expect(mood.querySelector(".shell-fieldrow-valuehelp")?.textContent).toBe("Clipped.");
  });

  it("saves an extension value through the host, by node and field", () => {
    const save = vi.fn();
    const centre = fieldsTab(host(save));
    const note = [...centre.querySelectorAll<HTMLInputElement>(".ext-fields input")][0]!;
    note.value = "Ring it once.";
    note.dispatchEvent(new Event("input", { bubbles: true }));
    expect(save).toHaveBeenLastCalledWith("probe", "c_bell", "note", "Ring it once.", expect.any(Function));
    const sound = [...centre.querySelectorAll<HTMLInputElement>(".ext-fields input")][1]!;
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
    expect([...body.querySelectorAll<HTMLInputElement>(".ext-fields input")][0]!.value).toBe("The bell rings.");
  });
});

describe("a tab named for the extension", () => {
  it("is offered on a box's page, counted, and draws the box's values", () => {
    expect(extensionTabs(project, "box", box.id)).toEqual([{ key: "ext:probe", label: "Probe", count: 1 }]);
    expect(extensionTabs(project, "deck", deck.id)).toEqual([]);
    const centre = document.createElement("div");
    renderBoxTabBody(centre, box, "ext:probe", host());
    expect(centre.querySelector<HTMLInputElement>(".ext-fields input")!.value).toBe("salt");
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
      card: { fields: [{ name: "to", type: "pick", label: "To", from: [{ words: ["all"] }, { to: "card" }, { list: "places" }] }], claims: [] },
      project: { fields: [{ name: "places", type: "list", of: { type: "text" } }], claims: [] },
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
