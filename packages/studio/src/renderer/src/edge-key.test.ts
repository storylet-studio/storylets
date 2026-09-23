// @vitest-environment jsdom
// The arrows' key and the arrow's tip, shared by the node canvas and the Links
// window. What matters: the key draws each sample with the painter's own stroke
// (so it cannot describe a line the canvas does not draw), the evidence rows
// come and go with the evidence, and a hovered arrow never talks over a card.

import { afterEach, describe, expect, it } from "vitest";
import { closeAnchoredPanel } from "@wildwinter/app-shell";
import { edgeKeyButton, edgeKeyRows, edgeTip, CLASS_KEY, EVIDENCE_KEY } from "./edge-key.js";
import { edgeStroke, EDGE_HOVER_PX, type CardNode } from "./node-art.js";
import { backdropTipAt } from "./canvas-surface.js";
import type { CanvasTokens } from "./canvas-tokens.js";
import type { GraphEdge } from "../../shared/api.js";

const tokens = { ok: "green", danger: "red", warn: "amber", muted: "grey" } as CanvasTokens;

afterEach(() => { closeAnchoredPanel(); document.body.replaceChildren(); });

const words = (rows: HTMLElement[]): string[] =>
  rows.flatMap((r) => [...r.querySelectorAll(".edgekey-word")].map((w) => w.textContent ?? ""));

describe("the key's rows", () => {
  it("names the four classes in the Links window's words, without evidence", () => {
    const rows = edgeKeyRows(tokens, false);
    expect(words(rows)).toEqual(["opens", "shuts", "changes what is true for", "shares state with"]);
    expect(rows.some((r) => r.classList.contains("edgekey-cap"))).toBe(false);
  });

  it("adds the three evidence states when the arrows wear them", () => {
    const rows = edgeKeyRows(tokens, true);
    expect(words(rows)).toEqual([
      "opens", "shuts", "changes what is true for", "shares state with",
      "seen in a coverage run", "possible, but never seen", "seen, but not predicted",
    ]);
  });

  it("draws every sample with the painter's stroke: ink, width, dash and opacity", () => {
    const rows = edgeKeyRows(tokens, true).filter((r) => r.classList.contains("edgekey-row"));
    const wanted = [
      ...CLASS_KEY.map((k) => edgeStroke(tokens, k.cls)),
      ...EVIDENCE_KEY.map((k) => edgeStroke(tokens, "enable", k.evidence)),
    ];
    expect(rows).toHaveLength(wanted.length);
    rows.forEach((row, i) => {
      const want = wanted[i]!;
      const svg = row.querySelector("svg")!;
      const line = svg.querySelector("line")!;
      const head = svg.querySelector("polygon")!;
      expect(svg.getAttribute("opacity")).toBe(String(want.opacity));
      expect(line.getAttribute("stroke")).toBe(want.ink);
      expect(line.getAttribute("stroke-width")).toBe(String(want.width));
      expect(line.getAttribute("stroke-dasharray")).toBe(want.dash ? want.dash.join(" ") : null);
      // Arrowheads always, as on the canvas.
      expect(head.getAttribute("fill")).toBe(want.ink);
    });
  });
});

describe("the Key control", () => {
  it("opens the key on a press, reading evidence as it opens, and shuts on a second", () => {
    let evidence = false;
    const button = edgeKeyButton({ className: "stripbtn", tokens: () => tokens, evidence: () => evidence });
    document.body.append(button);
    expect(button.textContent).toBe("Key");
    expect(document.querySelector(".edgekey")).toBeNull();

    evidence = true;
    button.click();
    const panel = document.querySelector(".edgekey")!;
    expect(panel).not.toBeNull();
    expect(panel.querySelectorAll(".edgekey-row")).toHaveLength(7);

    // The anchored panel's own toggle: the same control again closes it.
    button.click();
    expect(document.querySelector(".edgekey:not(.closing)")).toBeNull();
  });
});

describe("the arrow's tip", () => {
  const place = (id: string, x: number): CardNode => ({ id, title: id, deck: "d", x, y: 0, width: 100, height: 50 });
  const cards = new Map([place("a", 0), place("b", 300)].map((c) => [c.id, c]));
  const at = (id: string): CardNode | undefined => cards.get(id);
  const edges: GraphEdge[] = [{ from: "a", to: "b", cls: "enable", via: [{ property: "@story.done", outcome: "finish" }] }];
  const names: Record<string, string> = { a: "The Docks Brawl", b: "A Quiet Drink" };
  const tip = edgeTip<CardNode>(() => edges, (id) => names[id] ?? id, (lookup) => lookup);

  it("names the cards and the property joining them", () => {
    expect(tip({ x: 200, y: 25 }, 1, at)).toEqual({
      key: "edge:a>b:enable",
      text: "The Docks Brawl opens A Quiet Drink\n@story.done written by the outcome finish",
    });
  });

  it("has nothing to say away from every line", () => {
    expect(tip({ x: 200, y: 25 + EDGE_HOVER_PX * 3 }, 1, at)).toBeUndefined();
  });

  it("never talks over a card, or anything else drawn above the arrows", () => {
    const said = () => tip({ x: 200, y: 25 }, 1, at);
    expect(backdropTipAt(false, false, said)?.text).toContain("opens");
    // A card under the pointer wins, and the backdrop is not even asked.
    let asked = false;
    expect(backdropTipAt(true, false, () => { asked = true; return said(); })).toBeUndefined();
    // A handle or a comment marker over the line wins too.
    expect(backdropTipAt(false, true, () => { asked = true; return said(); })).toBeUndefined();
    expect(asked).toBe(false);
    // And an empty answer is no answer.
    expect(backdropTipAt(false, false, () => ({ key: "k", text: "" }))).toBeUndefined();
  });
});
