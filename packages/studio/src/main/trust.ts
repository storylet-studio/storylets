// ---------------------------------------------------------------------------
// What main will take from a renderer. A renderer is a web page, and anything
// that gets to run in one can call the bridge with whatever it likes, so the
// handlers that reach the disk check what they are handed against what main
// itself knows (the Storyletter review of 2026-10, item 27).
// ---------------------------------------------------------------------------

import { resolve } from "node:path";
import { EXAMPLES } from "../shared/examples.js";

/** Is this one of the examples this build ships? `example:open` copies a folder
 *  by this name out of the app's resources, so a name it did not offer is
 *  never a folder it should go looking for. */
export function shippedExample(name: string): boolean {
  return EXAMPLES.some((x) => x.file === name);
}

/**
 * The paths main has handed a renderer to come back with: a pack chosen in a
 * native picker, or one the OS passed at launch. `pack:openAt` opens only
 * these, as `pack:mergeCommit` only commits the plan main is holding.
 * Compared resolved, so the same file spelt another way is the same file.
 */
export class HandedPaths {
  private readonly paths = new Set<string>();
  add(path: string): void { this.paths.add(resolve(path)); }
  has(path: string): boolean { return typeof path === "string" && this.paths.has(resolve(path)); }
}

/** Every one of these is a real, finite number: what a position or a size
 *  has to be before it is written to a shard. */
export function allFinite(...values: unknown[]): boolean {
  return values.every((v) => typeof v === "number" && Number.isFinite(v));
}
