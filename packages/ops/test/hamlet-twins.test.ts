// The two Hamlets stay one story.
//
// `the-hamlet.storylets` is the Start-here example, with no Patter in it, and
// `the-hamlet-patter.storylets` is the same cards paired with a Patter project,
// which the Hamlet game plays. Two copies of one story drift the moment someone
// edits one of them, so this holds them together: every shard the same byte for
// byte, and the project file the same apart from what makes it the Patter
// version (its id, its name, where it publishes, and its pairing).

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSource } from "@storylet-studio/compiler";

const examples = fileURLToPath(new URL("../../../examples/", import.meta.url));
const plain = join(examples, "the-hamlet.storylets");
const patter = join(examples, "the-hamlet-patter.storylets");

/** Every file under `dir`, relative to it, skipping what is not the story. */
function shards(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) { if (name !== "dist") walk(full); continue; }
      if (name === "README.md" || name.endsWith(".storyletproj")) continue;
      out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

/** The project file less what the Patter version is allowed to change. */
function shared(file: string): unknown {
  const p = parseSource(readFileSync(file, "utf8")) as Record<string, unknown> & {
    project: Record<string, unknown>; export: Record<string, unknown>;
  };
  delete p.patter;
  delete p.patterBoxes;
  delete p.project.id;
  delete p.project.name;
  delete p.export.bundle;
  return p;
}

describe("the two Hamlets", () => {
  it("hold the same shards, byte for byte", () => {
    const files = shards(plain);
    expect(shards(patter)).toEqual(files);
    for (const f of files) {
      expect(readFileSync(join(patter, f), "utf8"), `${f} differs: change both Hamlets, or neither`)
        .toBe(readFileSync(join(plain, f), "utf8"));
    }
  });

  it("differ in the project file only by what makes one the Patter version", () => {
    expect(shared(join(patter, "the-hamlet-patter.storyletproj"))).toEqual(shared(join(plain, "the-hamlet.storyletproj")));
  });

  it("keep Patter out of the Start-here Hamlet", () => {
    const p = parseSource(readFileSync(join(plain, "the-hamlet.storyletproj"), "utf8")) as { patter?: unknown; patterBoxes?: unknown };
    expect(p.patter).toBeUndefined();
    expect(p.patterBoxes).toBeUndefined();
  });
});
