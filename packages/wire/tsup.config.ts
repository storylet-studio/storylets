import { defineConfig } from "tsup";

// The library only: ESM + CJS + types, dependencies left external.
//
// This package is types plus a handful of string constants, so the emitted
// JavaScript is a few `export const` lines and nothing else. Its one
// dependency, `@storylet-studio/model`, is imported with `import type`
// exclusively and therefore never appears in the emitted JS at all; it is
// left external so the .d.ts refers to the model's own types rather than
// stamping a second copy of them into every consumer.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
});
