// The one thing that can silently break the coverage progress bar: our channel
// name drifting from the shell kit's.
//
// We declare the channel in api.ts rather than importing the kit's constant,
// because the preload is SANDBOXED - a bare module specifier there cannot be
// resolved at runtime, the preload fails to load entirely, and window.studio
// goes with it (a blank window, which is how this was found on 2026-08-03).
// The cost of declaring our own is that it could drift. This is the guard.

import { describe, expect, it } from "vitest";
import { JOB_PROGRESS } from "@wildwinter/app-shell/job";
import { JOB_PROGRESS_CHANNEL } from "./api.js";

describe("the long-job channel", () => {
  it("matches the shell kit's, so main's sends reach the preload's listener", () => {
    expect(JOB_PROGRESS_CHANNEL).toBe(JOB_PROGRESS);
  });
});
