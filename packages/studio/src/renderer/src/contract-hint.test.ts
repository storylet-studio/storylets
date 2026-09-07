// @vitest-environment jsdom
// The venue's claim on a name, in the document that carries the name
// (design/engine-server.md 4.11). The line and the mark are a HINT, never a
// refusal - the refusal is the server's, on push - and the loose end this file
// closes is what happens while the rename is being typed: the claim is on the
// NAME the venue bound, so it lets go the moment the address stops being that
// name. Until 2026-09-07 the line, the dashed mark and the tooltip all stood
// until the page was re-entered, and the problems bar next door was already
// right, so the two surfaces disagreed on screen.
//
// ...and the second half: under an author's key the shape is read-only, the
// chip is disabled with everything else on the page, and it went on offering
// the click that opens an editor nothing would open.

import { describe, expect, it, vi } from "vitest";
import { refreshGameIds, renderHandWorkspace } from "./inspector.js";
import type { InspectorHost } from "./inspector.js";
import { lockControls } from "./vc-view.js";
import type { BoxDto, HandDetail } from "../../shared/api.js";

const box: BoxDto = {
  id: "b_1", gameId: "street", ranking: { specificity: true },
  fields: [], properties: [], decks: [], templates: [], tagGroups: [], hands: [],
};

const bound = (over: Partial<HandDetail> = {}): HandDetail => ({
  id: "h_1", gameId: "the-wall",
  chosen: [],
  movableFrom: [],
  slots: "",
  properties: [],
  templates: [],
  groups: [],
  contract: ["Dealt at the-park"],
  ...over,
});

const host = (over: Partial<InspectorHost> = {}): InspectorHost => ({
  openThreads: () => 0, showComments: vi.fn(),
  saveCard: vi.fn(), saveDeck: vi.fn(), saveDeckConfig: vi.fn(),
  deleteCard: vi.fn(), deleteDeck: vi.fn(),
  saveBox: vi.fn(), saveBoxIdentity: vi.fn(), saveTemplate: vi.fn(), saveTagGroup: vi.fn(), saveHand: vi.fn(),
  createTemplate: vi.fn(), deleteTemplate: vi.fn(), createTagGroup: vi.fn(), createMap: vi.fn(),
  deleteTagGroup: vi.fn(), setGroupSpatial: vi.fn(), createHand: vi.fn(), deleteHand: vi.fn(),
  ...over,
} as InspectorHost);

/** The hand's page, drawn into a host that is really in the document (the
 *  address chip's editor is an anchored popover, and an anchor nothing can
 *  measure never opens). */
function draw(detail: HandDetail, h: InspectorHost = host()): HTMLElement {
  const centre = document.createElement("div");
  document.body.replaceChildren(centre);
  renderHandWorkspace(centre, box, detail, [], h);
  return centre;
}

const chip = (centre: HTMLElement): HTMLButtonElement =>
  centre.querySelector<HTMLButtonElement>(".doc-head .gid")!;

const claim = (centre: HTMLElement): string[] =>
  [...centre.querySelectorAll<HTMLElement>(".doc-contract")]
    .filter((line) => !line.hidden)
    .map((line) => line.textContent ?? "");

/** Rename in place through the chip's own editor: click it, type, Set. */
function rename(centre: HTMLElement, to: string): void {
  chip(centre).click();
  const input = document.querySelector<HTMLInputElement>(".shell-id-input");
  if (!input) throw new Error("the address editor did not open");
  input.value = to;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector<HTMLButtonElement>(".shell-id-set")!.click();
}

describe("a venue's claim on a hand's name", () => {
  it("says what the venue does with it, and marks the address it depends on", () => {
    const centre = draw(bound());
    expect(claim(centre)).toEqual(["Dealt at the-park"]);
    expect(chip(centre).classList.contains("gid-bound")).toBe(true);
    expect(chip(centre).title).toContain("Dealt at the-park");
    // Marked, never disabled: the refusal is the server's, on push.
    expect(chip(centre).disabled).toBe(false);
  });

  it("lets the claim go the moment the address stops being the bound name", () => {
    const saveHand = vi.fn();
    const centre = draw(bound(), host({ saveHand }));
    rename(centre, "the-long-wall");
    expect(saveHand).toHaveBeenCalled();

    // Nothing has been re-entered, and the page already agrees with the problems
    // bar: this hand is not the one the venue bound any more.
    expect(chip(centre).textContent).toContain("the-long-wall");
    expect(claim(centre)).toEqual([]);
    expect(chip(centre).classList.contains("gid-bound")).toBe(false);
    expect(chip(centre).title).not.toContain("Dealt at the-park");
  });

  it("takes the claim back when the bound name is typed back", () => {
    const centre = draw(bound());
    rename(centre, "the-long-wall");
    expect(claim(centre)).toEqual([]);
    rename(centre, "the-wall");
    expect(claim(centre)).toEqual(["Dealt at the-park"]);
    expect(chip(centre).classList.contains("gid-bound")).toBe(true);
  });

  it("says nothing at all for a hand no venue depends on", () => {
    const centre = draw(bound({ contract: undefined }));
    expect(centre.querySelector(".doc-contract")).toBeNull();
    expect(chip(centre).classList.contains("gid-bound")).toBe(false);
  });
});

describe("the address chip when the page cannot be typed in", () => {
  it("offers the click while the page is the author's to change", () => {
    const centre = draw(bound({ gameId: "the-wall", contract: undefined }));
    expect(chip(centre).title).toContain("click to override");
  });

  it("drops the click hint once the page is shut", () => {
    // What an author's key does to a shape shard, and what a held shard does to
    // any of them: the same mechanism, and it runs after the document is drawn.
    const centre = draw(bound({ contract: undefined }));
    lockControls(centre, true);
    refreshGameIds(centre);
    expect(chip(centre).disabled).toBe(true);
    expect(chip(centre).title).toContain("Game id");
    expect(chip(centre).title).not.toContain("click");
  });

  it("offers it again when the page is opened up", () => {
    const centre = draw(bound({ contract: undefined }));
    lockControls(centre, true);
    refreshGameIds(centre);
    lockControls(centre, false);
    refreshGameIds(centre);
    expect(chip(centre).disabled).toBe(false);
    expect(chip(centre).title).toContain("click to override");
  });
});
