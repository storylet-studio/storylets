// @vitest-environment jsdom
// The Board as a window (table.ts), against a stand-in main and the real
// Village: ruling Q's Escape, which clears a selected hand before it closes,
// and asks before closing a Board whose session has moved on from its opening
// deal, with the confirm Restart uses. Also: the hand header is reachable from
// the keyboard and keeps the focus across the render it causes, and Copy takes
// the journal through the shell's feedback.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadProjectFiles, parseProjectFiles, compileProject } from "@storylet-studio/compiler";
import { join } from "node:path";

// By directory: under jsdom, import.meta.url is not a file URL.
const village = join(import.meta.dirname, "../../../../../examples/the-village.storylets");
const { project } = parseProjectFiles(loadProjectFiles(village));
const { bundle } = compileProject(project!);

const studio = {
  getState: vi.fn(async () => ({ theme: "system", boardPinned: true, boardFollow: false, boardView: "list", boardBox: "" })),
  onTheme: vi.fn(), onWindowPinned: vi.fn(), onProjectChanged: vi.fn(),
  onLiveLinkStatus: vi.fn(), onLiveLinkFrame: vi.fn(),
  liveLinkStatus: vi.fn(async () => ({ state: "off" })),
  tableBundle: vi.fn(async () => ({ bundle: bundle!, name: "The Village", play: "solo", stamp: "s1" })),
  projectMaps: vi.fn(async () => []),
  projectHash: vi.fn(async () => "s1"),
  project: vi.fn(async () => ({ project: { dir: "/scratch/the-village.storylets" } })),
  closeBoard: vi.fn(async () => undefined),
  onBoardAskClose: vi.fn(),
  setBoardPinned: vi.fn(), setBoardFollow: vi.fn(), setBoardView: vi.fn(), setBoardBox: vi.fn(),
  searchReveal: vi.fn(),
};

/** Microtasks, then a turn of the event loop (the close waits one), then microtasks. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const esc = (): void => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); };
const selected = (): Element | null => document.querySelector(".hcell.sel");
const dialog = (): HTMLDialogElement | null => document.querySelector("dialog.confirm-dialog[open]");

beforeAll(async () => {
  // jsdom has no modal dialogs: enough of one for the shell's confirm.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
  document.body.innerHTML = `<div id="table"></div>`;
  (window as unknown as { studio: typeof studio }).studio = studio;
  await import("./table.js");
  await settle();
});

beforeEach(async () => {
  // A fresh session: the Restart button rebuilds, and asks only when it must.
  document.querySelectorAll("dialog").forEach((d) => d.remove());
  document.querySelector<HTMLButtonElement>(".tbar .btn:last-child")!.click();
  await settle();
  document.querySelector<HTMLButtonElement>("dialog[open] .confirm-btn.danger")?.click();
  await settle();
  studio.closeBoard.mockClear();
});

describe("the Board's Escape (ruling Q)", () => {
  it("clears a selected hand first, then closes an untouched session without asking", async () => {
    document.querySelector<HTMLElement>(".hhead")!.click();
    expect(selected()).not.toBeNull();
    esc();
    expect(selected()).toBeNull();
    expect(studio.closeBoard).not.toHaveBeenCalled();
    esc();
    await settle();
    expect(dialog()).toBeNull();
    expect(studio.closeBoard).toHaveBeenCalledTimes(1);
  });

  it("asks before closing once something has happened, and Cancel keeps the Board", async () => {
    document.querySelector<HTMLButtonElement>(".dial .btn.primary")!.click();   // Next turn
    esc();
    await settle();
    expect(dialog()?.textContent).toContain("Close the Board?");
    expect(dialog()?.textContent).toContain("The session and its journal are discarded.");
    // A second Escape belongs to the dialog, never a second confirm.
    esc();
    await settle();
    expect(document.querySelectorAll("dialog.confirm-dialog[open]")).toHaveLength(1);
    dialog()!.querySelector<HTMLButtonElement>(".cancel")!.click();
    await settle();
    expect(studio.closeBoard).not.toHaveBeenCalled();
  });

  it("asks from the close button too, and closes on the confirm", async () => {
    document.querySelector<HTMLButtonElement>(".dial .btn.primary")!.click();
    document.querySelector<HTMLButtonElement>(".swin-close")!.click();
    await settle();
    dialog()!.querySelector<HTMLButtonElement>(".danger")!.click();
    await settle();
    expect(studio.closeBoard).toHaveBeenCalledTimes(1);
  });

  it("asks when main stops a close it did not start (Ctrl+W, Alt+F4), as Escape does", async () => {
    const askClose = studio.onBoardAskClose.mock.calls[0]![0] as () => void;
    document.querySelector<HTMLButtonElement>(".dial .btn.primary")!.click();
    askClose();
    await settle();
    expect(dialog()?.textContent).toContain("Close the Board?");
    dialog()!.querySelector<HTMLButtonElement>(".cancel")!.click();
    await settle();
    expect(studio.closeBoard).not.toHaveBeenCalled();
  });
});

describe("the Board when the editor's project changes under it", () => {
  const changed = (): (() => void) => studio.onProjectChanged.mock.calls[0]![0] as () => void;
  const bar = (): string | undefined => document.querySelector(".stale-bar-msg")?.textContent ?? undefined;

  it("says another project was opened, and that restarting plays it", async () => {
    changed()();
    await settle();
    expect(bar()).toBe("Another project was opened in the editor. Restart to play it.");
  });

  it("says the project was closed when none is open now", async () => {
    studio.project.mockResolvedValueOnce(null as never);
    changed()();
    await settle();
    expect(bar()).toBe("The project was closed in the editor. Restart to clear the Board.");
  });
});

describe("the Board and the keyboard", () => {
  it("selects a hand from its header with Enter, and keeps the focus on it", () => {
    const head = document.querySelectorAll<HTMLElement>(".hhead")[1]!;
    head.focus();
    head.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const now = document.querySelectorAll<HTMLElement>(".hhead")[1]!;
    expect(now.closest(".hcell")!.classList.contains("sel")).toBe(true);
    expect(document.activeElement).toBe(now);
    expect(now.getAttribute("aria-pressed")).toBe("true");
  });

  it("labels its run settings as the family does", () => {
    expect(document.querySelector(".tbar .seed")!.textContent).toMatch(/^Seed /);
  });
});
