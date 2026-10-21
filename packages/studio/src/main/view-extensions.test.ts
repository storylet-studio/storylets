// View extensions, main's half (patterkit design/view-extensions.md), on the internal "probe" extension and its
// package (ops' fixtures; never published, documented, or shipped): a view's write as ONE undo step with its
// label, refused whole (held, read-only, gone, a bad value) with nothing written; Add Extension...'s commit, the
// manifest and the pin in one step, and an update taking format's way; which packages it refuses; and which
// views the project offers, installed or not.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "@storylet-studio/compiler";
import { manifestProblems, parseManifest } from "@wildwinter/toolkit/extensions";
import type { Manifest } from "@wildwinter/toolkit/extensions";
import type { InstalledChoice, InstalledExtension } from "@wildwinter/app-shell/view-host";
import type { VCFileStatus } from "@wildwinter/simple-vc-lib";
import { openProject, shardRefs } from "./project.js";
import { undo } from "./mutate.js";
import { addExtension, setExtensionValues } from "./mutate/extensions.js";
import { writeRemote } from "./remote.js";
import type { RemoteRecord } from "./remote.js";
import { resetShardStatus, setStatusReader } from "./vc.js";
import { installRefusal, offeredViews, packageRefusal, viewWindowKey } from "./view-extensions.js";
import type { ProjectSession } from "./project.js";

const fixtures = fileURLToPath(new URL("../../../ops/test/fixtures/", import.meta.url));
const probeDir = join(fixtures, "probe-extension.storylets");
const packageDir = join(fixtures, "probe-extension-package");
const BOX_SHARD = join("harbour", "probe.storyletextension");
const ROOT_SHARD = "probe.storyletextension";

