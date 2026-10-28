// Edit > Undo and Redo always went to the main window, whichever window had the focus, so Cmd+Z in the
// Search, Coverage or Links window, or on the Board, undid a project edit behind it. Another window gets its
// own text undo, as Select All already did, and as Patterpad's menu does (patter ee3b612); the main window
// still decides for itself (commands.ts, field-undo.ts).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import type { StudioState } from "../shared/api.js";

const state = vi.hoisted(() => ({ template: [] as MenuItemConstructorOptions[], focused: null as unknown }));

vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.0", getPath: () => "/home/someone", isPackaged: true },
  shell: { openExternal: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => state.focused },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => { state.template = template; return template; },
    setApplicationMenu: vi.fn(),
  },
}));
vi.mock("@wildwinter/app-shell/updater", () => ({ manualCheckForUpdates: vi.fn() }));

const { refreshMenu } = await import("./menu.js");

const STATE = {
  recents: [], theme: "system", autoRebuild: false, showResolved: false, reviewWalk: false,
  coverageOverlay: false, panes: { nav: true, inspector: false },
} as unknown as StudioState;

const fakeWindow = () => ({ webContents: { send: vi.fn(), undo: vi.fn(), redo: vi.fn(), selectAll: vi.fn() } });

const click = (label: string): void => {
  const edit = state.template.find((m) => m.label === "Edit")!;
  const item = (edit.submenu as MenuItemConstructorOptions[]).find((i) => i.label === label)!;
  (item.click as unknown as () => void)();
};

describe("Edit > Undo and Redo", () => {
  const main = fakeWindow();
  beforeEach(() => {
    vi.clearAllMocks();
    refreshMenu(main as never, STATE, false, undefined, false, { open: true, deckFocused: false });
  });

  it("in the editor, hand the choice to the editor's renderer", () => {
    state.focused = main;
    click("Undo");
    click("Redo");
    expect(main.webContents.send.mock.calls).toEqual([["menu", { cmd: "undo" }], ["menu", { cmd: "redo" }]]);
    expect(main.webContents.undo).not.toHaveBeenCalled();
  });

  it("in another window, undo that window's own text and leave the project alone", () => {
    const search = fakeWindow();
    state.focused = search;
    click("Undo");
    click("Redo");
    expect(search.webContents.undo).toHaveBeenCalledTimes(1);
    expect(search.webContents.redo).toHaveBeenCalledTimes(1);
    expect(main.webContents.send).not.toHaveBeenCalled();
  });

  it("with no window focused, still go to the editor", () => {
    state.focused = null;
    click("Undo");
    expect(main.webContents.send).toHaveBeenCalledWith("menu", { cmd: "undo" });
  });
});

describe("Edit > Undo and Redo in a view's window (view extensions)", () => {
  it("run the project's undo in the editor, never a field's typing there", () => {
    const main = fakeWindow();
    const view = fakeWindow();
    refreshMenu(main as never, STATE, false, undefined, false, {
      open: true, deckFocused: false, views: { items: [], isView: (w) => w === (view as unknown) },
    });
    vi.clearAllMocks();
    state.focused = view;
    click("Undo");
    click("Redo");
    expect(main.webContents.send.mock.calls).toEqual([["menu", { cmd: "undo", project: true }], ["menu", { cmd: "redo", project: true }]]);
    expect(view.webContents.undo).not.toHaveBeenCalled();
  });
});

// Edit > Undo and Redo name the step they'd take, as Patterpad's do (Patter's hands-on step 6, Q20); plain
// with nothing to take.
describe("Edit > Undo and Redo name their step", () => {
  const labels = (): string[] => {
    const edit = state.template.find((m) => m.label === "Edit")!;
    return (edit.submenu as MenuItemConstructorOptions[]).slice(0, 2).map((i) => i.label ?? "");
  };

  it("read plain Undo and Redo with nothing to take", () => {
    refreshMenu(fakeWindow() as never, STATE, false, undefined, false, { open: true, deckFocused: false });
    expect(labels()).toEqual(["Undo", "Redo"]);
  });

  it("name the step Undo and Redo would take", () => {
    const main = fakeWindow();
    refreshMenu(main as never, STATE, false, undefined, false, {
      open: true, deckFocused: false, undo: "Rename deck", redo: "Delete box",
    });
    expect(labels()).toEqual(["Undo Rename deck", "Redo Delete box"]);
    state.focused = main;
    click("Undo Rename deck");
    expect(main.webContents.send).toHaveBeenCalledWith("menu", { cmd: "undo" });
  });
});
