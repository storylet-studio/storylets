// ---------------------------------------------------------------------------
// The preload's import list, as a contract.
//
// Adopted from the Patter side, 2026-08-17
// (patterkit/design/to-storylets/pinbutton-needs-a-tooltip-host.md section 2),
// where the fault it guards against SHIPPED FOR ELEVEN COMMITS. Patterpad's
// preload imported a constant from `@wildwinter/app-shell/job`. It built clean
// and typechecked clean, and it took the whole bridge down at runtime:
// electron-vite auto-externalises anything in `dependencies`, so the import
// became a `require` that a preload with `sandbox: true` cannot serve. The
// script fails to load, `contextBridge` never runs, `window.studio` is
// undefined, and the app opens to the welcome screen with every control dead.
// One line in DevTools is the only clue.
//
// Storyletter does not have the bug, and the reason is load-bearing rather than
// stylistic: `JOB_PROGRESS_CHANNEL` comes from our own `shared/api.ts`, not from
// the shell. That looks exactly like something a tidying pass would "fix", which
// is why it is pinned here.
//
// Read as SOURCE rather than imported, deliberately. Importing the preload would
// execute it, which needs an `electron` that is not there in a test - and it
// would prove nothing about what a bundler does with the import list.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JOB_PROGRESS } from "@wildwinter/app-shell/job";
import { JOB_PROGRESS_CHANNEL } from "../shared/api.js";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

/** Every module this file imports VALUES from, in source order. `import type`
 *  is excluded: types are erased, so they cannot reach the bundler. */
function valueImports(text: string): string[] {
  const out: string[] = [];
  // `import ... from "x"` and bare `import "x"`, minus the type-only forms.
  for (const m of text.matchAll(/^import\s+(?!type\s)([\s\S]*?)?from\s+"([^"]+)";/gm)) {
    const clause = m[1] ?? "";
    // `import { type A, type B } from "x"` is also erased entirely.
    const names = clause.replace(/[{}\s]/g, "").split(",").filter((n) => n !== "");
    if (names.length > 0 && names.every((n) => n.startsWith("type"))) continue;
    out.push(m[2]!);
  }
  for (const m of text.matchAll(/^import\s+"([^"]+)";/gm)) out.push(m[1]!);
  return out;
}

describe("the preload's imports", () => {
  it("takes values from electron and from this app, and from no package", () => {
    // A relative import is BUNDLED into the preload, so it is safe. A bare
    // specifier is externalised into a `require`, and a sandboxed preload cannot
    // serve one - whatever the package is, and however harmless it looks.
    const bare = valueImports(source).filter((s) => !s.startsWith("."));
    expect(bare).toEqual(["electron"]);
  });

  it("keeps our job-progress channel identical to the shell's", () => {
    // The reason we can hold our own copy of the literal: main sends on the
    // shell's constant, the preload listens on ours, and a drift between them
    // would silently stop every progress bar without failing anything.
    expect(JOB_PROGRESS_CHANNEL).toBe(JOB_PROGRESS);
  });
});
