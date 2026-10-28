// @vitest-environment jsdom
// The clash resolver's window half (step 6, ruling Q21): the banner follows the
// count on every result, the shell's dialog lists main's clashes, a decision's
// fresh project is taken as any write's is, a refusal leaves the clash there,
// and Edit goes where main said the clash is.

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClashes } from "./clashes.js";
import type { ClashDto, ClashGoto, ClashesAnswer, OpenResult } from "../../shared/api.js";

beforeAll(() => {
  // jsdom has the element but not the modal half of <dialog>.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => { document.body.innerHTML = ""; });

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const CLASH: ClashDto = {
  id: "box/decks/opening.storyletdeck#cards[c_1].priority",
  where: "Card 'Tavern Brawl' in Opening deck: priority",
  path: "box/decks/opening.storyletdeck: cards[c_1].priority",
  kind: "both-changed", ours: "2", theirs: "3", settable: true,
  goto: { kind: "card", box: "b_1", deck: "k_1", card: "c_1" },
};
const result = (clashes: number): OpenResult => ({ project: {} as OpenResult["project"], problems: [], ...(clashes > 0 ? { clashes } : {}) });

function harness(answer: ClashesAnswer) {
  const applied: OpenResult[] = [];
  const went: ClashGoto[] = [];
  const asked: string[] = [];
  const clashes = createClashes({
    studio: {
      listClashes: async () => [CLASH],
      resolveClash: async (id, side) => { asked.push(`${side}:${id}`); return answer; },
      markClashResolved: async (id) => { asked.push(`resolved:${id}`); return answer; },
    },
    open: () => true,
    flushSaves: async () => {},
    applied: (r) => { if ("error" in r) return false; applied.push(r); return true; },
    refreshProject: async () => {},
    goTo: (at) => { went.push(at); },
  });
  document.body.append(clashes.banner);
  return { clashes, applied, went, asked };
}

const button = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement;

describe("the clash banner", () => {
  it("shows the count each result carries, and hides at none", () => {
    const { clashes } = harness({ error: "unused" });
    clashes.take(result(3));
    expect(clashes.banner.hidden).toBe(false);
    expect(clashes.banner.textContent).toContain("3 unresolved clashes");
    clashes.take(result(0));
    expect(clashes.banner.hidden).toBe(true);
  });
});

describe("the resolver", () => {
  it("lists main's clashes, and Take theirs takes the fresh project and the clashes left", async () => {
    const fresh = result(0);
    const { clashes, applied, asked } = harness({ result: fresh, clashes: [] });
    clashes.take(result(1));
    clashes.open();
    await settle();
    expect(document.body.textContent).toContain("Card 'Tavern Brawl' in Opening deck: priority");
    button("Take theirs").click();
    await settle(); await settle();
    expect(asked).toEqual([`theirs:${CLASH.id}`]);
    expect(applied).toEqual([fresh]);
    expect(document.body.textContent).toContain("No clashes left.");
    expect(clashes.banner.hidden).toBe(true);   // fed from the resolver's onChange
  });

  it("a refusal leaves the clash there", async () => {
    const { clashes, applied } = harness({ error: "couldn't save: locked by bo" });
    clashes.open();
    await settle();
    button("Keep mine").click();
    await settle(); await settle();
    expect(applied).toEqual([]);
    expect(document.body.textContent).toContain("Card 'Tavern Brawl' in Opening deck: priority");
  });

  it("Edit closes the dialog and goes where the clash is", async () => {
    const { clashes, went } = harness({ error: "unused" });
    clashes.open();
    await settle();
    button("Edit").click();
    await settle();
    expect(went).toEqual([CLASH.goto]);
  });
});
