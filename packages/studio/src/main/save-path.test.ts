// Where a Save dialog's answer lands (storylets#5): beside the project, with
// the filter's extension a Linux picker leaves off, and never over a file the
// picker did not ask to replace.

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { besideProject, savePathFor, withFilterExtension } from "./save-path.js";
import { mainFiles } from "./main-source.js";

const PACK = [{ name: "Storyletpack", extensions: ["storyletpack"] }];

describe("besideProject", () => {
  it("suggests the file beside the project folder, never inside it or nowhere", () => {
    expect(besideProject(join("/work", "saltmarsh.storylets"), "Saltmarsh.storyletpack")).toBe(join("/work", "Saltmarsh.storyletpack"));
  });
  it("keeps a suggested name to a name", () => {
    expect(besideProject(join("/work", "p.storylets"), "../../etc/run.storyletsave")).toBe(join("/work", "run.storyletsave"));
  });
});

describe("withFilterExtension", () => {
  it("adds the filter's extension to a bare name, as GTK does not", () => {
    expect(withFilterExtension("/home/a/Saltmarsh", PACK)).toBe("/home/a/Saltmarsh.storyletpack");
  });
  it("leaves a name that already carries it, in any case", () => {
    expect(withFilterExtension("/home/a/Saltmarsh.storyletpack", PACK)).toBe("/home/a/Saltmarsh.storyletpack");
    expect(withFilterExtension("/home/a/Saltmarsh.STORYLETPACK", PACK)).toBe("/home/a/Saltmarsh.STORYLETPACK");
  });
  it("adds it after a dot that is not the filter's own", () => {
    expect(withFilterExtension("/home/a/v1.2", PACK)).toBe("/home/a/v1.2.storyletpack");
  });
  it("leaves the path alone with no filter, or an any-file one", () => {
    expect(withFilterExtension("/home/a/x", undefined)).toBe("/home/a/x");
    expect(withFilterExtension("/home/a/x", [{ name: "All", extensions: ["*"] }])).toBe("/home/a/x");
  });
});

describe("savePathFor", () => {
  it("refuses to land the made-up name on a file that is already there", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-save-path-"));
    writeFileSync(join(dir, "Saltmarsh.storyletpack"), "old");
    const r = savePathFor(join(dir, "Saltmarsh"), PACK);
    expect(r).toEqual({ error: expect.stringContaining("already exists") });
  });
  it("lets the picker's own confirmed name through, even over a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-save-path-"));
    writeFileSync(join(dir, "Saltmarsh.storyletpack"), "old");
    expect(savePathFor(join(dir, "Saltmarsh.storyletpack"), PACK)).toEqual({ path: join(dir, "Saltmarsh.storyletpack") });
  });
});

describe("every Save dialog in main", () => {
  it("goes through the one picker that makes the path whole", () => {
    const calls = mainFiles().flatMap(({ path, text }) => (text.match(/showSaveDialog\(/g) ?? []).map(() => path.replaceAll("\\", "/")));
    expect(calls).toEqual(["ipc/publish.ts"]);
  });
});
