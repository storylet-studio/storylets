import { defineConfig } from "tsup";

// The wire is TYPES ONLY, so nothing of it survives compilation and there is
// nothing to leave external: `noExternal` inlines the handful of string
// constants (WIRE_PATH, IDEMPOTENCY_HEADER) it does emit, and a consumer of
// this package needs no second install to use it.
//
// No IIFE build here, unlike play-helpers. This package is consumed by a
// bundler in every case that exists: the reference apps bundle it, and a
// venue's agency bundles it. A drop-in script tag would need a global name and
// a story about how a page gets its station key, and neither has a customer.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  noExternal: [/^@storylet-studio\//],
});
