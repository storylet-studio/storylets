// ---------------------------------------------------------------------------
// What a kit part IS (design/engine-server.md section 12, layer 3).
//
// One function, one element, `update()` and `dispose()`. No framework, no
// base class, no lifecycle to learn: a venue's agency composes these, drops
// the ones it does not want, and replaces any of them with its own without
// telling the rest.
//
// The part hands back an OBJECT holding the element rather than an element
// with methods bolted on. Two reasons, both practical: a `DocumentFragment`
// or an SVG root is then just as legal a body as a `<div>`, and nothing has to
// wonder whether `update` on an element is the kit's or the platform's.
//
// Vanilla TS, like everything else in the family. A React or Svelte binding is
// a thin wrapper if a venue's agency wants one, and not before.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

/** Every part, and the only contract between them.
 *
 *  `update` is called with the whole of what the part draws, every time, and
 *  the part works out what changed. Nothing here diffs for you and nothing
 *  needs a key: these are small parts and a venue reads them. */
export interface Part<T = void> {
  /** Mount this wherever you like. The part never touches anything above it. */
  readonly el: HTMLElement;
  update(state: T): void;
  /** Remove listeners and timers. Calling it twice is safe; calling `update`
   *  afterwards is a no-op rather than an error, because a page that tears
   *  down while a fetch is in flight should not throw at a performer. */
  dispose(): void;
}

interface ElOptions {
  className?: string;
  text?: string;
  title?: string;
  type?: string;
  onClick?: (ev: MouseEvent) => void;
  attrs?: Record<string, string>;
}

/** The smallest DOM helper that keeps the parts readable. Deliberately not a
 *  framework: somebody learning the kit should not have to learn this first.
 *  (The Village client's `el`, with two fields added.) */
export function el(tag: string, opts: ElOptions = {}, ...children: Node[]): HTMLElement {
  const node = document.createElement(tag);
  if (opts.className !== undefined) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.title !== undefined) node.title = opts.title;
  if (opts.type !== undefined) node.setAttribute("type", opts.type);
  for (const [k, v] of Object.entries(opts.attrs ?? {})) node.setAttribute(k, v);
  if (opts.onClick !== undefined) node.addEventListener("click", opts.onClick as EventListener);
  node.append(...children);
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** The SVG twin of `el`. The map and the QR both need it. */
export function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Every part carries this prefix, so a venue's own stylesheet can reach all
 *  of the kit and none of its own markup with one selector. */
export const KIT = "sk";

/** `sk-hand`, `sk-card`, and so on. One place the prefix is spelt. */
export const cls = (...names: string[]): string => names.map((n) => `${KIT}-${n}`).join(" ");
