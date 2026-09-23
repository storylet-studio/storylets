// ---------------------------------------------------------------------------
// What the arrows mean, told two ways on both link canvases (the node canvas
// and the Links window): a KEY, opened from a quiet control, and a TIP on the
// arrow itself naming why it exists.
//
// One module for both canvases so they cannot drift, and every sample drawn
// from the painter's own rule (`edgeStroke` in node-art.ts): a key with its own
// idea of what a reference looks like would be wrong the day either changed.
//
// A key, not a legend. Explanatory text waits until it is approached (the
// density rule), so nothing here is on screen until somebody asks.
// ---------------------------------------------------------------------------

import "./edge-key.css";
import { openAnchoredPanel } from "@wildwinter/app-shell";
import { el } from "./dom.js";
import { edgesAt, edgeStroke, ARROW_LENGTH, ARROW_WIDTH, type CardNode, type EdgeStroke } from "./node-art.js";
import { explainEdges } from "../links/links-explain.js";
import type { CanvasTokens } from "./canvas-tokens.js";
import type { GraphEdge } from "../../shared/api.js";

/** The four classes, in the words the Links window leads with and the glosses
 *  the documentation gives them. */
export const CLASS_KEY: readonly { cls: GraphEdge["cls"]; word: string; gloss: string }[] = [
  { cls: "enable", word: "opens", gloss: "playing it can make the other card available" },
  { cls: "disable", word: "shuts", gloss: "playing it can take the other card away" },
  { cls: "influence", word: "changes what is true for", gloss: "writes state the other reads, either way" },
  { cls: "reference", word: "shares state with", gloss: "neither writes it; both read it" },
];

/** What a coverage run said, drawn on an `opens` arrow: evidence rides on top of
 *  the class ink, so a sample has to wear SOME class, and the commonest is the
 *  honest choice. */
export const EVIDENCE_KEY: readonly { evidence: NonNullable<GraphEdge["evidence"]>; word: string }[] = [
  { evidence: "observed", word: "seen in a coverage run" },
  { evidence: "possible", word: "possible, but never seen" },
  { evidence: "flagged", word: "seen, but not predicted" },
];

const SVG = "http://www.w3.org/2000/svg";
const SAMPLE_W = 40;
const SAMPLE_H = 12;

/** One arrow, drawn at one to one with exactly the stroke the canvas uses. */
export function edgeSample(stroke: EdgeStroke): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", String(SAMPLE_W));
  svg.setAttribute("height", String(SAMPLE_H));
  svg.setAttribute("viewBox", `0 0 ${SAMPLE_W} ${SAMPLE_H}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "edgekey-sample");
  svg.setAttribute("opacity", String(stroke.opacity));
  const mid = SAMPLE_H / 2;
  const tip = SAMPLE_W - 1;
  // Konva's arrow runs its line to the tip and lays the head over it; the same
  // here, so a dash reads the same way into the head.
  const line = document.createElementNS(SVG, "line");
  line.setAttribute("x1", "1");
  line.setAttribute("y1", String(mid));
  line.setAttribute("x2", String(tip - ARROW_LENGTH / 2));
  line.setAttribute("y2", String(mid));
  line.setAttribute("stroke", stroke.ink);
  line.setAttribute("stroke-width", String(stroke.width));
  if (stroke.dash) line.setAttribute("stroke-dasharray", stroke.dash.join(" "));
  const head = document.createElementNS(SVG, "polygon");
  head.setAttribute("points",
    `${tip},${mid} ${tip - ARROW_LENGTH},${mid - ARROW_WIDTH / 2} ${tip - ARROW_LENGTH},${mid + ARROW_WIDTH / 2}`);
  head.setAttribute("fill", stroke.ink);
  svg.append(line, head);
  return svg;
}

/** The key's rows: the four classes, and the three evidence states when the
 *  arrows on this canvas are actually wearing them. */
export function edgeKeyRows(tokens: CanvasTokens, evidence: boolean): HTMLElement[] {
  const row = (stroke: EdgeStroke, word: string, gloss?: string): HTMLElement =>
    el("div", { className: "edgekey-row" },
      edgeSample(stroke),
      el("span", { className: "edgekey-word", text: word }),
      ...(gloss !== undefined ? [el("span", { className: "edgekey-gloss", text: gloss })] : []),
    );
  return [
    ...CLASS_KEY.map((k) => row(edgeStroke(tokens, k.cls), k.word, k.gloss)),
    ...(evidence
      ? [
          el("div", { className: "edgekey-cap", text: "What a coverage run saw" }),
          ...EVIDENCE_KEY.map((k) => row(edgeStroke(tokens, "enable", k.evidence), k.word)),
        ]
      : []),
  ];
}

/**
 * The control that opens the key. The caller places it and gives it its
 * canvas's button voice; the panel is the shell's anchored one, so it closes on
 * a click elsewhere, on Escape, and on a second press of the same control.
 *
 * `tokens` and `evidence` are getters: read at the moment it opens, so a theme
 * switch or a coverage run since mounting is reflected.
 */
export function edgeKeyButton(opts: {
  className: string;
  tokens: () => CanvasTokens;
  evidence: () => boolean;
}): HTMLButtonElement {
  const button = el("button", {
    className: opts.className, text: "Key", tip: "What the arrows mean",
    onClick: () => {
      const panel = openAnchoredPanel({
        anchor: button, className: "edgekey", title: "Arrows", width: 440, prefer: "below",
      });
      panel?.body.append(...edgeKeyRows(opts.tokens(), opts.evidence()));
    },
  }) as HTMLButtonElement;
  return button;
}

/**
 * The hover half: a surface's `backdropTip` that names the edges under the
 * pointer, worded by the Links window's own `explainEdges`. Cards are not
 * considered here; the surface only asks when none is under the pointer.
 */
export function edgeTip<T>(
  edges: () => readonly GraphEdge[],
  nameOf: (id: string) => string,
  /** The surface's live lookup narrowed to cards, as the painter is handed it. */
  cardAt: (at: (id: string) => T | undefined) => (id: string) => CardNode | undefined,
): (world: { x: number; y: number }, scale: number, at: (id: string) => T | undefined) => { key: string; text: string } | undefined {
  return (world, scale, at) => {
    const hit = edgesAt([...edges()], cardAt(at), world, scale);
    if (hit.length === 0) return undefined;
    return {
      key: `edge:${hit.map((e) => `${e.from}>${e.to}:${e.cls}`).join("|")}`,
      text: explainEdges(hit, nameOf),
    };
  };
}
