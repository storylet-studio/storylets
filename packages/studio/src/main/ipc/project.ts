// ---------------------------------------------------------------------------
// The project as a whole: opening, creating, closing and revealing one, its
// settings, its scopes, its paired Patter project, and its upgrade to the
// project map.
// ---------------------------------------------------------------------------

import { app, dialog, shell } from "electron";
import { cpSync, existsSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { findScene, projectFolderName, readPatterLink } from "@storylet-studio/ops";
import { effectiveGameId } from "@storylet-studio/model";
import {
  createProject, currentProjectHash, currentResult, diskUnchanged, openResult, patterFolderFor, projectSettings, shareScopes,
  shareScopesDefault, validate, vcStatus,
} from "../project.js";
import { shippedExample } from "../trust.js";
import { saveProjectSettings } from "../mutate/settings.js";
import { planMapUpgrade, upgradeProjectMap } from "../map-upgrade.js";
import { findPatterpad, launchPatterpad, patterpadExecutable } from "../patterpad.js";
import type { MainContext } from "../context.js";
import type { Ipc } from "./registrar.js";
import { sessionGuards } from "./registrar.js";
import { EXAMPLES } from "../../shared/examples.js";
import type { OpenResult, ProjectSettingsDto, StudioApi, VcStatusDto } from "../../shared/api.js";

export interface ProjectIpcDeps extends Pick<MainContext, "session" | "editor" | "store" | "openAt"> {
  /** May the author leave the open project? (exchange.ts) */
  mayLeaveProject(act: "quit" | "close"): Promise<boolean>;
  /** Is this a path the app already knows (the last project, a recent)? */
  isKnownPath(path: string): boolean;
  /** Back to no project: the shell's teardown and everything that hangs off it. */
  closeProject(): void;
}

/**
 * Where a shipped example lives.
 *
 * Two homes because there are two ways to run this. In development the repo's
 * own `examples/` is four levels up from the main bundle; in a packaged app
 * they are resources beside it. PACKAGING MUST CARRY `examples/` for the second
 * branch to find anything: `build.extraResources` in package.json copies the
 * Hamlet (minus its dist/) to `resources/examples/`, which is exactly where
 * `process.resourcesPath` points in a packaged app.
 */
function examplePath(name: string): string | undefined {
  if (app.isPackaged) {
    const packaged = join(process.resourcesPath, "examples", name);
    return existsSync(packaged) ? packaged : undefined;
  }
  // In development, WALK UP rather than counting directories. How far the repo
  // root is from the app path depends on the dev runner's layout, and a hard
  // "../../.." is a guess that fails silently by finding nothing - which looks
  // exactly like "no examples shipped".
  let dir = app.getAppPath();
  for (let up = 0; up < 6; up++) {
    const candidate = join(dir, "examples", name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export function registerProject(ipc: Ipc, deps: ProjectIpcDeps): void {
  const { project, read } = sessionGuards(deps.session);

  ipc.handle("project:openDialog", async (): Promise<OpenResult | { error: string } | null> => {
    // Opening another project over one the server has not seen the whole of is
    // one of the three ways out that ask first (9.1).
    if (!(await deps.mayLeaveProject("close"))) return null;
    const picked = await dialog.showOpenDialog(deps.editor()!, {
      title: "Open a storylets project",
      message: "Choose your project's .storylets folder.",
      buttonLabel: "Open",
      properties: ["openDirectory", "treatPackageAsDirectory"],
    });
    const path = picked.filePaths[0];
    return path === undefined ? null : deps.openAt(path);
  });

  // Only paths the app already knows: the last project and recents, which got
  // there through a native dialog run in main where a person picked them. A
  // renderer naming a directory of its own is not a route into the file system
  // (Patterpad's guard, which we did not have).
  ipc.handle("project:openPath", async (_event, path) => {
    if (!(await deps.mayLeaveProject("close"))) return null;
    return deps.isKnownPath(path) ? deps.openAt(path) : { error: "that project is not one of yours" };
  });

  ipc.handle("project:create", async (_event, name, kit): Promise<OpenResult | { error: string } | null> => {
    if (!(await deps.mayLeaveProject("close"))) return null;
    const folder = projectFolderName(name);
    const picked = await dialog.showOpenDialog(deps.editor()!, {
      title: "Choose where to create the project",
      // Patterpad's wording, and its shape: say what will be CREATED here,
      // naming it from the same rule that creates it (`projectFolderName`).
      message: kit === "with-patter"
        ? `Storyletter will create "${folder}" and, beside it, the Patter project "${patterFolderFor(folder)}" here.`
        : `Storyletter will create "${folder}" here.`,
      buttonLabel: "Create Here",
      properties: ["openDirectory", "createDirectory"],
    });
    const parent = picked.filePaths[0];
    if (parent === undefined) return null;
    const created = createProject(parent, name, kit);
    if ("error" in created) return created;
    return deps.openAt(created.path);
  });

  /**
   * Open a worked example: COPY it somewhere the author owns, then open that.
   *
   * Never opened in place. A bundled example lives inside the installed app,
   * which is read-only on macOS and replaced wholesale by the next update - so
   * editing it would either fail or be thrown away, and an example nobody can
   * poke at teaches half of what it could. The same reasoning, and the same
   * shape, as unpacking a pack: you cannot edit the envelope, so opening one
   * always means putting it somewhere first.
   */
  ipc.handle("example:open", async (_event, name): Promise<OpenResult | { error: string } | null> => {
    // Only a name this build offered: the handler copies a folder by this name,
    // and a renderer naming one of its own is not a route into the disk.
    if (!shippedExample(name)) return { error: "that isn't one of the examples shipped with Storyletter" };
    if (!(await deps.mayLeaveProject("close"))) return null;
    const source = examplePath(name);
    if (source === undefined) return { error: `no example called "${name}" shipped with this build` };
    // Its companions (the Hamlet's Patter project and published scenes) go beside
    // it, so a pairing written as a relative path finds them in the copy too.
    const companions = (EXAMPLES.find((x) => x.file === name)?.companions ?? [])
      .map((c) => join(dirname(source), c)).filter((c) => existsSync(c));
    // `title` alone is INVISIBLE on macOS: the native open panel ignores it, so
    // the author saw a bare folder chooser and no reason for it. `message` is
    // the line macOS actually renders, and `buttonLabel` names the act - which
    // is Patterpad's convention on every dialog that asks for a folder.
    const picked = await dialog.showOpenDialog(deps.editor()!, {
      title: "Where should your copy of the example go?",
      message: companions.length
        ? `Choose a folder. A copy of "${basename(source)}" and its Patter project go into it, and it opens, yours to change.`
        : `Choose a folder. A copy of "${basename(source)}" goes into it and opens, yours to change.`,
      buttonLabel: "Copy Here",
      properties: ["openDirectory", "createDirectory"],
    });
    const parent = picked.filePaths[0];
    if (picked.canceled || parent === undefined) return null;
    const target = join(parent, basename(source));
    for (const path of [source, ...companions]) {
      if (existsSync(join(parent, basename(path)))) return { error: `there is already something called "${basename(path)}" there` };
    }
    try {
      cpSync(source, target, { recursive: true });
      for (const c of companions) cpSync(c, join(parent, basename(c)), { recursive: true });
    } catch (e) {
      return { error: `couldn't copy the example: ${e instanceof Error ? e.message : String(e)}` };
    }
    return deps.openAt(target);
  });

  // Close Project: back to the no-project state and the welcome screen. The
  // shell owns the teardown order (close hook, satellites, menu, forget WHICH
  // while keeping recents); the tool windows then close outright, because a
  // Board or a Find over no project is not a stale view, it is a view of
  // nothing.
  ipc.handle("project:close", async (): Promise<boolean> => {
    if (!(await deps.mayLeaveProject("close"))) return false;
    deps.closeProject();
    return true;
  });

  /** Show the project's folder in Finder / the file manager (Patterpad's
   *  `app:revealProject`, same one line). The renderer never names a path here:
   *  it reveals the OPEN project, whatever that is. */
  ipc.handle("project:reveal", (): void => {
    const dir = deps.session()?.loaded.dir;
    if (dir !== undefined) shell.showItemInFolder(dir);
  });

  // The project as main holds it, unconditionally, with no disk read: what a
  // tool window boots on and re-reads after a project change. Null only when
  // nothing is open.
  ipc.handle("project:current", read(currentResult, null));
  // Null when nothing is open, AND when nothing the project reads has changed
  // on disk since it was last read: focus asks this on every alt-tab, and a
  // repaint of an unchanged project dropped the caret and the scroll (review
  // 2026-10, item 3). The caller then repaints nothing.
  ipc.handle("project:revalidate", read((open) => (!diskUnchanged(open) ? openResult(open, validate(open)) : null), null));

  // The lock / read-only / out-of-date badges. Throttled + coalesced in vc.ts,
  // so the renderer may poll it freely.
  ipc.handle("project:vcStatus", read((open): Promise<VcStatusDto> => vcStatus(open), null));
  ipc.handle("project:hash", read(currentProjectHash, null));

  ipc.handle("project:settings", read((open): ProjectSettingsDto => projectSettings(open), null));
  ipc.write("project:saveSettings", project(saveProjectSettings));

  // A project from before the project map (map-upgrade.ts): asked about when it
  // opens, and the quick-fix on E2 and W3. The plan is read-only; the upgrade is
  // one undo step.
  ipc.handle("project:planMapUpgrade", read((open) => planMapUpgrade(open) ?? null, null));
  ipc.write("project:upgradeProjectMap", project(upgradeProjectMap));

  // "Share Scopes with Other Tools..." (patterkit design/shared-scopes.md): the folder dialog
  // opens where the folder belongs by default, the version-control root above the project,
  // and says what will be made there, in Patterpad's words for every folder it asks for.
  ipc.handle("project:shareScopes", async (): Promise<OpenResult | { error: string } | null> => {
    const session = deps.session();
    if (!session) return { error: "no project open" };
    const already = session.loaded.source?.gameScopes;
    if (already) return { error: `This project already shares its scopes, through ${already.dir}` };
    const picked = await dialog.showOpenDialog(deps.editor()!, {
      title: "Share scopes with other tools",
      message: "Storyletter will create \"game-scopes\" here, for the game's editing tools to share their scopes through. The version-control root is the usual place.",
      buttonLabel: "Create Here",
      defaultPath: shareScopesDefault(session),
      properties: ["openDirectory", "createDirectory"],
    });
    const parent = picked.filePaths[0];
    if (picked.canceled || parent === undefined) return null;
    const open = deps.session()!;
    const failed = shareScopes(open, parent);
    if (failed) return failed;
    return openResult(open, validate(open));
  });

  // The paired Patter project (the project shard's `patter`). Choose: a Patter project, as a path
  // relative to this project, for Project Settings to hold until it saves. Null = cancelled.
  ipc.handle("patter:choose", async (): Promise<{ path: string } | null> => {
    const session = deps.session();
    if (!session) return null;
    const picked = await dialog.showOpenDialog(deps.editor()!, {
      title: "Choose the Patter project",
      message: "The Patter project this project's cards perform: its scenes are named after the cards.",
      buttonLabel: "Choose",
      defaultPath: dirname(session.loaded.dir),
      // A .patter project is a folder (a package on macOS, when Patterpad is installed): take
      // the folder, or its .patterproj, whichever the platform lets the author pick.
      properties: ["openFile", "openDirectory"],
      filters: [{ name: "Patter project", extensions: ["patter", "patterproj"] }],
    });
    const chosen = picked.filePaths[0];
    if (picked.canceled || chosen === undefined) return null;
    const dir = chosen.endsWith(".patterproj") ? dirname(chosen) : chosen;
    return { path: relative(deps.session()!.loaded.dir, dir).split(sep).join("/") };
  });

  // Show Scene in Patterpad: the paired Patter project, at the scene named after the card.
  // Patterpad forwards a second launch to the running app, which jumps in place.
  ipc.handle("patter:edit", async (_e, cardId, locate): ReturnType<StudioApi["editInPatterpad"]> => {
    const session = deps.session();
    if (!session?.loaded.source) return { error: "no project open" };
    const { link, issues } = readPatterLink(session.loaded);
    if (!link) return { error: issues[0]?.message ?? "This project isn't paired with a Patter project. Choose one in Project Settings." };
    const card = session.loaded.source.boxes.flatMap((b) => b.decks.flatMap((d) => d.shard.cards)).find((c) => c.id === cardId);
    if (!card) return { error: "that card isn't in the project any more" };
    const address = effectiveGameId(card);
    const store = deps.store();
    let executable = findPatterpad(store.patterpadPath());
    if (executable === undefined) {
      // Asked in the window, in the shell's confirm with Cancel first, as Patterpad asks
      // its mirror; the renderer comes back with `locate` once the author says yes.
      if (locate !== true) {
        return { locate: { title: "Storyletter can't find Patterpad", body: "Point to it once and Storyletter will remember where it is." } };
      }
      const picked = await dialog.showOpenDialog(deps.editor()!, {
        title: "Locate Patterpad",
        message: "Choose the Patterpad app. Storyletter will remember where it is.",
        buttonLabel: "Use Patterpad",
        properties: ["openFile"],
        ...(process.platform === "darwin" ? { defaultPath: "/Applications", filters: [{ name: "Applications", extensions: ["app"] }] } : {}),
        ...(process.platform === "win32" ? { filters: [{ name: "Patterpad", extensions: ["exe"] }] } : {}),
      });
      const chosen = picked.filePaths[0];
      if (picked.canceled || chosen === undefined) return null;
      executable = findPatterpad(chosen);
      if (executable === undefined) return { error: `${basename(chosen)} isn't Patterpad (no ${basename(patterpadExecutable(chosen))} in it)` };
      store.setPatterpadPath(chosen);
    }
    try { launchPatterpad(executable, link.dir, address); }
    catch (e) { return { error: `couldn't start Patterpad: ${e instanceof Error ? e.message : String(e)}` }; }
    // Whether the PUBLISHED bundle has the scene: Patterpad resolves from its own shards, which may
    // be ahead, so this only colours the confirmation and never stops the launch.
    return { address, published: link.scenes !== undefined && findScene(link.scenes, address) !== undefined };
  });
}
