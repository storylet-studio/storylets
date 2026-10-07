// @vitest-environment jsdom
// The Board's play face for a card with no outcomes: one Done button that
// plays it with none (""), where a card with outcomes, even all of them gated
// shut, keeps its own buttons.

import { describe, expect, it, vi } from "vitest";
import { playChoices } from "./play-choices.js";

const labels = (row: HTMLElement): string[] => [...row.querySelectorAll("button")].map((b) => b.textContent ?? "");

describe("the Board's play choices", () => {
  it("gives a card with no outcomes one Done button, and pressing it plays at once", () => {
    const choose = vi.fn();
    const done = vi.fn();
    const row = playChoices([], choose, done);
    expect(labels(row)).toEqual(["Done"]);
    expect(row.textContent).not.toContain("no outcomes");
    row.querySelector("button")!.click();
    expect(done).toHaveBeenCalledTimes(1);
    expect(choose).not.toHaveBeenCalled();
  });

  it("gives a card with outcomes one button each, and no Done", () => {
    const choose = vi.fn();
    const done = vi.fn();
    const row = playChoices([{ gameId: "pay", title: "Pay them off", available: true }, { gameId: "fight", available: true }], choose, done);
    expect(labels(row)).toEqual(["Pay them off", "fight"]);
    row.querySelectorAll("button")[1]!.click();
    expect(choose).toHaveBeenCalledWith("fight");
    expect(done).not.toHaveBeenCalled();
  });

  it("keeps a card whose outcomes are all gated shut locked, not Done", () => {
    const choose = vi.fn();
    const done = vi.fn();
    const row = playChoices([{ gameId: "bribe", available: false }], choose, done);
    expect(labels(row)).toEqual(["bribe (locked)"]);
    row.querySelector("button")!.click();
    expect(choose).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it("explains a locked outcome in the themed rollover, never a native title", () => {
    const row = playChoices([{ gameId: "bribe", available: false }], vi.fn(), vi.fn());
    const b = row.querySelector("button")!;
    expect(b.title).toBe("");
    expect(b.dataset["tip"]).toMatch(/^Unavailable\./);
  });
});
