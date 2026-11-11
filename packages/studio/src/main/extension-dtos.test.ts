// What a manifest says about its groups reaches the editor (patterkit's brief extension-closed-field-groups): the
// groups of its Storylets fields that start closed, and none for a manifest without `groups`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SourceProject } from "@storylet-studio/compiler";
import { extensionDtos } from "./extensions.js";

const manifestPath = new URL("../../../ops/test/fixtures/probe-extension.storylets/extensions/probe.extension.json", import.meta.url);
const probe = (): Record<string, any> => JSON.parse(readFileSync(manifestPath, "utf8"));
const source = (manifest: unknown, extensions?: unknown[]): SourceProject => ({
  path: "project.storylets", project: { project: { id: "proj_probe" }, extensions: { probe: { version: "1.1.0" } } }, boxes: [],
  manifests: [{ id: "probe", manifest }], ...(extensions !== undefined ? { extensions } : {}),
}) as unknown as SourceProject;

describe("an extension's closed groups", () => {
  it("are the groups its Storylets fields carry that the manifest says start closed", () => {
    const m = probe();
    for (const f of m.targets.storylets.card.fields) if (f.name === "marks" || f.name === "act") f.group = "More";
    m.targets.storylets.project.fields.push({ name: "lens", type: "number", group: "More" });
    m.targets.storylets.box.fields[0].group = "Look";
    m.groups = { More: { closed: true }, Look: {} };
    expect(extensionDtos(source(m))?.[0]?.closedGroups).toEqual(["More"]);
  });

  it("are absent for a manifest without groups", () => {
    const dto = extensionDtos(source(probe()))?.[0];
    expect(dto).toBeDefined();
    expect(dto?.closedGroups).toBeUndefined();
  });
});

describe("an extension's pin and pools", () => {
  it("carry the version the project names, and the names a pool pick already holds", () => {
    const m = probe();
    m.targets.storylets.project.fields.push({ name: "home", type: "pick", from: [{ pool: "places" }] });
    const root = { path: "probe.storyletextension", shard: { schema: "storylets/extension@0", extension: "probe", entries: { project: { proj_probe: { home: "Quay" } } } } };
    const dto = extensionDtos(source(m, [root]))?.[0];
    expect(dto?.taken).toBe("1.1.0");
    expect(dto?.pools).toEqual({ places: ["Quay"] });
    expect(extensionDtos(source(probe()))?.[0]?.pools).toBeUndefined();
  });
});
