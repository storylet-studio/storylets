// The bundle inspector's DOM rendering (design 2, piece 6): read-only over a
// compiled bundle, no session anywhere. Identity, then hands (deal), tags by
// box (peek criteria), declared properties, counts.
// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { describe, expect, it } from "vitest";
import { expandBundle } from "@storylet-studio/conformance";
import { createBundleInspector, formatPropertySummary, formatScopeLabel } from "../src/index.js";

const bundle = expandBundle({
  world: [{ name: "season", type: "string", default: "spring" }],
  story: [{ name: "gold", type: "number", default: 10 }],
  cards: [{ id: "c_a", priority: 1, tags: { zone: ["docks"] }, outcomes: [{ id: "o_go" }] }],
  templates: [{ id: "t_berth", chooses: ["zone"], slots: 2 }],
  hands: [
    { id: "h_seat", rule: { bindings: { zone: "docks" } }, slots: 1 },
    { id: "h_berth", template: "t_berth", chosen: { zone: "market" } },
  ],
});

const text = (el: HTMLElement, selector: string): string[] =>
  [...el.querySelectorAll(selector)].map((n) => n.textContent ?? "");

describe("createBundleInspector", () => {
  it("shows the bundle identity without a session", () => {
    const insp = createBundleInspector(bundle);
    const lines = text(insp.el, ".sl-ident .sl-line");
    expect(lines[0]).toBe("conf 0.0.0");
    expect(lines.join("\n")).toContain("storylets/bundle@0");
    insp.destroy();
  });

  it("renders the deal() surface: hand, box, slots, template", () => {
    const insp = createBundleInspector(bundle);
    const lines = text(insp.el, ".sl-hands .sl-line");
    expect(lines).toEqual([
      "berth: box box, slots 2, template berth",
      "seat: box box, slots 1",
    ]);
    insp.destroy();
  });

  it("says on the hand's own line when a hole moves with a property", () => {
    const moving = expandBundle({
      templates: [{ id: "t_npc", chooses: ["zone"],
        properties: [{ name: "zone", type: "enum", values: ["docks", "market"], default: "docks" }] }],
      hands: [{ id: "h_elder", template: "t_npc", chosen: { zone: "@hand.zone" } }],
    });
    const insp = createBundleInspector(moving);
    expect(text(insp.el, ".sl-hands .sl-line")).toEqual([
      "elder: box box, slots unbounded, template npc, moves zone from @hand.zone",
    ]);
    insp.destroy();
  });

  it("renders the peek() criteria surface, grouped by box", () => {
    const insp = createBundleInspector(bundle);
    expect(text(insp.el, ".sl-tags .sl-group")).toEqual(["box"]);
    expect(text(insp.el, ".sl-tags .sl-line")).toEqual(["  zone: docks, market"]);
    insp.destroy();
  });

  it("renders the declared property scopes with types and defaults", () => {
    const insp = createBundleInspector(bundle);
    expect(text(insp.el, ".sl-props .sl-group")).toEqual(["world", "story", "tag docks (zone)"]);
    expect(text(insp.el, ".sl-props .sl-line")).toEqual([
      "  season: string = \"spring\"",
      "  gold: number = 10",
      "  danger: number = 0",
    ]);
    insp.destroy();
  });

  it("renders counts for orientation and no card list", () => {
    const insp = createBundleInspector(bundle);
    const lines = text(insp.el, ".sl-counts .sl-line").join("\n");
    expect(lines).toContain("boxes 1 - decks 1 - cards 1");
    expect(lines).toContain("ranking.specificity true");
    expect(insp.el.textContent).not.toContain("c_a");
    insp.destroy();
  });

  it("a timed box says its unit on its counts line; an untimed one adds nothing", () => {
    const insp = createBundleInspector(bundle);
    expect(text(insp.el, ".sl-counts .sl-line").join("\n")).not.toContain("turn =");
    insp.destroy();
    const timed = createBundleInspector(expandBundle({ turn: { seconds: 60 }, cards: [{ id: "c_a" }] }));
    expect(text(timed.el, ".sl-counts .sl-line").join("\n")).toContain("turn = 60s");
    timed.destroy();
  });

  it("counts a box's durable cards on its counts line, and nothing when it has none", () => {
    const insp = createBundleInspector(bundle);
    expect(text(insp.el, ".sl-counts .sl-line").join("\n")).not.toContain("durable cards");
    insp.destroy();
    const withDurable = expandBundle({ cards: [{ id: "c_a", redraw: "never" }] });
    withDurable.boxes[0]!.decks[0]!.durable = true;
    const durable = createBundleInspector(withDurable);
    expect(text(durable.el, ".sl-counts .sl-line").join("\n")).toContain("durable cards 1");
    durable.destroy();
  });

  it("collapsible sections, open by default and closeable", () => {
    const insp = createBundleInspector(bundle, { open: false });
    const folds = [...insp.el.querySelectorAll("details.sl-fold")];
    expect(folds).toHaveLength(4);
    expect(folds.every((f) => !(f as HTMLDetailsElement).open)).toBe(true);
    insp.destroy();
  });

  it("mounts into a given container and destroy removes it", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const insp = createBundleInspector(bundle, { container });
    expect(container.querySelector(".sl-insp")).not.toBeNull();
    insp.destroy();
    expect(container.querySelector(".sl-insp")).toBeNull();
    container.remove();
  });

  it("exposes the description it rendered (describeBundle is the API)", () => {
    const insp = createBundleInspector(bundle);
    expect(insp.description.hands.map((h) => h.gameId)).toEqual(["berth", "seat"]);
    insp.destroy();
  });
});

describe("a shipped map", () => {
  const withMap = {
    ...bundle,
    maps: [{
      box: "box", group: "zone",
      zones: [{ tag: "docks", polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }],
      backgrounds: [{ file: "assets/box/plan.png", x: 0, y: 0, width: 4, height: 4 }],
      sites: [{ hand: "well", x: 1, y: 2 }, { hand: "forge", x: 3, y: 4 }],
    }],
  };

  it("gets a section of its own, saying the engine ignores it", () => {
    const insp = createBundleInspector(withMap);
    const lines = text(insp.el, ".sl-maps .sl-line").join("\n");
    expect(lines).toContain("The engine ignores it");
    expect(lines).toContain("box - zone: zones 1, pictures 1, sites 2");
    insp.destroy();
  });

  it("shows no section at all on an ordinary bundle", () => {
    const insp = createBundleInspector(bundle);
    expect(insp.el.querySelector(".sl-maps")).toBeNull();
    expect(insp.el.textContent).not.toContain("Maps");
    insp.destroy();
  });
});

describe("the row formatters", () => {
  it("formats a declaration as name: type = default, options listed", () => {
    expect(formatPropertySummary({ name: "mood", type: "enum", default: "calm", values: ["calm", "angry"] }))
      .toBe("mood: enum = \"calm\" [calm, angry]");
  });

  it("says durable on the declarations that outlive a run, and nothing on the rest", () => {
    // design/engine-server.md 4.2: what a server has to lift and put back.
    expect(formatPropertySummary({ name: "visits", type: "number", default: 0, durable: true }))
      .toBe("visits: number = 0 (durable)");
    expect(formatPropertySummary({ name: "gold", type: "number", default: 0 }))
      .toBe("gold: number = 0");
  });

  it("labels scopes by kind, owner and (for tags) group", () => {
    expect(formatScopeLabel({ scope: "world", owner: "", properties: [] })).toBe("world");
    expect(formatScopeLabel({ scope: "tag", owner: "docks", group: "zone", properties: [] }))
      .toBe("tag docks (zone)");
  });
});
