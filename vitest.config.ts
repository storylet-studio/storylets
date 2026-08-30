import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// During dev/test, resolve workspace packages to their TS source (no build step).
//
// @wildwinter/expr (+ scoperegistry) live in the sibling repo github.com/wildwinter/expr.
// When a `../expr` checkout exists (maintainers, CI), alias to its source so the repos can
// evolve together; otherwise fall back to the published npm packages in node_modules, so a
// plain clone runs the whole suite with no sibling checkout. (The Patter pattern, verbatim.)
const expr = (pkg: string): string | undefined => {
  const src = new URL(`../expr/packages/${pkg}/src/index.ts`, import.meta.url);
  return existsSync(src) ? fileURLToPath(src) : undefined;
};

export default defineConfig({
  resolve: {
    alias: {
      "@storylet-studio/model": fileURLToPath(new URL("./packages/model/src/index.ts", import.meta.url)),
      "@storylet-studio/dialect": fileURLToPath(new URL("./packages/dialect/src/index.ts", import.meta.url)),
      "@storylet-studio/compiler": fileURLToPath(new URL("./packages/compiler/src/index.ts", import.meta.url)),
      "@storylet-studio/runtime": fileURLToPath(new URL("./packages/runtime/src/index.ts", import.meta.url)),
      "@storylet-studio/play-helpers": fileURLToPath(new URL("./packages/play-helpers/src/index.ts", import.meta.url)),
      "@storylet-studio/ops": fileURLToPath(new URL("./packages/ops/src/index.ts", import.meta.url)),
      "@storylet-studio/conformance": fileURLToPath(new URL("./packages/conformance/src/index.ts", import.meta.url)),
      ...(expr("expr") ? { "@wildwinter/expr": expr("expr")! } : {}),
      ...(expr("expr-specificity") ? { "@wildwinter/expr-specificity": expr("expr-specificity")! } : {}),
      ...(expr("scoperegistry") ? { "@wildwinter/scoperegistry": expr("scoperegistry")! } : {}),
    },
  },
});
