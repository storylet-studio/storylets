// The journal: what has happened, in the player's words.
//
// A game's version of a transcript. Note where the lines come from: an
// outcome's own `purpose`, which the DESIGNER wrote in Storyletter. The client
// invents no prose, which is the point of a storylet system.
/// <reference lib="dom" />

import { el, $ } from "./dom.js";

let lines: string[] = [];

export function note(line: string): void {
  lines.push(line);
  draw();
}

export function journal(next: string[]): void {
  lines = next;
  draw();
}

function draw(): void {
  $("journal").replaceChildren(...lines.map((l) => el("p", { text: l })));
  $("journal").scrollTop = $("journal").scrollHeight;
}
