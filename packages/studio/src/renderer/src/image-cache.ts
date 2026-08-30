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
// ---------------------------------------------------------------------------

type Entry =
  | { state: "loading" }
  | { state: "ready"; image: HTMLImageElement }
  | { state: "failed" };

const cache = new Map<string, Entry>();
const waiting = new Set<(url: string) => void>();

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
  image.onload = () => { cache.set(url, { state: "ready", image }); announce(url); };
  image.onerror = () => { cache.set(url, { state: "failed" }); announce(url); };
  image.src = url;
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

