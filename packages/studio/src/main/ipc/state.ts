// ---------------------------------------------------------------------------
// The app's own settings and memory (store.ts): the theme, the panes, the
// places and choices remembered between runs, who is commenting, and the one
// way out to a browser.
// ---------------------------------------------------------------------------

import { shell } from "electron";
import { currentUserAsync } from "@wildwinter/simple-vc-lib";
import type { MainContext } from "../context.js";
import type { Ipc } from "./registrar.js";
import { push } from "./push.js";

/** The About dialog's links: the only external URLs the renderer can open. */
const ABOUT_LINKS = new Set(["https://storylets.dev", "https://ian.wildwinter.net"]);

export interface StateIpcDeps extends Pick<MainContext, "session" | "editor" | "store" | "windows" | "menu"> {
  /** The editor's page has a deck in focus, or not; true when that changed. */
  setDeckFocused(on: boolean): boolean;
}

export function registerState(ipc: Ipc, deps: StateIpcDeps): void {
  const store = (): ReturnType<MainContext["store"]> => deps.store();

  ipc.handle("state:get", () => store().get());

  // Clear Recents: every entry forgotten through the store's own forget, so a
  // per-project memory keyed on the path (the Board's view choice) goes with it.
  ipc.handle("state:clearRecents", (): void => {
    for (const r of store().get().recents) store().forgetProject(r.path);
    deps.menu();
  });

  ipc.handle("state:setTheme", (_event, theme) => {
    store().setTheme(theme);
    deps.menu();
    // Every open window, not just the one that asked. A tool window read the
    // theme once at boot and then kept it, so switching palette left the Find,
    // Links, Board and Coverage windows in the old one beside a re-themed editor.
    // Over the TABLE, not a hand-kept list: a fifth tool window is themed the
    // day it is added (ui-review-2026-09, finding 17).
    for (const w of [deps.editor(), ...deps.windows().all()]) {
      if (w && !w.isDestroyed()) push(w.webContents, "state:theme", theme);
    }
  });

  ipc.handle("state:setLastPlace", (_event, place) => store().setLastPlace(place));
  ipc.handle("state:setPanes", (_event, panes) => { store().setPanes(panes); deps.menu(); });
  ipc.handle("state:setAutoRebuild", (_event, on) => { store().setAutoRebuild(on); deps.menu(); });
  ipc.handle("state:setViewMode", (_event, mode) => store().setViewMode(mode));
  ipc.handle("state:setNavExpanded", (_event, ids) => store().setNavExpanded(ids));
  ipc.handle("state:setCanvasCameras", (_event, cameras) => store().setCanvasCameras(cameras));
  ipc.handle("state:setMapLayers", (_event, groupId, prefs) => store().setMapLayers(groupId, prefs));
  ipc.handle("state:setCardGroup", (_event, boxId, page, key) => store().setCardGroup(boxId, page, key));
  ipc.handle("state:setBoardFollow", (_e, on) => store().setBoardFollow(on));
  ipc.handle("state:setBoardView", (_e, view) => store().setBoardView(view));
  ipc.handle("state:setBoardBox", (_e, box) => store().setBoardBox(box));
  ipc.handle("comments:showResolved", (_event, on) => { store().setShowResolved(on); deps.menu(); });
  ipc.handle("review:setWalk", (_event, on) => { store().setReviewWalk(on); deps.menu(); });

  // The editor's page has a deck in focus, or not: New Card greys without one
  // (review 2026-10, item 24). Rebuilt only on a change, as the page changes often.
  ipc.handle("menu:setDeckFocused", (_event, on) => {
    if (deps.setDeckFocused(on === true)) deps.menu();
  });

  ipc.handle("identity:get", () => store().get().identity);
  // What the VCS thinks the author is called, to OFFER when nothing is stored
  // (simple-vc-lib 0.4.1's currentUser, and the vc-current-user brief). Keyed to
  // the open project so it reads THAT working copy - git's user.name is
  // per-repository as often as not - and undefined when nothing is open or the
  // VCS cannot say, which the dialog treats as "ask with an empty box".
  ipc.handle("identity:offer", async (): Promise<string | undefined> => {
    const dir = deps.session()?.loaded.dir;
    if (dir === undefined) return undefined;
    try { return await currentUserAsync(dir); } catch { return undefined; }
  });
  ipc.handle("identity:set", (_event, identity) => {
    store().setIdentity(identity);
  });

  // A closed allow-list, not a scheme check: only the destinations the app
  // itself puts on screen (the About box's links), so a compromised renderer
  // cannot launch arbitrary URLs. A URL is the one input that can reach the
  // rest of the machine (Patterpad's rule, parity row 29).
  ipc.handle("shell:openExternal", (_event, url) => {
    if (ABOUT_LINKS.has(url)) void shell.openExternal(url);
  });
}
