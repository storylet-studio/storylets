// The property examiner/editor: rows from listProperties, edits commit as
// host writes, reset-to-default disables itself at the default; Save/Load
// ride the .storyletsave string boundary; the filter narrows rows; the
// read-only turns and board sections mirror the engine examiners.
// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { describe, expect, it, vi } from "vitest";
import { Engine } from "@storylet-studio/runtime";
import { expandBundle } from "@storylet-studio/conformance";
import { createPropertyInspector, serializeState } from "../src/index.js";

const bundle = expandBundle({
  story: [
    { name: "gold", type: "number", default: 10 },
    { name: "mood", type: "enum", values: ["calm", "angry"], default: "calm" },
  ],
  world: [{ name: "open", type: "boolean", default: true }],
  cards: [{ id: "c_a", priority: 1, tags: { zone: ["docks"] },
    outcomes: [{ id: "o_go", changes: { "@story.gold": "3" } }] }],
  hands: [{ id: "h_seat", rule: { bindings: { zone: "docks" } }, slots: 1 }],
});

const mount = () => {
  const engine = new Engine(bundle, { seed: 0 });
  const session = engine.openFlow("main");
  const inspector = createPropertyInspector(engine, session, { pollMs: 0 });
  return { engine, session, inspector };
};

describe("createPropertyInspector", () => {
  it("renders a row per declared property, grouped by scope", () => {
    const { inspector } = mount();
    const names = [...inspector.el.querySelectorAll(".sl-name")].map((n) => n.textContent);
    expect(names).toContain("gold");
    expect(names).toContain("mood");
    expect(names).toContain("open");
    const groups = [...inspector.el.querySelectorAll(".sl-group")].map((g) => g.textContent);
    expect(groups).toContain("world");
    expect(groups).toContain("story");
    inspector.destroy();
  });

  it("an edit commits through setProperty; refresh reads engine writes back", () => {
    const { session, inspector } = mount();
    const goldRow = [...inspector.el.querySelectorAll(".sl-row")]
      .find((r) => r.querySelector(".sl-name")?.textContent === "gold")!;
    const input = goldRow.querySelector("input") as HTMLInputElement;
    input.value = "25";
    input.dispatchEvent(new Event("change"));
    expect(session.getProperty("story.gold")).toBe(25);

    session.setProperty("story.gold", 3);
    inspector.refresh();
    expect(input.value).toBe("3");
    inspector.destroy();
  });

  it("reset returns a row to its default and disables itself there", () => {
    const { session, inspector } = mount();
    const goldRow = [...inspector.el.querySelectorAll(".sl-row")]
      .find((r) => r.querySelector(".sl-name")?.textContent === "gold")!;
    const reset = goldRow.querySelector(".sl-reset") as HTMLButtonElement;
    expect(reset.disabled).toBe(true);   // at default

    session.setProperty("story.gold", 99);
    inspector.refresh();
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(session.getProperty("story.gold")).toBe(10);
    expect(reset.disabled).toBe(true);
    inspector.destroy();
  });

  it("destroy removes the panel", () => {
    const { inspector } = mount();
    expect(document.body.contains(inspector.el)).toBe(true);
    inspector.destroy();
    expect(document.body.contains(inspector.el)).toBe(false);
  });

  it("has Save state / Load state controls in the header", () => {
    const { inspector } = mount();
    const save = inspector.el.querySelector(".sl-head .sl-save") as HTMLButtonElement;
    const load = inspector.el.querySelector(".sl-head .sl-load") as HTMLButtonElement;
    expect(save?.textContent).toBe("Save state");
    expect(load?.textContent).toBe("Load state");
    inspector.destroy();
  });

  it("load routes a picked .storyletsave through loadState", async () => {
    // A donor engine produces the save; the inspected engine starts fresh.
    const donorEngine = new Engine(bundle, { seed: 0 });
    donorEngine.openFlow("main").setProperty("story.gold", 77);
    const blob = serializeState(donorEngine);

    const { engine, session, inspector } = mount();
    expect(session.getProperty("story.gold")).toBe(10);
    const picker = inspector.el.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, "files", {
      configurable: true,
      value: [new File([blob], "save.storyletsave")],
    });
    picker.dispatchEvent(new Event("change"));
    // loadGame rebuilds every flow: the OLD handle is inert (by contract),
    // so the assertion re-takes the flow by name, as the inspector does.
    await vi.waitFor(() => expect(engine.getFlow("main")!.getProperty("story.gold")).toBe(77));
    inspector.destroy();
  });

  it("a foreign blob is refused by loadState semantics, never applied", async () => {
    const { session, inspector } = mount();
    session.setProperty("story.gold", 5);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const picker = inspector.el.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, "files", {
      configurable: true,
      value: [new File(['{"schema":"someone-elses"}'], "save.storyletsave")],
    });
    picker.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(errors).toHaveBeenCalled());
    expect(session.getProperty("story.gold")).toBe(5);   // untouched
    errors.mockRestore();
    inspector.destroy();
  });

  it("shows per-box turns, refreshed from listBoxes", () => {
    const { session, inspector } = mount();
    const turns = () => [...inspector.el.querySelectorAll(".sl-turns .sl-line")]
      .map((l) => l.textContent);
    expect(turns()).toContain("box: turn 0");
    session.advanceTurns("box", 2);
    inspector.refresh();
    expect(turns()).toContain("box: turn 2");
    inspector.destroy();
  });

  it("shows the board's hands with dealt card titles-or-gameIds", () => {
    const { session, inspector } = mount();
    const board = () => [...inspector.el.querySelectorAll(".sl-board .sl-line")]
      .map((l) => l.textContent);
    expect(board()).toContain("seat: (empty)");
    session.deal("seat");
    inspector.refresh();
    expect(board()).toContain("seat: a");
    inspector.destroy();
  });

  it("shows the retained log behind per-kind filters, with Autoscroll / Copy / Clear", () => {
    const engine = new Engine(bundle, { seed: 0, log: true });
    const session = engine.openFlow("main");
    const inspector = createPropertyInspector(engine, session, { pollMs: 0 });
    const logText = () => inspector.el.querySelector(".sl-log")?.textContent ?? "";

    session.deal("seat");
    session.play("c_a", "go", "seat");
    inspector.refresh();
    expect(logText()).toContain("deal seat:");
    expect(logText()).toContain("write story.gold: 10 -> 3");
    expect(logText()).toContain("play c_a -> go");

    // Untick the Write kind: write lines disappear, deal lines stay.
    const writeToggle = [...inspector.el.querySelectorAll(".sl-logkind")]
      .find((l) => l.textContent === "Write")!.querySelector("input") as HTMLInputElement;
    writeToggle.checked = false;
    writeToggle.dispatchEvent(new Event("change"));
    expect(logText()).not.toContain("write story.gold");
    expect(logText()).toContain("deal seat:");

    // The toolbar carries Autoscroll, Copy and Clear (the parity surface).
    expect(inspector.el.querySelector(".sl-logscroll")?.textContent).toBe("Autoscroll");
    expect(inspector.el.querySelector(".sl-logcopy")).toBeTruthy();
    (inspector.el.querySelector(".sl-logbar.sl-flow .sl-logclear") as HTMLButtonElement).click();
    expect(session.log()).toHaveLength(0);
    expect(logText()).toContain("(empty");
    inspector.destroy();
  });

  it("hints when the engine retains no log", () => {
    const { inspector } = mount();   // created without the log option
    expect(inspector.el.querySelector(".sl-log")?.textContent).toContain("new Engine(bundle, { log: true })");
    inspector.destroy();
  });

  it("the filter narrows rows by name/path, and a group hides with its rows", () => {
    const { inspector } = mount();
    const filter = inspector.el.querySelector(".sl-filter") as HTMLInputElement;
    filter.value = "gold";
    filter.dispatchEvent(new Event("input"));
    const visible = [...inspector.el.querySelectorAll(".sl-row")]
      .filter((r) => (r as HTMLElement).style.display !== "none")
      .map((r) => r.querySelector(".sl-name")?.textContent);
    expect(visible).toEqual(["gold"]);
    const worldGroup = [...inspector.el.querySelectorAll(".sl-group")]
      .find((g) => g.textContent === "world") as HTMLElement;
    expect(worldGroup.style.display).toBe("none");

    filter.value = "";
    filter.dispatchEvent(new Event("input"));
    expect(worldGroup.style.display).toBe("");
    inspector.destroy();
  });
});

