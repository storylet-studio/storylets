// @vitest-environment jsdom
// The Coverage window as a window (coverage.ts), against a stand-in main: it
// never sweeps on its own (ruling P, as Patterpad's), Run and the quick fix are
// disabled while a sweep runs, a blank or zero setting is refused, a sweep that
// finishes after a project change is dropped, and a cached report says when it
// ran and that the project has moved on since.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverageInfo, CoverageReport } from "../../shared/api.js";

const report = (runs = 200): CoverageReport => ({
  runs, seed: 0, maxTurns: 100, drivers: [], turns: 0, plays: 0,
  terminations: { exhausted: 0, maxTurns: runs, stuck: 0 },
  cards: [], totals: { cards: 0, dealt: 0, neverDealt: 0, rare: 0, dealtNeverPlayed: 0 }, rareThresholdPct: 5,
  outcomes: [], hands: [], unwrittenInputs: [], unprovidedHandRefs: [], diagnostics: [], issues: [],
});

let info: CoverageInfo = { hasProject: true, name: "The Village", driverCount: 0, pinned: true };
let hash = "h1";
let finish: ((r: { report: CoverageReport; name: string; ran: { at: string; hash: string | null } }) => void) | undefined;
let projectChanged: (() => void) | undefined;
const studio = {
  getState: vi.fn(async () => ({ theme: "system", coverageOrder: "least" })),
  onTheme: vi.fn(), onWindowPinned: vi.fn(), onJobProgress: vi.fn(),
  onProjectChanged: (h: () => void) => { projectChanged = h; },
  coverageInfo: vi.fn(async () => info),
  projectHash: vi.fn(async () => hash),
  coverageRun: vi.fn(() => new Promise((resolve) => { finish = resolve; })),
  coverageAddDrivers: vi.fn(), coverageCancel: vi.fn(),
  setCoveragePinned: vi.fn(), setCoverageOrder: vi.fn(), closeCoverage: vi.fn(),
  openProjectSettings: vi.fn(), openSearch: vi.fn(), searchReveal: vi.fn(),
};

const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const runButtons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(".crun")];
const field = (label: string): HTMLInputElement => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const type = (input: HTMLInputElement, value: string): void => { input.value = value; input.dispatchEvent(new Event("input")); };

beforeAll(async () => {
  document.body.innerHTML = `<div id="coverage"></div>`;
  (window as unknown as { studio: typeof studio }).studio = studio;
  await import("./coverage.js");
  await settle();
});

beforeEach(async () => {
  info = { hasProject: true, name: "The Village", driverCount: 0, pinned: true };
  hash = "h1";
  projectChanged!();   // a clean window over the project, nothing cached
  await settle();
  studio.coverageRun.mockClear();
});

describe("the Coverage window", () => {
  it("opens without running, on a sentence and a Run button", () => {
    expect(studio.coverageRun).not.toHaveBeenCalled();
    expect(document.querySelector(".cbody .empty")?.textContent).toBe("Run coverage to see how often each card comes up.");
    expect(runButtons()).toHaveLength(2);   // the bar's and the empty state's
  });

  it("disables Run while a sweep runs, so a second click starts nothing", async () => {
    runButtons()[0]!.click();
    await settle();
    expect(studio.coverageRun).toHaveBeenCalledTimes(1);
    expect(runButtons().every((b) => b.disabled)).toBe(true);
    runButtons()[0]!.click();
    await settle();
    expect(studio.coverageRun).toHaveBeenCalledTimes(1);
    finish!({ report: report(), name: "The Village", ran: { at: new Date().toISOString(), hash } });
    await settle();
    expect(runButtons()[0]!.disabled).toBe(false);
    expect(document.querySelector(".cran")?.textContent).toBe("Ran just now.");
  });

  it("dates a cached report from main, so it survives the window closing, and says when the project moved on", async () => {
    info = { ...info, last: report(), ran: { at: new Date(Date.now() - 5 * 60_000).toISOString(), hash: "h0" } };
    hash = "h1";   // the project has moved on since that run
    projectChanged!();
    await settle();
    expect(document.querySelector(".cran")?.textContent).toBe("Ran 5 minutes ago. The project has changed since.");
  });

  it("refuses a blank or zero runs field, and holds Run back until it is fixed", async () => {
    type(field("Runs"), "");
    expect(field("Runs").classList.contains("invalid")).toBe(true);
    expect(runButtons()[0]!.disabled).toBe(true);
    type(field("Runs"), "0");
    expect(runButtons()[0]!.disabled).toBe(true);
    type(field("Max turns"), "0");
    type(field("Runs"), "50");
    expect(runButtons()[0]!.disabled).toBe(true);   // max turns still refused
    type(field("Max turns"), "20");
    expect(runButtons()[0]!.disabled).toBe(false);
    runButtons()[0]!.click();
    await settle();
    expect(studio.coverageRun).toHaveBeenCalledWith({ runs: 50, maxTurns: 20, seed: 0 });
    finish!({ report: report(50), name: "The Village", ran: { at: new Date().toISOString(), hash } });
    await settle();
  });

  it("drops a sweep that finishes after the project changed", async () => {
    runButtons()[0]!.click();
    await settle();
    projectChanged!();
    await settle();
    finish!({ report: report(), name: "The Village", ran: { at: new Date().toISOString(), hash } });
    await settle();
    expect(document.querySelector(".csum")).toBeNull();
    expect(document.querySelector(".cbody .empty")?.textContent).toBe("Run coverage to see how often each card comes up.");
  });

  it("marks the report once the project has moved on, when the window comes forward", async () => {
    runButtons()[0]!.click();
    await settle();
    finish!({ report: report(), name: "The Village", ran: { at: new Date().toISOString(), hash } });
    await settle();
    hash = "h2";
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(document.querySelector(".cran")?.textContent).toBe("Ran just now. The project has changed since.");
  });

  it("refreshes the driver note when the window comes forward", async () => {
    info = { ...info, driverCount: 2 };
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(document.querySelector(".cnote .hint")?.textContent).toBe("2 coverage drivers feeding @world.");
  });

  it("says what to do with no project open", async () => {
    info = { hasProject: false, name: "", driverCount: 0, pinned: true };
    projectChanged!();
    await settle();
    expect(document.querySelector(".cbody .empty")?.textContent).toBe("Open a project to run coverage.");
    expect(runButtons().every((b) => b.disabled)).toBe(true);
  });
});
