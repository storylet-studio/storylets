// The application menu against Patterpad's (the Storyletter review of 2026-10,
// item 24 and ruling O): the order of File, Edit and View, the platform's own
// quit word and full-screen item, the theme list, Cmd+P for the Board, and the
// items that need a project greyed when there is none.
//
// Electron is stood in for: the menu is built from a template, and the template
// is what these tests read.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import type { StudioState } from "../shared/api.js";

let built: MenuItemConstructorOptions[] = [];

vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.0", getPath: () => "/home/someone", isPackaged: true },
  shell: { openExternal: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => { built = template; return template; },
    setApplicationMenu: vi.fn(),
  },
}));
vi.mock("@wildwinter/app-shell/updater", () => ({ manualCheckForUpdates: vi.fn() }));

const STATE = {
  recents: [], theme: "system", autoRebuild: false, showResolved: false, reviewWalk: false,
  coverageOverlay: false, panes: { nav: true, inspector: false },
} as unknown as StudioState;

const realPlatform = process.platform;
afterEach(() => { Object.defineProperty(process, "platform", { value: realPlatform }); });

/** Build the menu as it is on `platform`, with or without a project. */
async function menuOn(platform: NodeJS.Platform, project = { open: true, deckFocused: true }): Promise<MenuItemConstructorOptions[]> {
  Object.defineProperty(process, "platform", { value: platform });
  vi.resetModules();
  const { refreshMenu } = await import("./menu.js");
  refreshMenu(undefined, STATE, false, undefined, false, project);
  return built;
}

const submenu = (menu: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] =>
  (menu.find((m) => m.label === label || (label === "Help" && m.role === "help"))?.submenu ?? []) as MenuItemConstructorOptions[];
/** Labels in order, roles by role name, separators as "-". */
const shape = (items: MenuItemConstructorOptions[]): string[] =>
  items.map((i) => (i.type === "separator" ? "-" : i.label ?? `role:${i.role}`));
const item = (items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions | undefined =>
  items.find((i) => i.label === label);
const everyItem = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? everyItem(i.submenu) : [])]);

describe("the Board's key (ruling O)", () => {
  it("is Cmd+P, as Play Scene is in Patterpad, and nothing else uses it", async () => {
    const menu = await menuOn("darwin");
    expect(item(submenu(menu, "Play"), "The Board")?.accelerator).toBe("CmdOrCtrl+P");
    const onP = everyItem(menu).filter((i) => i.accelerator === "CmdOrCtrl+P");
    expect(onP).toHaveLength(1);
  });
});

describe("File (item 24)", () => {
  it("keeps Open Recent and Close Project in the open group, as Patterpad does", async () => {
    const file = shape(submenu(await menuOn("darwin"), "File"));
    const firstBreak = file.indexOf("-");
    const openGroup = file.slice(0, firstBreak);
    expect(openGroup).toContain("Open Recent");
    expect(openGroup).toContain("Close Project");
  });

  it("says Quit on Linux and Exit only on Windows", async () => {
    const linux = submenu(await menuOn("linux"), "File");
    expect(linux.find((i) => i.role === "quit")?.label).toBe("Quit");
    const windows = submenu(await menuOn("win32"), "File");
    expect(windows.find((i) => i.role === "quit")?.label).toBe("Exit");
  });
});

describe("Edit (item 24)", () => {
  it("puts Duplicate below Select All", async () => {
    const edit = shape(submenu(await menuOn("darwin"), "Edit"));
    expect(edit.indexOf("Duplicate")).toBeGreaterThan(edit.indexOf("role:selectAll"));
  });
});

describe("View (item 24)", () => {
  it("runs hierarchy, then history, then panes, as Patterpad groups them", async () => {
    const view = shape(submenu(await menuOn("darwin"), "View"));
    const up = view.indexOf("Up a Level");
    const back = view.findIndex((l) => l === "Back");
    const nav = view.findIndex((l) => l.startsWith("Show"));
    expect(up).toBeGreaterThanOrEqual(0);
    expect(up).toBeLessThan(back);
    expect(back).toBeLessThan(nav);
  });

  it("leaves Enter Full Screen to macOS, and adds it elsewhere", async () => {
    expect(submenu(await menuOn("darwin"), "View").some((i) => i.role === "togglefullscreen")).toBe(false);
    expect(submenu(await menuOn("linux"), "View").some((i) => i.role === "togglefullscreen")).toBe(true);
  });

  it("lists Follow System first among the colour themes", async () => {
    const view = submenu(await menuOn("darwin"), "View");
    const themes = view.find((i) => i.label === "Colour Theme")?.submenu as MenuItemConstructorOptions[];
    expect(themes[0]?.label).toBe("Follow System");
  });

  it("keeps the developer items out of a packaged build", async () => {
    const view = submenu(await menuOn("darwin"), "View");
    expect(view.some((i) => i.role === "reload" || i.role === "toggleDevTools")).toBe(false);
  });
});

describe("items that need a project (item 24)", () => {
  const needing = ["Close Project", "Share Scopes with Other Tools…", "New Card", "Save", "The Board",
    "Publish Playable HTML…", "Publish Spreadsheet…", "Publish Bundle", "Export as Storyletpack…",
    "Merge Returned Storyletpack…"];

  it("are greyed with no project open", async () => {
    const all = everyItem(await menuOn("darwin", { open: false, deckFocused: false }));
    for (const label of needing) {
      const found = all.find((i) => i.label === label);
      expect(found, label).toBeDefined();
      expect(found?.enabled, label).toBe(false);
    }
  });

  it("are live with one open", async () => {
    const all = everyItem(await menuOn("darwin", { open: true, deckFocused: true }));
    for (const label of needing) expect(all.find((i) => i.label === label)?.enabled, label).not.toBe(false);
  });

  it("New Card waits for a deck to be in focus", async () => {
    const file = submenu(await menuOn("darwin", { open: true, deckFocused: false }), "File");
    expect(item(file, "New Card")?.enabled).toBe(false);
  });
});
