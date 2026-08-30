// The smallest DOM helper that keeps main.ts readable. Deliberately not a
// framework: a reader learning the engine should not have to learn this first.
/// <reference lib="dom" />

interface Options {
  className?: string;
  text?: string;
  onClick?: () => void;
}

export function el(tag: string, opts: Options = {}, ...children: Node[]): HTMLElement {
  const node = document.createElement(tag);
  if (opts.className !== undefined) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.onClick !== undefined) node.addEventListener("click", opts.onClick);
  node.append(...children);
  return node;
}

export function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`no #${id} in the page`);
  return node;
}
