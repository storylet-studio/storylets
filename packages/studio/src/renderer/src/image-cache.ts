// ---------------------------------------------------------------------------
// Images for a canvas: loaded once, drawn many times.
//
// A canvas repaints constantly - every zoom, every theme change, every drag
// frame - and Konva needs a decoded HTMLImageElement to draw. Decoding a 10MB
// site plan per repaint is not a thing that can be allowed to happen, so the
// element is cached by URL and handed back synchronously once it exists.
//
// The awkward part is the FIRST paint, when it does not exist yet. `imageFor`
// answers undefined and starts the load, and the caller draws whatever it draws
// for "not here yet" and asks to be told. No promises in the draw path: a draw
// happens inside a repaint and cannot wait for anything.
//
// The cache belongs to ONE PROJECT. A picture's URL names a box and a file
// (`storylet-asset://<box>/<file>`), and two projects can share both: the
// worked examples do, so opening the second showed the first one's site plan.
// So the cache is emptied when the project changes, and the project is also
// written into the URL the image is fetched by, because Chromium keeps its own
// cache of image URLs underneath this one and would otherwise hand the old
// bytes straight back.
// ---------------------------------------------------------------------------

type Entry =
  | { state: "loading" }
  | { state: "ready"; image: HTMLImageElement }
  | { state: "failed" };

const cache = new Map<string, Entry>();
const waiting = new Set<(url: string) => void>();
/** The project the cache is for: a stamp written into every fetch, so another
 *  project's picture under the same name is a different URL to the browser. */
let project = "";

/**
 * The cache is for this project now. A change empties it; the same project
 * again keeps it, so a re-render that says so again costs nothing.
 */
export function setImageProject(id: string): void {
  if (id === project) return;
  project = id;
  cache.clear();
}

/**
 * Try again whatever failed to load: called when a view opens, so a picture
 * that was missing (not copied in yet, or on a drive that was not mounted) is
 * looked for again rather than remembered as broken until the app restarts.
 */
export function retryFailedImages(): void {
  for (const [url, entry] of cache) if (entry.state === "failed") cache.delete(url);
}

/** The URL actually fetched: the asset's own, stamped with the project. Main
 *  ignores the query, so the stamp only ever reaches the browser's cache. */
export function fetchUrl(url: string, forProject: string = project): string {
  if (forProject === "") return url;
  return `${url}${url.includes("?") ? "&" : "?"}project=${encodeURIComponent(forProject)}`;
}

/**
 * The decoded image for a URL, or undefined while it is not available.
 *
 * Undefined covers both "still loading" and "will never load", which is
 * deliberate: a caller draws the same placeholder either way, and the reason a
 * picture is missing is validation's business (it reports a warning naming the
 * file) rather than the canvas's.
 */
export function imageFor(url: string): HTMLImageElement | undefined {
  const entry = cache.get(url);
  if (entry?.state === "ready") return entry.image;
  if (entry !== undefined) return undefined;   // loading, or already failed

  cache.set(url, { state: "loading" });
  const image = new Image();
  // A load that finishes after the project changed is the old project's picture:
  // it is not cached under the new one.
  const asked = project;
  image.onload = () => { if (asked === project) { cache.set(url, { state: "ready", image }); announce(url); } };
  image.onerror = () => { if (asked === project) { cache.set(url, { state: "failed" }); announce(url); } };
  image.src = fetchUrl(url, asked);
  return undefined;
}

/** Be told when an image arrives, so the canvas can repaint. Returns a teardown.
 *  One listener per view, not per image: a view repaints as a whole. */
export function onImageReady(listener: (url: string) => void): () => void {
  waiting.add(listener);
  return () => waiting.delete(listener);
}

function announce(url: string): void {
  for (const listener of [...waiting]) listener(url);
}
