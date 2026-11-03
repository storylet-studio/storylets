// The lockstep check under `npm test`, so a runtime manifest or version constant that's drifted fails locally,
// not only in CI. It reads through the check's own table rather than running the script in a child process.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs module, shared with the release scripts
import { lockstepVersions } from "./lib/storylet-engine-version-constants.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("the Storylet Engine runtimes", () => {
  it("carry one version, in every manifest and version constant", () => {
    const versions: Record<string, string | undefined> = lockstepVersions((rel: string) => readFileSync(root + rel, "utf8"));
    const distinct = [...new Set(Object.values(versions))];
    expect(distinct.length === 1 && distinct[0] ? [] : Object.entries(versions)).toEqual([]);
  });
});
