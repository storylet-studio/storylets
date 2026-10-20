// The view extensions' main host (ipc/views.ts) with Electron and the shell's view host stood in for, on the
// internal "probe" project: an undone Add Extension... closes the view it offered, an author's key installs
// nothing, the views are worked out again only when the project's extensions change and only the latest answer
// is taken, and two quick asks to open a view open one window.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseManifest } from "@wildwinter/toolkit/extensions";
import type { InstalledExtension } from "@wildwinter/app-shell/view-host";

const shell = vi.hoisted(() => ({
  installed: [] as unknown[],
  scans: 0,
  /** Each scan waits for this, when set, so a test can finish them out of order. */
  hold: null as null | (() => Promise<void>),
  opened: [] as { close: ReturnType<typeof vi.fn>; window: { isDestroyed: () => boolean; show: () => void; focus: () => void } }[],
  installs: 0,
  onInstall: null as null | (() => void),
  pick: "",
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/user-data", isPackaged: true },
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [shell.pick] }), showMessageBox: async () => ({ response: 0 }) },
}));
vi.mock("@wildwinter/app-shell/tool-window", () => ({
  pinToolWindow: () => undefined, rescueToolWindow: () => undefined, savedWindowRect: () => ({ width: 1, height: 1 }),
}));
vi.mock("../windows.js", () => ({ watchInDev: () => undefined }));
vi.mock("@wildwinter/app-shell/view-host", () => ({
  installedExtensions: async () => {
    shell.scans++;
    const now = [...shell.installed];
    if (shell.hold) await shell.hold();
    return now;
  },
  chooseInstalled: (installed: InstalledExtension[], id: string, pinned?: string) => {
    const found = installed.find((x) => x.id === id && x.version === pinned);
    return found ? { installed: found } : { installed: null, why: "not installed" };
  },
  openViewWindow: () => {
    const w = { close: vi.fn(), window: { isDestroyed: () => false, show: () => undefined, focus: () => undefined }, meta: { window: shell.opened.length + 1 } };
    shell.opened.push(w);
    return w;
  },
  readExtensionPackage: async () => ({
    ok: true, manifest: parseManifest(readFileSync(join(packageDir, "probe.extension.json"), "utf8")), problems: [],
    files: new Map([["probe.extension.json", readFileSync(join(packageDir, "probe.extension.json"))]]),
  }),
  installExtensionPackage: async () => { shell.installs++; shell.onInstall?.(); return { ok: true, installed: { version: "1.1.0" } }; },
}));

const fixtures = fileURLToPath(new URL("../../../../ops/test/fixtures/", import.meta.url));
const packageDir = join(fixtures, "probe-extension-package");

const { createViewHost } = await import("./views.js");
const { openProject } = await import("../project.js");
const { writeRemote } = await import("../remote.js");

function host() {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-view-host-main-")), "copy.storylets");
  cpSync(join(fixtures, "probe-extension.storylets"), dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  let session: typeof opened.session | undefined = opened.session;
  const menu = vi.fn();
  const editor = { isDestroyed: () => false };
  const views = createViewHost({
    session: () => session, editor: () => editor as never, menu,
    store: () => ({ window: () => ({ bounds: () => undefined, remember: () => undefined, pinned: () => true, setPinned: () => undefined }) }) as never,
  });
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  views.register({ handle: (c: string, f: (...args: unknown[]) => unknown) => handlers.set(c, f), write: () => undefined } as never);
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args) as Promise<unknown>;
  return { session: opened.session, views, menu, call, closeProject: () => { session = undefined; } };
}

const probe = (): InstalledExtension => ({
  id: "probe", version: "1.1.0", root: "/views/probe/1.1.0", manifest: parseManifest(readFileSync(join(packageDir, "probe.extension.json"), "utf8")),
});

beforeEach(() => {
  shell.installed = [probe()];
  shell.scans = 0;
  shell.hold = null;
  shell.opened = [];
  shell.installs = 0;
  shell.onInstall = null;
  shell.pick = packageDir;
});

describe("the views' windows", () => {
  it("close when the project stops offering their view (an undone Add Extension...)", async () => {
    const { session, views, call } = host();
    expect(await call("view:open", "probe", "inspect")).toBeUndefined();
    expect(shell.opened).toHaveLength(1);
    session.loaded.source!.project.extensions = {};
    await views.refresh();
    expect(shell.opened[0]!.close).toHaveBeenCalledTimes(1);
    expect(views.isView(shell.opened[0]!.window as never)).toBe(false);
  });

  it("open once for two quick asks, the second waiting for the first", async () => {
    const { call } = host();
    const [a, b] = await Promise.all([call("view:open", "probe", "inspect"), call("view:open", "probe", "inspect")]);
    expect([a, b]).toEqual([undefined, undefined]);
    expect(shell.opened).toHaveLength(1);
  });
});

describe("working out the project's views", () => {
  it("doesn't read the disk again while the project's extensions are unchanged, unless asked to", async () => {
    const { views } = host();
    await views.refresh();
    await views.refresh();
    expect(shell.scans).toBe(1);
    await views.refresh(true);
    expect(shell.scans).toBe(2);
  });

  it("takes only the latest answer when an earlier scan finishes last", async () => {
    const { views } = host();
    let releaseFirst!: () => void;
    shell.hold = () => new Promise<void>((r) => { releaseFirst = r; });
    shell.installed = [];
    const first = views.refresh(true);     // sees nothing installed, and is held
    shell.hold = null;
    shell.installed = [probe()];
    await views.refresh(true);             // sees probe installed, and finishes first
    releaseFirst();
    await first;
    expect(views.offered()[0]!.choice.installed?.version).toBe("1.1.0");
  });
});

describe("Add Extension...", () => {
  it("installs nothing for a project fetched with an author's key, which may not take an extension", async () => {
    const { session, call } = host();
    writeRemote(session.loaded.dir, {
      schema: "storylets/server-provenance@0", server: "http://venue", installation: "i", version: "1", revision: 1, role: "author",
    } as never);
    expect(await call("extension:add")).toEqual({ error: expect.stringContaining("so nothing was added") });
    expect(shell.installs).toBe(0);
  });

  it("says the views were installed when the commit can't land after the install (the project changed meanwhile)", async () => {
    const { call, closeProject } = host();
    shell.onInstall = closeProject;
    const r = await call("extension:add") as { error?: string };
    expect(shell.installs).toBe(1);
    expect(r.error).toBe("The project changed meanwhile, so it wasn't added. Probe's views were installed on this machine.");
  });
});
