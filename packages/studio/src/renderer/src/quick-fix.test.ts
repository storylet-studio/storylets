// @vitest-environment jsdom
// The problems bar's fix slot (storyletter.md section 4). The LABELS are pinned
// because they are the whole interface: writer-speak, no engine jargon, and an
// ellipsis only where something is going to ask before it acts.
import { describe, expect, it, vi } from "vitest";
import { fixLabel, renderProblems } from "./views.js";
import type { Problem } from "../../shared/api.js";

const problem = (over: Partial<Problem> = {}): Problem => ({
  severity: "error", path: "village/decks/arrival.storyletdeck",
  where: "arrive-at-the-gate", message: "change target \"@story.mood\" is not a declared property",
  ...over,
});

const declare: NonNullable<Problem["fix"]> = { kind: "declare-property", scope: "story", name: "mood", owner: "" };
const repoint: NonNullable<Problem["fix"]> = {
  kind: "repoint-tag", holder: "h_inn", group: "g_area", bad: "t_gone",
  options: [{ id: "t_village", label: "village" }, { id: "t_forest", label: "forest" }],
};

describe("the quick-fix label", () => {
  it("names the property in the author's terms", () => {
    expect(fixLabel(declare)).toBe("Set up “@story.mood”");
  });

  it("promises a question with an ellipsis where one is coming", () => {
    // The tag repair cannot know which tag was meant, so it must ask; the
    // declaration just happens, so it must not look like it will ask.
    expect(fixLabel(repoint)).toBe("Choose a tag…");
    expect(fixLabel(declare).endsWith("…")).toBe(false);
  });
});

describe("the problems bar's fix slot", () => {
  const render = (p: Problem, onFix = vi.fn()): { host: HTMLElement; onFix: typeof onFix } => {
    const host = document.createElement("div");
    renderProblems(host, [p], 0, vi.fn(), vi.fn(), onFix);
    return { host, onFix };
  };

  it("is absent when the problem has no canonical repair", () => {
    const { host } = render(problem());
    expect(host.querySelector(".problembar-fix")).toBeNull();
  });

  it("appears, labelled, when one is offered", () => {
    const { host } = render(problem({ fix: declare }));
    expect(host.querySelector(".problembar-fix")?.textContent).toBe("Set up “@story.mood”");
  });

  it("hands back the problem, its fix and the button to anchor a picker on", () => {
    const { host, onFix } = render(problem({ fix: repoint }));
    const button = host.querySelector<HTMLButtonElement>(".problembar-fix")!;
    button.click();
    expect(onFix).toHaveBeenCalledWith(expect.objectContaining({ fix: repoint }), repoint, button);
  });

  it("does not swallow the jump: the message is still the way there", () => {
    const onJump = vi.fn();
    const host = document.createElement("div");
    const p = problem({ fix: declare });
    renderProblems(host, [p], 0, vi.fn(), onJump, vi.fn());
    host.querySelector<HTMLButtonElement>(".stepbar-cur")!.click();
    expect(onJump).toHaveBeenCalledWith(p);
  });
});
