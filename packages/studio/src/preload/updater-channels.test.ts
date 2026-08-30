// The preload writes the updater's channel names out as literal strings, because
// it is the sandbox boundary and pulls in nothing it does not have to. That is a
// deliberate duplication, so it needs what every deliberate duplication needs: a
// check that fails when the two copies stop agreeing.
//
// The failure this prevents is SILENT. If the shell renames a channel, nothing
// throws: main sends on the new name, the preload listens on the old one, no
// handler ever answers, and the shell's 300-second timeout resolves to its own
// fallback. Check for Updates would simply appear to do nothing.
//
// The names are read out of the shell's built source as TEXT rather than by
// importing it, for two reasons: importing `@wildwinter/app-shell/updater` drags
// in `electron`, which will not load in a node test; and text-against-text is
// what this test is actually about.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const preload = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

// Resolved rather than reached for by a relative path: npm is free to hoist the
// package to the workspace root or keep it local, and a hardcoded `../../..`
// breaks silently on the day it changes its mind.
const require = createRequire(import.meta.url);
const shellUpdater = readFileSync(require.resolve("@wildwinter/app-shell/updater"), "utf8");

/** Every `updater:*` channel the shell names, taken from its own source. */
const shellChannels = [...new Set(shellUpdater.match(/"updater:[a-z-]+"/g) ?? [])]
  .map((q) => q.slice(1, -1))
  .sort();

describe("the preload answers the shell's updater channels", () => {
  it("finds the shell's channel list at all", () => {
    // Guards the guard: a rename or a bundling change that stops the regex
    // matching would otherwise make every assertion below vacuously pass.
    expect(shellChannels.length).toBe(7);
  });

  it("names every channel the shell defines", () => {
    for (const name of shellChannels) {
      expect(preload, `the preload never mentions "${name}"`).toContain(`"${name}"`);
    }
  });

  it("listens on the four main-to-renderer channels", () => {
    const inbound = shellChannels.filter((c) => !/reply|done/.test(c));
    expect(inbound).toHaveLength(4);
    for (const name of inbound) {
      expect(preload, `no ipcRenderer.on for "${name}"`).toContain(`ipcRenderer.on("${name}"`);
    }
  });

  it("replies on the three renderer-to-main channels", () => {
    const outbound = shellChannels.filter((c) => /reply|done/.test(c));
    expect(outbound).toHaveLength(3);
    for (const name of outbound) {
      expect(preload, `no ipcRenderer.send for "${name}"`).toContain(`ipcRenderer.send("${name}"`);
    }
  });
});
