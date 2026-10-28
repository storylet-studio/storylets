// The Changes picker's new property (ruled 2026-10-28): the author chooses its
// type and nothing else, and the problems bar's Declare writes it with that
// type and no default, so the type's own holds. The bar's own Declare, with
// no type to go on, still makes a number from 0.

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "@storylet-studio/compiler";
import type { ProjectShard } from "@storylet-studio/model";
import { openProject } from "./project.js";
import type { ProjectSession } from "./project.js";
import { declareProperty, undo } from "./mutate.js";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));

function scratchProject(): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-new-prop-")), "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}
const story = (session: ProjectSession) =>
  (parseSource(readFileSync(join(session.loaded.dir, "saltmarsh.storyletproj"), "utf8")) as ProjectShard).story.properties;

describe("declaring a property of a chosen type", () => {
  it("writes each plain type with no default, in one undoable step", async () => {
    const session = scratchProject();
    expect("error" in await declareProperty(session, "story", "mood", "", { type: "string" })).toBe(false);
    expect("error" in await declareProperty(session, "story", "met_anna", "", { type: "boolean" })).toBe(false);
    expect("error" in await declareProperty(session, "story", "gold", "", { type: "number" })).toBe(false);
    expect(story(session).slice(-3)).toEqual([
      { name: "mood", type: "string" },
      { name: "met_anna", type: "boolean" },
      { name: "gold", type: "number" },
    ]);
    await undo(session);
    expect(story(session).some((p) => p.name === "gold")).toBe(false);
    expect(story(session).some((p) => p.name === "met_anna")).toBe(true);
  });

  it("still makes a number from 0 when given no type", async () => {
    const session = scratchProject();
    await declareProperty(session, "story", "debt", "");
    expect(story(session).at(-1)).toEqual({ name: "debt", type: "number", default: 0 });
  });

  it("refuses a name already declared", async () => {
    const session = scratchProject();
    const r = await declareProperty(session, "story", "reputation", "", { type: "string" });
    expect(r).toEqual({ error: "\"reputation\" is already declared" });
  });
});