describe("the run log panel", () => {
  it("shows what the flow's own log cannot: another flow's action", () => {
    const engine = new Engine(bundle, { seed: 0, log: true });
    const flow = engine.openFlow("main");
    const other = engine.openFlow("other");
    const inspector = createPropertyInspector(engine, flow, { pollMs: 0 });
    other.dealMany();
    inspector.refresh();

    const runBody = inspector.el.querySelector(".sl-log.sl-run")!;
    const flowBody = inspector.el.querySelector(".sl-log.sl-flow")!;
    // The run log names the flow that acted; the flow's own says nothing about
    // it, which is the whole reason both panels exist.
    expect(runBody.textContent).toContain("other ");
    expect(flowBody.textContent).not.toContain("other ");
    inspector.destroy();
  });

  it("clears independently of the flow's own log", () => {
    const engine = new Engine(bundle, { seed: 0, log: true });
    const flow = engine.openFlow("main");
    const inspector = createPropertyInspector(engine, flow, { pollMs: 0 });
    flow.dealMany();
    inspector.refresh();
    expect(engine.log().length).toBeGreaterThan(0);
    expect(flow.log().length).toBeGreaterThan(0);

    (inspector.el.querySelector(".sl-logbar.sl-run .sl-logclear") as HTMLButtonElement).click();
    expect(engine.log()).toHaveLength(0);
    expect(flow.log().length).toBeGreaterThan(0);
    inspector.destroy();
  });
});
