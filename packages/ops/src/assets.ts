// ---------------------------------------------------------------------------
// Where a box keeps its binary assets, and the one rule about their names.
//
// Assets are a first for this project: everything else it writes is text a human
// can read and git can merge. They live in `<box>/assets/` and belong to their
// box, so a shard records a NAME and never a path - a box that moves takes its
// pictures with it, and nothing in a shard can point outside the project.
//
// That last part is not a nicety. A name arriving from a shard is untrusted
// input: a pack, a merge or a hand edit can put anything in that field, and
// `join(dir, name)` with "../../../.ssh/id_rsa" resolves happily. `assetPath`
// refuses anything that is not a plain filename, which is the same containment
// check the unpack path learnt to make.
// ---------------------------------------------------------------------------

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { backgroundsOf } from "@storylet-studio/model";
import type { SourceBox } from "@storylet-studio/compiler";

/** The folder a box keeps its assets in, project-relative. */
export const ASSETS_DIR = "assets";

/** Is this a plain filename we are willing to resolve? No separators, no
 *  traversal, no absolute paths, no dotfiles. */
export function isSafeAssetName(name: string): boolean {
  if (name === "" || name.length > 255) return false;
  if (name.startsWith(".")) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.includes("\0")) return false;
  // Windows drive letters and reserved device names, since a project folder is
  // shared between platforms even when this app is not.
  if (/^[a-z]:/i.test(name)) return false;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) return false;
  return true;
}

/** Where one of a box's assets sits on disk, or undefined when the name is not a
 *  name we will resolve (see the note above: shard fields are untrusted). */
export function assetPath(dir: string, box: SourceBox, file: string): string | undefined {
  if (!isSafeAssetName(file)) return undefined;
  return join(dir, box.path, ASSETS_DIR, file);
}

/**
 * An image's pixel size, read from its header.
 *
 * Main needs this so a dropped picture can be placed in ONE act: pick, copy, and
 * write the entry with a rectangle already sized to the author's view. Without it
 * the renderer would have to load the image to learn its size and then place it,
 * which is two commits and two undo steps for one gesture.
 *
 * Headers only, no decoding: the four formats a floor plan actually arrives as,
 * and undefined for anything else. Undefined is not a refusal - the picture is
 * still imported, it just gets a square guess - because a format we cannot
 * measure is a worse reason to reject somebody's map than to place it awkwardly.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (i: number): number => (i < bytes.length ? bytes[i]! : -1);

  // PNG: an 8-byte signature, then IHDR with width and height as big-endian u32.
  if (bytes.length > 24 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // GIF: "GIF87a"/"GIF89a", then width and height as little-endian u16.
  if (bytes.length > 10 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  // WebP: RIFF....WEBP, then a VP8/VP8L/VP8X chunk, each of which says it
  // differently. Lossy, lossless and extended are all common enough to matter.
  if (bytes.length > 30 && at(0) === 0x52 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42) {
    const chunk = String.fromCharCode(at(12), at(13), at(14), at(15));
    if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      const w = at(24) | (at(25) << 8) | (at(26) << 16);
      const h = at(27) | (at(28) << 8) | (at(29) << 16);
      return { width: w + 1, height: h + 1 };
    }
    return undefined;
  }

  // JPEG: walk the segments to the start-of-frame, which is the only place the
  // size is written. Skips APPn blocks (a phone photo's EXIF is thousands of
  // bytes) and stops at the first SOFn.
  if (bytes.length > 4 && at(0) === 0xff && at(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (at(i) !== 0xff) { i++; continue; }          // resync rather than give up
      const marker = at(i + 1);
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = view.getUint16(i + 2);
      // SOF0..SOF15, except the four that are not frames (DHT, JPG, DAC, and the
      // restart markers handled above).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
      }
      if (length < 2) return undefined;               // malformed: stop rather than loop
      i += 2 + length;
    }
    return undefined;
  }

  return undefined;
}

/**
 * Which of a box's asset files are REFERENCED by one of its maps, and which are
 * orphans.
 *
 * Orphans are made by ordinary work rather than by mistakes: undoing an import
 * keeps the file, removing a background leaves its bytes behind, and a merge can
 * bring a placement whose picture never arrived.
 *
 * They are OURS to delete, and that is the point worth being clear about (settled
 * 2026-08-07). The project folder is internal to the project and import COPIES:
 * the author's own file is wherever they got it from, so an orphan here is a
 * second copy by construction, not somebody's only site plan. Version control
 * holds the history besides. The single reason to keep one is the live undo chain
 * - undo an import and the file has to still be there - and that chain does not
 * outlive the session, which is exactly when they are swept.
 */
export function assetUse(dir: string, box: SourceBox): { used: string[]; orphans: string[] } {
  const referenced = new Set<string>();
  for (const group of box.tags.groups) {
    for (const background of backgroundsOf(group)) referenced.add(background.file);
  }
  const folder = join(dir, box.path, ASSETS_DIR);
  let onDisk: string[] = [];
  try {
    onDisk = readdirSync(folder, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return { used: [], orphans: [] };   // no assets folder is the normal state
  }
  return {
    used: onDisk.filter((name) => referenced.has(name)).sort(),
    orphans: onDisk.filter((name) => !referenced.has(name)).sort(),
  };
}

/**
 * Every orphaned asset in a project, as absolute paths.
 *
 * Ops describes, the caller acts: this walks and reports, and deleting is the
 * host's business (the studio sweeps at the end of a session, when the undo chain
 * that was the only reason to keep them is being discarded anyway).
 */
export function orphanAssetPaths(dir: string, boxes: readonly SourceBox[]): string[] {
  const out: string[] = [];
  for (const box of boxes) {
    for (const name of assetUse(dir, box).orphans) out.push(join(dir, box.path, ASSETS_DIR, name));
  }
  return out.sort();
}

/** A name nobody in `taken` is using: "plan.png", then "plan-2.png". The same
 *  sparse-suffix rule the editor uses for gameIds, applied to a filename so an
 *  import never silently replaces a picture somebody is still using. */
export function freeAssetName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}
