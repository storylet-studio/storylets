// ---------------------------------------------------------------------------
// View extensions, as main decides them (patterkit design/view-extensions.md):
// which views the open project offers and whether each is installed on this
// machine, and whether an extension's package may be added. No Electron here
// (the shell's view host is reached through what is passed in), so it runs
// under test as it is; the windows, dialogs and menu are ipc/views.ts.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import type { SourceProject } from "@storylet-studio/compiler";
import { manifestProblems, viewsFor } from "@wildwinter/toolkit/extensions";
import type { Manifest, Problem } from "@wildwinter/toolkit/extensions";
import type { ExtensionPackage, InstalledChoice, InstalledExtension } from "@wildwinter/app-shell/view-host";

/** The scheme a view's files are served on, registered beside the asset scheme (assets.ts). */
export const VIEW_SCHEME = "storylet-view";

/** Where views are installed on this machine: `<userData>/view-extensions/<id>/<version>/`. */
export const viewsDir = (userData: string): string => join(userData, "view-extensions");

/** The store key a view's window remembers its bounds and pin under, as the tool windows remember theirs. */
export const viewWindowKey = (extension: string, view: string): string => `view:${extension}/${view}`;

/** One view the open project offers, and what this machine has installed for it. */
export interface OfferedView {
  extension: string;
  extensionName: string;
  view: string;
  name: string;
  /** The version the project pins. */
  pinned: string;
  /** The installed version to open (with a warning when it isn't the pinned one), or why none opens. */
  choice: InstalledChoice;
}

/**
 * The views the open project offers in Storyletter, in the project's order: each extension it takes and has a
 * sound manifest for (the project's copy declares the views), each view `viewsFor` gives this host, with the
 * installed version `choose` picks for the project's pin (the shell's `chooseInstalled`).
 */
export function offeredViews(
  source: SourceProject, installed: readonly InstalledExtension[],
  choose: (installed: readonly InstalledExtension[], id: string, pinned?: string, name?: string) => InstalledChoice,
): OfferedView[] {
  const out: OfferedView[] = [];
  for (const [id, pin] of Object.entries(source.project.extensions ?? {})) {
    const file = (source.manifests ?? []).find((m) => m.id === id);
    if (file === undefined || manifestProblems(file.manifest).some((p) => p.severity === "error")) continue;
    const manifest = file.manifest as Manifest;
    const views = viewsFor(manifest, "storylets");
    if (views.length === 0) continue;
    const choice = choose(installed, id, pin.version, manifest.name);
    for (const v of views) {
      out.push({ extension: id, extensionName: manifest.name, view: v.id, name: v.name, pinned: pin.version, choice });
    }
  }
  return out;
}

/** A manifest's problem as a sentence: "views[0].entry: a view's entry is a .js file ...". */
const sentence = (p: Problem): string => {
  const said = p.path === "" ? p.message : `${p.path}: ${p.message}`;
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`;
};

/**
 * Why Add Extension... won't take a package, or undefined when it will: a manifest with errors (each said as a
 * sentence), or one that targets nothing in Storyletter. A warning doesn't refuse: the project's own checks
 * show it once the manifest is there.
 */
export function packageRefusal(pkg: Pick<ExtensionPackage, "manifest" | "problems">, done = "added"): string | undefined {
  const name = typeof pkg.manifest?.name === "string" ? pkg.manifest.name : "This extension";
  const errors = pkg.problems.filter((p) => p.severity === "error");
  if (errors.length > 0) return `${name}'s manifest has ${errors.length === 1 ? "a fault" : "faults"}, so it wasn't ${done}. ${errors.map(sentence).join(" ")}`;
  const storylets = pkg.manifest.targets?.storylets;
  if (storylets === undefined || Object.keys(storylets).length === 0) {
    const hosts = Object.keys(pkg.manifest.targets ?? {});
    return hosts.includes("patter")
      ? `${name} is an extension for Patterpad, with nothing for Storyletter, so it wasn't ${done}.`
      : `${name} has nothing for Storyletter, so it wasn't ${done}.`;
  }
  return undefined;
}

/**
 * Why Add Extension..., opened for a view "(not installed)..." of `extension`, won't take a package, or undefined
 * when it will: it's another extension's, or its manifest has faults.
 */
export function installRefusal(pkg: Pick<ExtensionPackage, "manifest" | "problems">, extension: string, name: string): string | undefined {
  if (pkg.manifest.id !== extension) {
    const theirs = typeof pkg.manifest.name === "string" ? pkg.manifest.name : pkg.manifest.id;
    return `This package is ${theirs}, not ${name}, so nothing was installed.`;
  }
  const errors = pkg.problems.filter((p) => p.severity === "error");
  if (errors.length > 0) return `${name}'s manifest has ${errors.length === 1 ? "a fault" : "faults"}, so it wasn't installed. ${errors.map(sentence).join(" ")}`;
  return undefined;
}
