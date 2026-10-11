// What `storyletengine licences` prints: the Storylet Engine's own licence, and, in a standalone binary,
// the notices of every library compiled into it. The standalone build embeds both files and hands their
// paths over (scripts/build-standalone.mjs). Run from dist/cli.js, it reads the LICENSE beside dist/, and
// its libraries sit in node_modules beside it, each with its own licence file.

import { readFileSync } from "node:fs";

let embedded: { licence?: string; libraries?: string } = {};

/** Read the licence and the library notices from these files: for a build that embeds them. */
export function useEmbeddedNotices(paths: { licence: string; libraries: string }): void {
  embedded = { ...paths };
}

/** The Storylet Engine's own licence (MIT). */
export function ownLicence(): string {
  return readFileSync(embedded.licence ?? new URL("../LICENSE", import.meta.url), "utf8").trim();
}

/** The notices of the libraries compiled into this build, or undefined when they install beside it. */
export function libraryNotices(): string | undefined {
  return embedded.libraries === undefined ? undefined : readFileSync(embedded.libraries, "utf8").trim();
}
