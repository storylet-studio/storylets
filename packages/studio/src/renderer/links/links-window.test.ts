// @vitest-environment jsdom
// The Links window as a window (links.ts): it follows the editor until the
// author walks away, an explicit Links... request or a project change brings it
// back, the same card redrawn keeps its stage (camera, selection) rather than
// tearing it down, and Escape drops a selection or a marquee before it closes.
// Main is a stand-in, and so is the canvas: what is under test is the window.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkCard, LinksView } from "../../shared/api.js";

const canvas = { mounts: 0, setItems: 0, fits: 0, destroyed: 0, selected: [] as string[] };
vi.mock("konva", () => ({ default: {} }));
vi.mock("../src/canvas-tokens.js", () => ({ readCanvasTokens: () => ({}), watchCanvasTokens: () => () => undefined }));
vi.mock("../src/node-art.js", () => ({
  drawCardNode: () => undefined, paintCaptions: () => undefined, paintEdges: () => undefined,
  NODE_H: 80, NODE_W: 160, NODE_RADIUS: 6, TITLE_FLOOR: 0.5,
}));
vi.mock("../src/card-open.js", () => ({
  mountOpenChip: () => ({ show: () => undefined, hide: () => undefined, hideSoon: () => undefined, target: () => undefined, destroy: () => undefined }),
}));
vi.mock("../src/edge-key.js", () => ({ edgeKeyButton: () => document.createElement("button"), edgeTip: () => () => undefined }));
vi.mock("../src/canvas-surface.js", () => ({
  mountCanvasSurface: () => {
    canvas.mounts++;
    return {
      setItems: () => { canvas.setItems++; }, setBackdrop: () => undefined, setTokens: () => undefined,
      fitAll: () => { canvas.fits++; }, selection: () => [...canvas.selected], scale: () => 1,
      screenRect: () => undefined, destroy: () => { canvas.destroyed++; },
    };
  },
}));

const card = (id: string): LinkCard => ({ id, gameId: id, title: id, deck: "k_1", deckTitle: "Deck", box: "b_1" });
const viewOf = (id: string | undefined): LinksView => ({
  hasProject: true, card: id === undefined ? undefined : card(id),
  predecessors: [{ card: card("c_before"), cls: "enable", via: [] }], dependents: [], notes: [], pinned: true,
});

/** What the editor has selected, as main would answer `linksFor(undefined)`. */
let editorFocus: string | undefined = "c_one";
const handlers: { focus?: (id: string | undefined) => void; reset?: () => void } = {};
const studio = {
  getState: vi.fn(async () => ({ theme: "system" })),
  onTheme: vi.fn(), onWindowPinned: vi.fn(),
  linksFor: vi.fn(async (id?: string) => viewOf(id ?? editorFocus)),
  onLinkFocus: (h: (id: string | undefined) => void) => { handlers.focus = h; },
  onLinkReset: (h: () => void) => { handlers.reset = h; },
  setLinksPinned: vi.fn(), closeLinks: vi.fn(async () => undefined), searchReveal: vi.fn(),
};

const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const followToggle = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>(".swin-follow")!;
const esc = (): void => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); };

beforeAll(async () => {
  document.body.innerHTML = `<div id="links"></div>`;
  (window as unknown as { studio: typeof studio }).studio = studio;
  await import("./links.js");
  await settle();
});

beforeEach(async () => {
  // Back to following the editor's first card, on a fresh stage.
  editorFocus = "c_one";
  handlers.reset!();
  await settle();
  canvas.mounts = 0; canvas.setItems = 0; canvas.fits = 0; canvas.selected = [];
  studio.linksFor.mockClear(); studio.closeLinks.mockClear();
});

describe("the Links window", () => {
  it("keeps the stage when the editor re-sends the same card: no teardown, no refit", async () => {
    handlers.focus!("c_one");
    await settle();
    expect(canvas.mounts).toBe(0);
    expect(canvas.fits).toBe(0);
    expect(canvas.setItems).toBe(1);
  });

  it("follows the editor to another card with a fresh stage", async () => {
    editorFocus = "c_two";
    handlers.focus!(undefined);
    await settle();
    expect(canvas.mounts).toBe(1);
    expect(canvas.fits).toBe(1);
  });

  it("stops following once walked, and an explicit request brings it back", async () => {
    followToggle().click();   // stay on this card
    expect(followToggle().getAttribute("aria-pressed")).toBe("false");
    editorFocus = "c_two";
    handlers.focus!(undefined);   // ordinary selection-follow
    await settle();
    expect(studio.linksFor).not.toHaveBeenCalled();
    handlers.focus!("c_three");   // Links... on a card
    await settle();
    expect(studio.linksFor).toHaveBeenCalledWith("c_three");
    expect(followToggle().getAttribute("aria-pressed")).toBe("true");
  });

  it("follows again after a project change, on a fresh stage even for the same card id", async () => {
    followToggle().click();
    handlers.reset!();
    await settle();
    expect(followToggle().getAttribute("aria-pressed")).toBe("true");
    expect(canvas.mounts).toBe(1);
  });

  it("keeps the focus on the follow toggle when it is pressed", async () => {
    followToggle().click();   // off
    followToggle().focus();
    followToggle().click();   // on again: the view reloads underneath
    await settle();
    expect(document.activeElement).toBe(followToggle());
  });

  it("drops a selection on Escape before it closes", async () => {
    canvas.selected = ["c_before"];
    esc();
    expect(studio.closeLinks).not.toHaveBeenCalled();
    canvas.selected = [];
    esc();
    expect(studio.closeLinks).toHaveBeenCalledTimes(1);
  });

  it("abandons a marquee on Escape rather than closing", async () => {
    const stage = document.querySelector(".lbody")!;
    stage.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    esc();
    expect(studio.closeLinks).not.toHaveBeenCalled();
    document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  it("says what to do with no project open", async () => {
    studio.linksFor.mockResolvedValueOnce({ ...viewOf(undefined), hasProject: false });
    handlers.reset!();
    await settle();
    expect(document.querySelector(".lbody .empty")?.textContent).toBe("Open a project to see how its cards link.");
  });
});
