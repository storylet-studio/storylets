// Create the scene in Patter, on a copy of the Hamlet pair with one of its scenes taken away:
// the stub lands in the Patter project's own files, shaped as the pairing rule needs, and the
// check then says to publish it rather than to write it.

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import { runValidate } from "@storylet-studio/ops";
import type { ProjectShard } from "@storylet-studio/model";
import { createProject, openProject } from "./project.js";
import { createPatterScene } from "./patter-scene.js";

const examples = fileURLToPath(new URL("../../../../examples/", import.meta.url));

/** The Hamlet pair, paired, the village performed, and The Moneylender's Men's scene removed. */
function pair() {
  const root = mkdtempSync(join(tmpdir(), "patter-scene-"));
  for (const d of ["the-hamlet.storylets", "the-hamlet.patter", "patter-dist"]) cpSync(join(examples, d), join(root, d), { recursive: true });
  const projectFile = join(root, "the-hamlet.storylets", "the-hamlet.storyletproj");
  const project = parseSource(readFileSync(projectFile, "utf8")) as ProjectShard;
  project.patter = "../the-hamlet.patter";
  project.patterBoxes = ["b_village"];
  writeFileSync(projectFile, canonicalStringify(project));
  rmSync(join(root, "the-hamlet.patter", "scenes", "the-moneylenders-men.patterflow"));
  rmSync(join(root, "the-hamlet.patter", "loc", "en", "the-moneylenders-men.patterloc"));
  // ...and from what Patterpad last published, as if the scene had never been written.
  const bundleFile = join(root, "patter-dist", "the_hamlet.patterc");
  const bundle = JSON.parse(readFileSync(bundleFile, "utf8")) as { scenes: Record<string, unknown> };
  delete bundle.scenes["the-moneylenders-men"];
  writeFileSync(bundleFile, JSON.stringify(bundle));
  const opened = openProject(join(root, "the-hamlet.storylets"));
  if ("error" in opened) throw new Error(opened.error);
  return { root, session: opened.session };
}

describe("createPatterScene", () => {
  it("writes a stub scene for the card into the Patter project, one labelled option per outcome", () => {
    const { root, session } = pair();
    const r = createPatterScene(session, "c_gareth_men");
    if ("error" in r) throw new Error(r.error);
    expect(r.address).toBe("the-moneylenders-men");
    expect(r.files).toEqual(["../the-hamlet.patter/scenes/the_moneylenders_men.patterflow", "../the-hamlet.patter/loc/en/the_moneylenders_men.patterloc"]);
    const flow = parseSource(readFileSync(join(root, "the-hamlet.patter", "scenes", "the_moneylenders_men.patterflow"), "utf8")) as
      { scene: { name: string; gameId: string; blocks: { children: { selector?: string; children?: { gameData?: { outcome?: string } }[] }[] }[] } };
    expect([flow.scene.name, flow.scene.gameId]).toEqual(["The Moneylender's Men", "the-moneylenders-men"]);
    const choice = flow.scene.blocks[0]!.children.find((c) => c.selector === "choice")!;
    // In the order the card shows its outcomes, which is the order the author set.
    expect(choice.children!.map((o) => o.gameData?.outcome)).toEqual(["stand-with-gareth", "pay-them-off", "walk-away"]);
    const strings = readFileSync(join(root, "the-hamlet.patter", "loc", "en", "the_moneylenders_men.patterloc"), "utf8");
    expect(strings).toContain("Two of Aldric's men lean on the forge door.");   // the card's purpose opens it
  });

  it("turns the missing-scene error into a reminder to publish, and won't write the scene twice", () => {
    const { session } = pair();
    const before = runValidate(session.loaded, { checkBundle: false }).issues.find((i) => i.where === "c_gareth_men");
    expect(before).toMatchObject({ severity: "error", fix: { kind: "create-scene", card: "c_gareth_men" } });
    createPatterScene(session, "c_gareth_men");
    const after = runValidate(session.loaded, { checkBundle: false }).issues.find((i) => i.where === "c_gareth_men");
    expect(after?.severity).toBe("warning");
    expect(after?.message).toMatch(/hasn't been published yet/);
    expect(createPatterScene(session, "c_gareth_men")).toEqual({ error: 'the Patter project already has a scene named "the-moneylenders-men"' });
  });

  it("refuses an unpaired project", () => {
    const { root, session } = pair();
    const projectFile = join(root, "the-hamlet.storylets", "the-hamlet.storyletproj");
    const project = parseSource(readFileSync(projectFile, "utf8")) as ProjectShard;
    delete project.patter;
    writeFileSync(projectFile, canonicalStringify(project));
    const fresh = openProject(join(root, "the-hamlet.storylets"));
    if ("error" in fresh) throw new Error(fresh.error);
    expect(createPatterScene(fresh.session, "c_gareth_men")).toMatchObject({ error: expect.stringMatching(/isn't paired/) });
    expect(existsSync(join(root, "the-hamlet.patter", "scenes", "the_moneylenders_men.patterflow"))).toBe(false);
    void session;
  });
});

describe("New Project: Starter project with Patter", () => {
  it("creates both projects side by side, paired, the box performed, a scene per card", () => {
    const parent = mkdtempSync(join(tmpdir(), "kit-"));
    const made = createProject(parent, "The Village", "with-patter");
    if ("error" in made) throw new Error(made.error);
    expect(readdirSync(parent).sort()).toEqual(["The Village.patter", "The Village.storylets"]);
    const opened = openProject(made.path);
    if ("error" in opened) throw new Error(opened.error);
    const source = opened.session.loaded.source!;
    expect(source.project.patter).toBe("../The Village.patter");
    expect(source.project.patterBoxes).toEqual(source.boxes.map((b) => b.box.box.id).sort());
    const cards = source.boxes.flatMap((b) => b.decks.flatMap((d) => d.shard.cards));
    expect(readdirSync(join(parent, "The Village.patter", "scenes"))).toHaveLength(cards.length);
    expect(readdirSync(join(parent, "The Village.patter")).some((f) => f.endsWith(".patterproj"))).toBe(true);
    // Nothing published yet, so the check says to publish, and nothing says a scene is missing.
    const issues = runValidate(opened.session.loaded, { checkBundle: false }).issues.filter((i) => /Patter|scene/.test(i.message));
    expect(issues.map((i) => i.severity)).toEqual(issues.map(() => "warning"));
    expect(issues.some((i) => /hasn't been published/.test(i.message))).toBe(true);
  });

  it("won't overwrite a Patter project already there", () => {
    const parent = mkdtempSync(join(tmpdir(), "kit-"));
    cpSync(join(examples, "the-hamlet.patter"), join(parent, "The Village.patter"), { recursive: true });
    expect(createProject(parent, "The Village", "with-patter")).toEqual({ error: "The Village.patter is already there" });
  });
});
