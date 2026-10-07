// ---------------------------------------------------------------------------
// The bridge's channels, both ends against the contract (shared/api.ts).
//
// The types already refuse a channel spelt two ways and an argument list that
// drifts. What they cannot see is COVERAGE: a channel the preload invokes that
// main never handles answers with "No handler registered" at the moment
// somebody clicks, and a handler nobody invokes is dead weight that looks
// load-bearing. So both ends are run here, Electron stood in for: the preload
// is loaded and every bridge method called, recording what it touches; main's
// domains are registered through a recording `Ipc`. Each list is then held to
// the contract's.
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it, vi } from "vitest";
import { INVOKE_CHANNELS, PUSH_CHANNELS, SEND_CHANNELS } from "../shared/api.js";
import type { StudioApi } from "../shared/api.js";

const touched = { invoke: [] as string[], on: [] as string[], send: [] as string[] };
let bridge: StudioApi | undefined;
/** Which method was being called when a channel was touched. */
let calling = "";
const invokedBy = new Map<string, string>();
/** Every listener the preload put on a channel, to be fired once. */
const heard: ((...args: unknown[]) => void)[] = [];

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (_name: string, api: StudioApi) => { bridge = api; } },
  ipcRenderer: {
    invoke: (channel: string) => { touched.invoke.push(channel); invokedBy.set(channel, calling); return Promise.resolve(undefined); },
    on: (channel: string, listener: (...args: unknown[]) => void) => { touched.on.push(channel); heard.push(listener); },
    send: (channel: string) => { touched.send.push(channel); },
    removeListener: () => undefined,
  },
  // Main's modules, imported for their registration only: nothing here runs.
  ipcMain: { handle: () => undefined, on: () => undefined, removeListener: () => undefined },
  app: { getVersion: () => "0.0.0", isPackaged: false, getAppPath: () => "/", getPath: () => "/" },
  dialog: {}, shell: {}, protocol: {}, autoUpdater: { on: () => undefined }, safeStorage: {},
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
}));
// The shell's window kit imports Electron itself, from outside the bundle the
// mock above reaches.
vi.mock("@wildwinter/app-shell/tool-window", () => ({ defineToolWindows: () => undefined, pinToolWindow: () => undefined }));

/** The updater's channels are the shell's, and held by updater-channels.test.ts. */
const shellOwned = (channel: string): boolean => channel.startsWith("updater:");

async function loadPreload(): Promise<StudioApi> {
  await import("./index.js");
  if (!bridge) throw new Error("the preload exposed nothing");
  const api = bridge;
  // Every method, called once: an invoke records its channel, an `on…` its
  // listener. Arguments do not matter, since nothing answers.
  for (const name of Object.keys(api) as (keyof StudioApi)[]) {
    calling = name;
    const method = api[name] as (...args: unknown[]) => unknown;
    method(() => Promise.resolve(0));
  }
  // ...and every listener heard once, which is how the replies a question sends
  // back (the leaving prompt's "shown" and its answer) are reached.
  for (const listener of heard) listener({}, { cancelId: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return api;
}

describe("the preload", () => {
  beforeAll(async () => { await loadPreload(); });

  it("invokes every channel of the contract, each from the method the contract names", async () => {
    expect([...touched.invoke].sort()).toEqual(Object.keys(INVOKE_CHANNELS).sort());
    for (const [channel, method] of Object.entries(INVOKE_CHANNELS)) {
      expect(invokedBy.get(channel), channel).toBe(method);
    }
  });

  it("invokes each channel from one method only", async () => {
    expect(new Set(touched.invoke).size).toBe(Object.keys(INVOKE_CHANNELS).length);
  });

  it("listens only on channels main is declared to send, and on all of them", async () => {
    const heard = new Set(touched.on.filter((c) => !shellOwned(c)));
    expect([...heard].sort()).toEqual(Object.keys(PUSH_CHANNELS).sort());
  });

  it("sends only on channels main is declared to hear", async () => {
    const sent = new Set(touched.send.filter((c) => !shellOwned(c)));
    expect([...sent].sort()).toEqual(Object.keys(SEND_CHANNELS).sort());
  });
});

describe("main", () => {
  async function registered(): Promise<string[]> {
    const { registerAll } = await import("../main/ipc/index.js");
    const { createExchange } = await import("../main/exchange.js");
    const { createLiveLinkHost } = await import("../main/live-link-host.js");
    const { createCoverage } = await import("../main/ipc/coverage.js");
    const { createLaunch } = await import("../main/launch-host.js");
    const { createWindowsIpc } = await import("../main/ipc/windows.js");
    const channels: string[] = [];
    const recording = {
      handle: (channel: string) => { channels.push(channel); },
      write: (channel: string) => { channels.push(channel); },
    };
    // Registration reads none of what a domain is given: every handler reads
    // through it later. So a context of nothing at all will do.
    const nothing = new Proxy({}, { get: () => () => undefined }) as never;
    const exchange = createExchange(nothing);
    const hosts = [exchange, createLiveLinkHost(nothing), createCoverage(nothing, nothing), createLaunch(nothing, exchange), createWindowsIpc(nothing)];
    registerAll(recording as never, new Proxy({ hosts }, {
      get: (target, key) => (key === "hosts" ? target.hosts : () => undefined),
    }) as never);
    return channels;
  }

  it("handles every channel of the contract, and no channel outside it", async () => {
    expect([...(await registered())].sort()).toEqual(Object.keys(INVOKE_CHANNELS).sort());
  });

  it("handles each channel once (a second ipcMain.handle on one channel throws at startup)", async () => {
    const channels = await registered();
    expect(channels.length).toBe(new Set(channels).size);
  });
});
