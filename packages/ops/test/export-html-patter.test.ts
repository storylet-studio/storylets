// ---------------------------------------------------------------------------
// The playable export from a project paired with Patter: the page carries the
// Patter project's published scenes and Patterplay, and plays a performed box's
// cards as their scenes, as Storyletter's Board does. Played in jsdom on the
// real Hamlet pair, which is also the guard that the committed player blob and
// Patterplay's build work together.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import type { ProjectShard } from "@storylet-studio/model";
import { loadProject } from "../src/load.js";
import { runExportHtml } from "../src/export-html.js";

const examples = fileURLToPath(new URL("../../../examples/", import.meta.url));

/** The Hamlet pair, paired, and (unless `performed` is false) the village performed by Patter. */
function hamletPage(performed = true): string {
  const root = mkdtempSync(join(tmpdir(), "page-patter-"));
  for (const d of ["the-hamlet.storylets", "the-hamlet.patter", "patter-dist"]) cpSync(join(examples, d), join(root, d), { recursive: true });
  const file = join(root, "the-hamlet.storylets", "the-hamlet.storyletproj");
  const project = parseSource(readFileSync(file, "utf8")) as ProjectShard;
  project.patter = "../the-hamlet.patter";
  if (performed) project.patterBoxes = ["b_village"];
  writeFileSync(file, canonicalStringify(project));
  const { html } = runExportHtml(loadProject(join(root, "the-hamlet.storylets")));
  if (!html) throw new Error("no page");
  return html;
}

const openPage = (html: string) => {
  const dom = new JSDOM(html, {
    runScripts: "dangerously", url: "http://localhost/the-hamlet.html",
    beforeParse(window) { (window as unknown as { structuredClone: unknown }).structuredClone = structuredClone; },
  });
  return dom.window.document;
};

describe("runExportHtml, paired with Patter", () => {
  it("carries Patter only when the project names the boxes Patter performs", () => {
    expect(hamletPage()).toContain("window.PATTER=");
    expect(hamletPage()).toContain("var Patterplay=");
    const plain = hamletPage(false);
    expect(plain).not.toContain("window.PATTER=");
    expect(plain).not.toContain("var Patterplay=");
  });

  it("plays a performed card's scene, and its Continue plays the outcome the scene reached", () => {
    const doc = openPage(hamletPage());
    const gate = [...doc.querySelectorAll<HTMLButtonElement>(".bd-card")].find((b) => /Gate/.test(b.textContent ?? ""));
    expect(gate).toBeDefined();
    gate!.click();
    const lines = [...doc.querySelectorAll(".bd-scene .bd-line")].map((p) => p.textContent);
    expect(lines[0]).toMatch(/weathered gate/);
    const go = [...doc.querySelectorAll<HTMLButtonElement>(".bd-scene .bd-outcome")].find((b) => /^Continue/.test(b.textContent ?? ""));
    expect(go?.textContent).toBe("Continue (Step through the gate)");
    go!.click();
    expect(doc.getElementById("transcript")!.textContent).toContain('played "Arrive at the Village Gate" -> Step through the gate');
  });

  it("offers a scene's choices, and the one taken decides the outcome", () => {
    const doc = openPage(hamletPage());
    const card = (re: RegExp) => [...doc.querySelectorAll<HTMLButtonElement>(".bd-card")].find((b) => re.test(b.textContent ?? ""));
    card(/Gate/)!.click();
    [...doc.querySelectorAll<HTMLButtonElement>(".bd-scene .bd-outcome")].find((b) => /^Continue/.test(b.textContent ?? ""))!.click();
    card(/Settled at the Inn/)!.click();
    const options = [...doc.querySelectorAll<HTMLButtonElement>(".bd-scene .bd-outcome")];
    expect(options.map((b) => b.textContent)).toEqual(["Ask warmly about the village's history", "Ask only about the road north"]);
    options[0]!.click();
    expect([...doc.querySelectorAll(".bd-scene .bd-chose")].map((p) => p.textContent)).toEqual(["Ask warmly about the village's history"]);
    const go = [...doc.querySelectorAll<HTMLButtonElement>(".bd-scene .bd-outcome")].find((b) => /^Continue/.test(b.textContent ?? ""))!;
    go.click();
    expect(doc.getElementById("transcript")!.textContent).toContain('played "Get Settled at the Inn" -> Ask warmly about the village\'s history');
  });
});