function scratch(): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-views-")), "copy.storylets");
  cpSync(probeDir, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

const read = (session: ProjectSession, rel: string): string => readFileSync(join(session.loaded.dir, rel), "utf8");
type Entries = Record<string, Record<string, Record<string, unknown>>>;
const entries = (session: ProjectSession, rel: string): Entries => (parseSource(read(session, rel)) as { entries: Entries }).entries;

/** Version control in which `held` (shard keys) are held by bo, and everything else is free. */
function holding(session: ProjectSession, ...held: string[]): void {
  const paths = new Set(shardRefs(session).filter((r) => held.includes(r.key)).map((r) => r.path));
  resetShardStatus();
  setStatusReader(async (all) => all.map((p): VCFileStatus => ({
    filePath: p, system: "perforce", writable: !paths.has(p), ...(paths.has(p) ? { lockedBy: ["bo@bo-ws"] } : {}),
  })));
}

beforeEach(() => resetShardStatus());
afterEach(() => setStatusReader(null));

describe("a view's write", () => {
  it("lands every edit, across boxes and the project, as one undo step with the view's label", async () => {
    const session = scratch();
    const result = await setExtensionValues(session, "probe", "Probe every note", [
      { node: "c_bell", field: "note", value: "One." },
      { node: "c_tide", field: "note", value: "Two." },
      { node: "proj_probe", field: "studio", value: "WW" },
      { node: "c_bell", field: "draft" },
    ]);
    expect(result).not.toHaveProperty("error");
    expect(entries(session, BOX_SHARD)["card"]!["c_bell"]!["note"]).toBe("One.");
    expect(entries(session, BOX_SHARD)["card"]!["c_bell"]!["draft"]).toBeUndefined();
    expect(entries(session, BOX_SHARD)["card"]!["c_tide"]).toEqual({ note: "Two." });
    expect(entries(session, ROOT_SHARD)["project"]!["proj_probe"]!["studio"]).toBe("WW");
    expect(session.history.undoLabel).toBe("Probe every note");

    expect(await undo(session)).not.toHaveProperty("error");
    expect(entries(session, BOX_SHARD)["card"]!["c_bell"]!["note"]).toBe("Ring it twice.");
    expect(entries(session, BOX_SHARD)["card"]!["c_bell"]!["draft"]).toBe("Maybe three times?");
    expect(entries(session, BOX_SHARD)["card"]!["c_tide"]).toBeUndefined();
    expect(entries(session, ROOT_SHARD)["project"]?.["proj_probe"]?.["studio"]).not.toBe("WW");
    expect(session.history.canUndo).toBe(false);
  });

  it("is two steps when written twice, never merged with the one before", async () => {
    const session = scratch();
    await setExtensionValues(session, "probe", "Probe note", [{ node: "c_bell", field: "note", value: "a" }]);
    await setExtensionValues(session, "probe", "Probe note", [{ node: "c_bell", field: "note", value: "b" }]);
    await undo(session);
    expect(entries(session, BOX_SHARD)["card"]!["c_bell"]!["note"]).toBe("a");
  });

  it("is refused whole, naming the holder, when somebody else holds a shard it would change", async () => {
    const session = scratch();
    const box = session.dto.boxes[0]!.id;
    const before = read(session, ROOT_SHARD);
    holding(session, `ext:${box}:probe`);
    const result = await setExtensionValues(session, "probe", "Probe", [
      { node: "proj_probe", field: "studio", value: "WW" }, { node: "c_bell", field: "note", value: "x" },
    ]);
    expect(result).toEqual({ code: "held", error: expect.stringContaining("Probe's data in the box “harbour” is locked by bo@bo-ws") });
    expect(read(session, ROOT_SHARD)).toBe(before);
    expect(session.history.canUndo).toBe(false);
  });

  it("is refused whole, as a bad request, for a value of the wrong kind or a field the extension doesn't declare", async () => {
    const session = scratch();
    const before = read(session, BOX_SHARD);
    const wrong = await setExtensionValues(session, "probe", "Probe", [
      { node: "c_tide", field: "note", value: "fine" }, { node: "c_bell", field: "weight", value: 11 },
    ]);
    expect(wrong).toEqual({ code: "bad-request", error: expect.stringContaining("Probe: Weight on the card “bell” is 11, but Probe takes nothing above 10. Nothing was written.") });
    const tone = await setExtensionValues(session, "probe", "Probe", [{ node: "c_bell", field: "tone", value: "loud" }]);
    expect(tone).toMatchObject({ code: "bad-request" });
    const ref = await setExtensionValues(session, "probe", "Probe", [{ node: "c_bell", field: "next", value: "c_nowhere" }]);
    expect(ref).toMatchObject({ code: "bad-request" });
    const undeclared = await setExtensionValues(session, "probe", "Probe", [{ node: "d_quarter", field: "note", value: "x" }]);
    expect(undeclared).toEqual({ code: "bad-request", error: "Probe has no field “note” on the tag group “quarter”, so nothing was written." });
    expect(read(session, BOX_SHARD)).toBe(before);
  });

  it("is refused as gone for a node the project no longer has, and as read-only under an author's key", async () => {
    const session = scratch();
    expect(await setExtensionValues(session, "probe", "Probe", [{ node: "c_gone", field: "note", value: "x" }]))
      .toMatchObject({ code: "gone" });
    writeRemote(session.loaded.dir, {
      schema: "storylets/server-provenance@0", server: "http://venue", installation: "i", version: "1", revision: 1, role: "author",
    } as RemoteRecord);
    expect(await setExtensionValues(session, "probe", "Probe", [{ node: "c_bell", field: "note", value: "x" }]))
      .toMatchObject({ code: "read-only" });
  });
});

describe("Add Extension...", () => {
  const packageText = (version = "1.1.0"): string =>
    readFileSync(join(packageDir, "probe.extension.json"), "utf8").replace(/"version": "1\.1\.0"/, `"version": "${version}"`);

  it("takes the package's manifest into a project that doesn't take it, with the pin, as one undo step", async () => {
    const session = scratch();
    const dir = session.loaded.dir;
    const project = parseSource(read(session, "probe.storyletproj")) as Record<string, unknown>;
    delete project["extensions"];
    writeFileSync(join(dir, "probe.storyletproj"), JSON.stringify(project, null, 2));
    rmSync(join(dir, "extensions"), { recursive: true });
    const bare = openProject(dir);
    if ("error" in bare) throw new Error(bare.error);
    const s = bare.session;

    const text = packageText();
    const result = await addExtension(s, parseManifest(text), text);
    expect(result).not.toHaveProperty("error");
    expect(read(s, "extensions/probe.extension.json")).toBe(text);
    expect((parseSource(read(s, "probe.storyletproj")) as { extensions: unknown }).extensions).toEqual({ probe: { version: "1.1.0" } });
    expect(s.history.undoLabel).toBe("Add Probe");
    expect(s.dto.extensions?.map((x) => [x.id, x.views])).toEqual([["probe", [{ id: "inspect", name: "Probe view" }]]]);

    await undo(s);
    expect(existsSync(join(dir, "extensions/probe.extension.json"))).toBe(false);
    expect((parseSource(read(s, "probe.storyletproj")) as { extensions?: unknown }).extensions).toBeUndefined();
  });

  it("at a new version, takes it as format does: renamed stages, then the pin, one step", async () => {
    const session = scratch();
    const project = parseSource(read(session, "probe.storyletproj")) as { extensions: { probe: { version: string } } };
    project.extensions.probe.version = "1.0.0";
    writeFileSync(join(session.loaded.dir, "probe.storyletproj"), JSON.stringify(project, null, 2));
    writeFileSync(join(session.loaded.dir, "extensions/probe.extension.json"), packageText("1.0.0"));
    const opened = openProject(session.loaded.dir);
    if ("error" in opened) throw new Error(opened.error);
    const s = opened.session;
    expect(entries(s, BOX_SHARD)["card"]!["c_bell"]!["act"]).toBe("opening");

    const text = packageText("1.2.0");
    expect(await addExtension(s, parseManifest(text), text)).not.toHaveProperty("error");
    expect((parseSource(read(s, "probe.storyletproj")) as typeof project).extensions.probe).toEqual({ version: "1.2.0" });
    expect(entries(s, BOX_SHARD)["card"]!["c_bell"]!["act"]).toBe("setup");
    expect(read(s, "extensions/probe.extension.json")).toBe(text);
    await undo(s);
    expect((parseSource(read(s, "probe.storyletproj")) as typeof project).extensions.probe.version).toBe("1.0.0");
    expect(entries(s, BOX_SHARD)["card"]!["c_bell"]!["act"]).toBe("opening");
  });

  const pkg = (manifest: unknown) => ({ manifest: manifest as Manifest, problems: manifestProblems(manifest) });

  it("takes the probe package, and refuses a manifest with faults or one with nothing for Storyletter", () => {
    expect(packageRefusal(pkg(JSON.parse(packageText())))).toBeUndefined();
    const broken = { ...JSON.parse(packageText()), views: [{ id: "Bad", name: "", entry: "/x.js", element: "nohyphen" }] };
    expect(packageRefusal(pkg(broken))).toMatch(/^Probe's manifest has faults, so it wasn't added\. Views\[0\]\.id: /);
    const patterOnly = { ...JSON.parse(packageText()), targets: { patter: { line: { fields: [{ name: "note", type: "text" }] } } } };
    expect(packageRefusal(pkg(patterOnly))).toBe("Probe is an extension for Patterpad, with nothing for Storyletter, so it wasn't added.");
  });

  it("installs only the extension asked for", () => {
    const other = { ...JSON.parse(packageText()), id: "other", name: "Other" };
    expect(installRefusal(pkg(other), "probe", "Probe")).toBe("This package is Other, not Probe, so nothing was installed.");
    expect(installRefusal(pkg(JSON.parse(packageText())), "probe", "Probe")).toBeUndefined();
  });

  it("keeps the package's manifest the project's own copy, so the fixture and the package can't drift", () => {
    expect(readFileSync(join(packageDir, "probe.extension.json"), "utf8"))
      .toBe(readFileSync(join(probeDir, "extensions/probe.extension.json"), "utf8"));
  });
});

describe("the views a project offers", () => {
  const installedProbe = (version: string): InstalledExtension => ({
    id: "probe", version, root: `/views/probe/${version}`, manifest: parseManifest(readFileSync(join(packageDir, "probe.extension.json"), "utf8")),
  });
  /** The shell's choice, as far as these cases need it: the pinned version, else none. */
  const choose = (installed: readonly InstalledExtension[], id: string, pinned?: string, name?: string): InstalledChoice => {
    const exact = installed.find((x) => x.id === id && x.version === pinned);
    return exact ? { installed: exact } : { installed: null, why: `${name ?? id} isn't installed on this machine.` };
  };

  it("lists each view the project's manifest gives Storyletter, with the installed version for its pin", () => {
    const session = scratch();
    const views = offeredViews(session.loaded.source!, [installedProbe("1.1.0")], choose);
    expect(views.map((v) => [v.extension, v.extensionName, v.view, v.name, v.pinned, v.choice.installed?.version])).toEqual([
      ["probe", "Probe", "inspect", "Probe view", "1.1.0", "1.1.0"],
    ]);
    expect(viewWindowKey("probe", "inspect")).toBe("view:probe/inspect");
  });

  it("says why when this machine hasn't installed it", () => {
    const session = scratch();
    expect(offeredViews(session.loaded.source!, [], choose)[0]!.choice).toEqual({ installed: null, why: "Probe isn't installed on this machine." });
  });
});
