// How a hand is bound to a tag group. The distinction this file exists for: a
// hole and a standalone rule belong to the HAND, a template binding belongs to
// the TEMPLATE, and only the first two may be changed by editing one hand.

import { describe, expect, it } from "vitest";
import { bindHand, handBinding, unbindHand } from "../src/hands.js";
import type { Hand, HandTemplate } from "../src/index.js";

const template = (over: Partial<HandTemplate<string>> = {}): HandTemplate<string> =>
  ({ id: "t_1", gameId: "street", slots: 3, properties: [], ...over });

const instance = (over: Partial<Hand<string>> = {}): Hand<string> =>
  ({ id: "h_1", gameId: "docks-street", template: "t_1", ...over });

describe("reading a binding", () => {
  it("reads a filled hole as the hand's own", () => {
    const t = template({ chooses: ["g_zone"] });
    expect(handBinding(instance({ chosen: { g_zone: "v_docks" } }), t, "g_zone"))
      .toEqual({ kind: "chosen", tag: "v_docks", editable: true });
  });

  it("reads an unfilled hole as editable with nothing in it", () => {
    const t = template({ chooses: ["g_zone"] });
    expect(handBinding(instance(), t, "g_zone")).toEqual({ kind: "chosen", editable: true });
  });

  it("reads a standalone hand's own binding as editable", () => {
    const hand = instance({ template: undefined, rule: { slots: 2, bindings: { g_zone: "v_market" } } });
    expect(handBinding(hand, undefined, "g_zone")).toEqual({ kind: "rule", tag: "v_market", editable: true });
  });

  it("reads a template's fixed binding as NOT this hand's to change", () => {
    // Every instance of the template shares it, so one hand cannot move alone.
    const t = template({ bindings: { g_zone: "v_docks" } });
    expect(handBinding(instance(), t, "g_zone")).toEqual({ kind: "fixed", tag: "v_docks", editable: false });
  });

  it("prefers the hole when a template both binds a group and declares it", () => {
    // Malformed, but the hole is the one an instance can actually fill.
    const t = template({ chooses: ["g_zone"], bindings: { g_zone: "v_docks" } });
    expect(handBinding(instance({ chosen: { g_zone: "v_market" } }), t, "g_zone").kind).toBe("chosen");
  });

  it("says nothing at all for a group the hand has no route to", () => {
    expect(handBinding(instance(), template(), "g_zone")).toEqual({ kind: "none", editable: false });
    expect(handBinding(instance(), template({ chooses: ["g_mood"] }), "g_zone").kind).toBe("none");
  });
});

describe("rebinding", () => {
  it("fills a hole, and reports the change", () => {
    const t = template({ chooses: ["g_zone"] });
    const hand = instance({ chosen: { g_zone: "v_docks" } });
    expect(bindHand(hand, t, "g_zone", "v_market")).toBe(true);
    expect(hand.chosen).toEqual({ g_zone: "v_market" });
  });

  it("keeps the hand's other holes", () => {
    const t = template({ chooses: ["g_zone", "g_mood"] });
    const hand = instance({ chosen: { g_zone: "v_docks", g_mood: "v_tense" } });
    bindHand(hand, t, "g_zone", "v_market");
    expect(hand.chosen).toEqual({ g_zone: "v_market", g_mood: "v_tense" });
  });

  it("binds a standalone hand through its rule, keeping the rest of the rule", () => {
    const hand = instance({ template: undefined, rule: { slots: 2, condition: "@hand.open", bindings: { g_zone: "v_docks" } } });
    expect(bindHand(hand, undefined, "g_zone", "v_market")).toBe(true);
    expect(hand.rule).toEqual({ slots: 2, condition: "@hand.open", bindings: { g_zone: "v_market" } });
  });

  it("refuses to move one instance off a binding its TEMPLATE owns", () => {
    const t = template({ bindings: { g_zone: "v_docks" } });
    const hand = instance();
    expect(bindHand(hand, t, "g_zone", "v_market")).toBe(false);
    expect(hand.chosen).toBeUndefined();
  });

  it("refuses a group the hand has no route to, rather than inventing one", () => {
    const hand = instance();
    expect(bindHand(hand, template(), "g_zone", "v_market")).toBe(false);
    expect(hand.chosen).toBeUndefined();
  });

  it("reports no change when the hand is already bound there", () => {
    const t = template({ chooses: ["g_zone"] });
    expect(bindHand(instance({ chosen: { g_zone: "v_docks" } }), t, "g_zone", "v_docks")).toBe(false);
  });
});

describe("coming loose", () => {
  it("empties a hole, which is the error the compiler already names", () => {
    const t = template({ chooses: ["g_zone"] });
    const hand = instance({ chosen: { g_zone: "v_docks" } });
    expect(unbindHand(hand, t, "g_zone")).toBe(true);
    expect(hand.chosen).toBeUndefined();
  });

  it("keeps the hand's other holes filled", () => {
    const t = template({ chooses: ["g_zone", "g_mood"] });
    const hand = instance({ chosen: { g_zone: "v_docks", g_mood: "v_tense" } });
    unbindHand(hand, t, "g_zone");
    expect(hand.chosen).toEqual({ g_mood: "v_tense" });
  });

  it("empties a standalone hand's binding without losing the rest of its rule", () => {
    const hand = instance({ template: undefined, rule: { slots: 2, condition: "@hand.open", bindings: { g_zone: "v_docks" } } });
    expect(unbindHand(hand, undefined, "g_zone")).toBe(true);
    expect(hand.rule).toEqual({ slots: 2, condition: "@hand.open" });
  });

  it("will not strip a binding the TEMPLATE owns", () => {
    const t = template({ bindings: { g_zone: "v_docks" } });
    expect(unbindHand(instance(), t, "g_zone")).toBe(false);
  });

  it("reports no change when there was nothing to clear", () => {
    const t = template({ chooses: ["g_zone"] });
    expect(unbindHand(instance(), t, "g_zone")).toBe(false);
  });
});
