// @vitest-environment jsdom
// The Review Feedback bar (design/annotation.md, the walk). Its states are what
// a reviewer reads to know where they are, so they are pinned here rather than
// left to an interactive pass: the count, the trail, the marking of a resolved
// thread pulled in by Show Resolved, and the empty case.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderReviewBar } from "./views.js";
import type { ReviewItemDto } from "../../shared/api.js";

const item = (over: Partial<ReviewItemDto> = {}): ReviewItemDto => ({
  thread: "cmt_1", anchor: "c_gate",
  at: { kind: "card", box: "b_1", deck: "k_1", card: "c_gate" },
  where: "Village · Arrival · Arrive at the Gate",
  author: "Ada", text: "Lands too early.",
  ...over,
});

let host: HTMLElement;
beforeEach(() => { host = document.createElement("div"); });

const text = (): string => host.innerText || host.textContent || "";

describe("the review bar", () => {
  it("is hidden when the walk is off", () => {
    renderReviewBar(host, [item()], 0, false, vi.fn(), vi.fn(), vi.fn());
    expect(host.hidden).toBe(true);
    expect(host.childElementCount).toBe(0);
  });

  it("shows itself even with nothing to walk", () => {
    // Entering the mode and seeing nothing at all reads as a broken command.
    renderReviewBar(host, [], 0, true, vi.fn(), vi.fn(), vi.fn());
    expect(host.hidden).toBe(false);
    expect(text()).toContain("No open comments.");
  });

  it("shows the count, the trail and who said what", () => {
    renderReviewBar(host, [item(), item({ thread: "cmt_2" })], 0, true, vi.fn(), vi.fn(), vi.fn());
    expect(host.querySelector(".stepbar-count")?.textContent).toBe("2");
    expect(host.querySelector(".stepbar-of")?.textContent).toBe("1/2");
    expect(text()).toContain("Village · Arrival · Arrive at the Gate");
    expect(text()).toContain("Ada: Lands too early.");
  });

  it("hides the steppers when there is only one", () => {
    renderReviewBar(host, [item()], 0, true, vi.fn(), vi.fn(), vi.fn());
    expect(host.querySelector(".stepbar-of")).toBeNull();
  });

  it("loops both ways", () => {
    const onStep = vi.fn();
    const two = [item(), item({ thread: "cmt_2" })];
    renderReviewBar(host, two, 0, true, onStep, vi.fn(), vi.fn());
    const [prev, next] = [...host.querySelectorAll<HTMLButtonElement>(".stepbar-nav")];
    prev!.click();
    expect(onStep).toHaveBeenCalledWith(1);   // wrapped back round from the first
    next!.click();
    expect(onStep).toHaveBeenLastCalledWith(1);
  });

  it("marks a resolved thread rather than hiding it", () => {
    // It is only in the walk because Show Resolved asked for it, so it says so.
    renderReviewBar(host, [item({ resolved: true })], 0, true, vi.fn(), vi.fn(), vi.fn());
    const cat = host.querySelector(".stepbar-cat");
    expect(cat?.textContent).toBe("resolved");
    expect(cat?.classList.contains("done")).toBe(true);
  });

  it("says when a thread is a marker on a canvas", () => {
    renderReviewBar(host, [item({ canvas: "k_1" })], 0, true, vi.fn(), vi.fn(), vi.fn());
    expect(host.querySelector(".stepbar-cat")?.textContent).toBe("marker");
  });

  it("the message is the way there, and the close button leaves", () => {
    const onGo = vi.fn(); const onClose = vi.fn();
    const only = item();
    renderReviewBar(host, [only], 0, true, vi.fn(), onGo, onClose);
    host.querySelector<HTMLButtonElement>(".stepbar-cur")!.click();
    expect(onGo).toHaveBeenCalledWith(only);
    host.querySelector<HTMLButtonElement>(".stepbar-close")!.click();
    expect(onClose).toHaveBeenCalled();
  });

  it("clamps an index left behind by a shorter list", () => {
    // Resolving the last item while standing on it: the walk re-gathers and the
    // index is now past the end.
    renderReviewBar(host, [item()], 5, true, vi.fn(), vi.fn(), vi.fn());
    expect(text()).toContain("Lands too early.");
  });
});
