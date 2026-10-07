// ---------------------------------------------------------------------------
// A project's pictures: served to the renderer over a scheme of our own, and
// swept when nothing can want them back.
// ---------------------------------------------------------------------------

import { protocol } from "electron";
import { rmSync, rmdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ASSETS_DIR, assetPath, orphanAssetPaths } from "@storylet-studio/ops";
import { plural } from "@wildwinter/app-shell/util";
import type { ProjectSession } from "./project.js";
import { ASSET_SCHEME, PROJECT_MAP_ASSETS } from "../shared/api.js";

/**
 * Chromium has to be told about a scheme BEFORE `whenReady`, or `protocol.handle`
 * serves a URL the renderer is not allowed to load: an unregistered scheme is
 * treated as opaque, so an <img> pointing at one is refused before the handler is
 * ever asked. `standard` gives it host/path parsing (the box id is the host),
 * `secure` keeps a page loaded over it out of the mixed-content bucket, and
 * `stream` is the point of the whole scheme - a 10MB site plan arriving in chunks
 * rather than as one buffer. `supportFetchAPI` is what lets the renderer fetch()
 * one directly, which is how a picture's size gets checked without decoding it.
 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  ]);
}

/**
 * Serve a box's background images to the renderer, over a scheme of our own.
 *
 * NOT over IPC, and the reason is in the file sizes: a site plan is a 2816x1536
 * PNG of about 10MB, and three of them is 30MB structure-cloned across the
 * bridge for a picture Chromium can stream off disk itself and cache. The
 * renderer just sets `img.src` and the browser does the rest.
 *
 * The authority stays HERE, though, which is the whole point of the scheme
 * existing rather than handing out `file://`. A URL is
 * `storylet-asset://<boxId>/<file>`, and both halves are checked against the
 * OPEN PROJECT: an unknown box, a name that is not a plain file name, or no
 * project at all, and nothing is served. So a renderer (or anything that gets to
 * run in one) can reach the project's own pictures and nothing else on the disk.
 * The box names the map being viewed; the file is served from the project's one
 * assets folder (design/project-map-contract.md 1.4).
 */
export function serveAssets(current: () => ProjectSession | undefined): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const session = current();
    const url = new URL(request.url);
    // `host` is the box id, `pathname` the file. Both decoded, because a real
    // filename has spaces in it.
    const boxId = decodeURIComponent(url.host);
    const file = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const source = session?.loaded.source;
    const box = source?.boxes.find((b) => b.box.box.id === boxId);
    // The project map's pictures belong to no box: their host is
    // PROJECT_MAP_ASSETS, served while the project has a map.
    const projectMap = boxId === PROJECT_MAP_ASSETS && source?.map !== undefined;
    if (!session || (!box && !projectMap)) return new Response("no such box", { status: 404 });
    const full = assetPath(session.loaded.dir, file);
    if (full === undefined) return new Response("not a file name", { status: 400 });
    try {
      const bytes = await readFile(full);
      return new Response(bytes, {
        headers: {
          "content-type": contentTypeFor(file),
          // The bytes on disk never change under a given name (an import writes a
          // new name rather than replacing one in use), so let the renderer keep
          // it. A picture re-read on every repaint would be the whole reason for
          // this scheme, wasted.
          "cache-control": "max-age=3600",
        },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

/** Enough of a guess for the images a floor plan arrives as. */
function contentTypeFor(file: string): string {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

/**
 * Delete the assets no map uses any more, and the stray copies of pictures an
 * in-app upgrade to the project map left in a box's own folder for its undo
 * (ops `strayBoxAssetPaths` says which: only once the project is on the map).
 *
 * Safe because of what the project folder IS: internal to the project, filled by
 * an import that COPIED somebody's file from somewhere else. An orphan here is a
 * second copy by construction, version control has the history, and the only
 * reason to keep one was the live undo chain - undo an import and the file must
 * still be there.
 *
 * So this runs exactly where that chain ends: when a session is replaced, and
 * when the app quits. Never mid-session, where an undo might still want the
 * bytes, and never on OPEN either: a crash-orphaned file is harmless until the
 * next clean close, and sweeping something an author had just put in the folder
 * by hand would be a surprise for no gain.
 */
export function sweepOrphanAssets(ending: ProjectSession | undefined): void {
  const source = ending?.loaded.source;
  if (!ending || !source) return;
  const orphans = orphanAssetPaths(ending.loaded.dir, source);
  for (const path of orphans) {
    try { rmSync(path); } catch { /* gone already, or read-only: not worth a word */ }
  }
  // A box's own assets folder, emptied of an upgrade's stray copies, goes too;
  // rmdir refuses a folder with anything left in it, which is the point.
  const rootAssets = join(ending.loaded.dir, ASSETS_DIR);
  for (const folder of new Set(orphans.map((path) => dirname(path)))) {
    if (folder === rootAssets) continue;
    try { rmdirSync(folder); } catch { /* something else is in it: leave it */ }
  }
  if (orphans.length > 0) {
    console.log(`swept ${plural(orphans.length, "unused asset")}`);
  }
}
