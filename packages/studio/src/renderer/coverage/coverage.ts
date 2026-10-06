// ---------------------------------------------------------------------------
// The Coverage window: run seeded playthroughs (computed in main, off the UI
// thread) and show every card, least reached first: what never gets dealt and
// why, what is dealt only rarely, and what is dealt but never played. The
// per-hand lens waits below, folded away (the author's ruling, 2026-09-29).
//
// A tool window, like the Board and Find: it STAYS OPEN while you edit, it
// sites over the editor, and main caches the last report so reopening shows it
// again (Patterpad's coverage window). Every row is a way back into the
// editor: click a card to open it, click a gate ref to find everywhere it is
// used, click "Coverage drivers..." to go and set one.
//
// Kept deliberately spare: the primary question is "does my content get
// dealt?", so the answer leads and the raw numbers recede.
// ---------------------------------------------------------------------------

import "../src/theme.css";
import "@wildwinter/app-shell/job.css";
import "./coverage.css";
import "@wildwinter/app-shell/tooltip.css";
import "@wildwinter/app-shell/toast.css";
import { applyTheme } from "../src/theme.js";
import { el } from "../src/dom.js";
import { initTooltips, metaLine, mountJobProgress, plural, toast, toolWindowHead } from "@wildwinter/app-shell";
import type { JobProgressView } from "@wildwinter/app-shell";
import type { CoverageOrder, CoverageReport, SearchSelection, StudioApi } from "../../shared/api.js";
import { turnSpan } from "@storylet-studio/model";
import { handsBlock } from "./hands.js";
import { cardsBlock, summaryBlock } from "./cards.js";

declare global { interface Window { studio: StudioApi; } }
const studio = window.studio;

const root = document.getElementById("coverage")!;
let runs = 200;
let maxTurns = 100;
let seed = 0;
let report: CoverageReport | undefined;
let name = "";
let driverCount = 0;
let hasProject = false;
let pinned = true;
/** The card table's order, remembered in the app's state (main keeps it). */
let order: CoverageOrder = "least";
/** Whether the per-hand section is unfolded. Kept here because every render
 *  rebuilds the body, and a sweep starting should not fold it back up. */
let handsOpen = false;
let error = "";
let busy = false;
/** The last report was cut short by Cancel, so it speaks for fewer runs. */
let partial = false;
let progress: JobProgressView | undefined;


/** Run a sweep as a cancellable job, with the strip live above the results.
 *  The strip is mounted once and survives re-renders: it belongs to the job,
 *  not to the report underneath it. */
async function sweep(start: () => Promise<{ report: CoverageReport; name?: string; cancelled?: boolean } | { error: string }>): Promise<void> {
  busy = true; error = ""; render();
  progress?.begin(`Running ${plural(runs, "playthrough")}…`);
  const result = await start();
  busy = false;
  progress?.end();
  // The window keeps the error in view; the toast is the family's voice for a
  // failure in a tool window (parity row 19).
  if ("error" in result) { error = result.error; report = undefined; partial = false; toast(`Coverage failed: ${result.error}`, "error"); }
  else {
    report = result.report;
    if (result.name !== undefined) name = result.name;
    driverCount = result.report.drivers.length;
    partial = result.cancelled === true;
  }
  render();
}

const run = (): Promise<void> => sweep(() => studio.coverageRun({ runs, maxTurns, seed }));
const addDrivers = (): Promise<void> => sweep(() => studio.coverageAddDrivers({ runs, maxTurns, seed }));

const reveal = (selection: SearchSelection): void => { void studio.searchReveal(selection); };

function render(): void {
  // The shell's tool-window chrome, the same as Find and Links: an uppercase
  // title, a spacer, the window's own controls, then the pin and close pair.
  // This window had been left on a hand-rolled bar with a hand-rolled pin, which
  // is the exact drift Links was rebuilt out of.
  const controls = toolWindowHead({
    title: "Coverage",
    className: "cbar",
    pinned,
    onPin: (on) => { pinned = on; void studio.setCoveragePinned(on); },
    onClose: () => void studio.closeCoverage(),
    // Escape closes, as it does in Find and Links. NOT while a sweep is running:
    // the window is the only place the progress and the Cancel button live, and
    // closing it out from under a job would leave the job with nowhere to report.
    onEscape: () => busy,
    // The project is named beside the title rather than folded into it: the
    // title says which window this is, and that should not change as projects
    // open.
    lead: [el("span", { className: "cname", text: name })],
    trail: [
      el("label", { className: "field" }, "runs ", numberInput(runs, (n) => { runs = n; })),
      el("label", { className: "field" }, "max turns ", numberInput(maxTurns, (n) => { maxTurns = n; })),
      el("label", { className: "field" }, "seed ", numberInput(seed, (n) => { seed = n; })),
      el("button", { className: "btn primary", text: busy ? "Running…" : "Run coverage", onClick: () => void run() }),
    ],
  });

  // The driver note sits under the bar whatever the state of the results: it
  // is the difference between "this content is unreachable" and "the test
  // was never told how to reach it".
  const note = el("div", { className: "cnote" },
    el("span", {
      className: driverCount > 0 ? "hint" : "hint warnish",
      text: !hasProject
        ? "No project open."
        : driverCount > 0
          ? `${plural(driverCount, "coverage driver")} feeding @world.`
          : "No coverage drivers. Content gated on @world will read as never dealt.",
    }),
    el("button", { className: "btn", text: "Coverage drivers…", onClick: () => void studio.openProjectSettings("world") }),
  );

  // While a sweep runs, the results underneath belong to the PREVIOUS run.
  // Dim them: still readable, plainly not the thing being measured.
  const body = el("main", { className: busy ? "cbody stale" : "cbody" });
  if (error) body.append(el("pre", { className: "cerror", text: error }));
  else if (!report) body.append(el("p", { className: "hint", text: "Run coverage to see how often each card comes up." }));
  // FILTERED: `results` returns nulls for the sections this report has nothing
  // to say about, and Element.append stringifies a null rather than skipping it,
  // so the window was printing "nullnullnull" under a clean run. `el()` filters
  // its own children, which is why this only showed up on the one call that
  // spreads into append instead.
  else body.append(...results(report).filter((n): n is HTMLElement => n !== null));

  // The strip is created once and re-homed on each render, so a running job
  // is never torn down by a repaint underneath it.
  if (!progress) {
    const holder = el("div");
    progress = mountJobProgress(holder, { units: "runs", onCancel: () => { void studio.coverageCancel(); } });
  }
  root.replaceChildren(controls, progress.element, note, body);
}

function numberInput(value: number, onChange: (n: number) => void): HTMLInputElement {
  const input = el("input", { className: "num" });
  input.value = String(value);
  input.addEventListener("change", () => { const n = Number(input.value); if (Number.isInteger(n) && n >= 0) onChange(n); });
  return input;
}

/** A row that opens the thing it names in the editor. (Not `revealRow`: that
 *  name is the shell's settings-row export, and a local twin of it read as
 *  the same thing.) */
function openRow(className: string, selection: SearchSelection, ...children: (HTMLElement | string | null)[]): HTMLElement {
  const row = el("button", { className: `${className} reveal`, tip: "Open in the editor" }, ...children);
  row.addEventListener("click", () => reveal(selection));
  return row;
}

/** " (100 min)" beside a turn count, when the project's boxes all agree on
 *  what a turn lasts; nothing at all otherwise. */
const asTime = (r: CoverageReport, turns: number): string =>
  r.turnSeconds === undefined ? "" : ` (${turnSpan(turns, r.turnSeconds)})`;

/** How a run ends, for the terminations line's tip. */
const TERMINATIONS_TIP =
  "A run stops early once it has seen everything. " +
  "Most runs of a story with branches go on to the turn cap, and that is normal. " +
  "One run takes one path, and the other runs see the rest. " +
  "A stuck run went 20 turns with nothing dealt.";

/** Give an element a themed rollover (`tip` on `el`, for an element made elsewhere). */
function withTip(node: HTMLElement, tip: string): HTMLElement {
  node.dataset["tip"] = tip;
  return node;
}

function results(r: CoverageReport): (HTMLElement | null)[] {
  const hasDriverGap = r.cards.some((c) => c.dealtRuns === 0 && c.unwrittenRefs && c.unwrittenRefs.length > 0);
  const deadOutcomes = r.outcomes.filter((o) => o.played === 0);
  const cardById = new Map(r.cards.map((c) => [c.id, c]));
  const t = r.terminations;

  // The hands, folded away under their own caption: still the contract
  // between designer and programmer, but the cards answer the first question.
  const hands = handsBlock(r, openRow);
  hands.open = handsOpen;
  hands.addEventListener("toggle", () => { handsOpen = hands.open; });

  return [
    // The headline, and how many cards want a look: never dealt, rarely
    // dealt, dealt but never played. The table below says which.
    summaryBlock(r, partial),
    // The run's own shape: how the playthroughs ended says whether the
    // numbers above are worth trusting. All "stuck" means the content jams.
    // Two drawn metadata lines, the run's size and how it ended, spaced by
    // the paragraph's gap rather than by anything typed between them.
    el("p", { className: "meta" },
      // A project whose every box is timed can have its turns read as time
      // (design/engine-server.md 4.8); a mixed project cannot, and says
      // nothing rather than something misleading.
      metaLine([`${r.turns} turns${asTime(r, r.turns)}`, `${r.plays} plays`, `max ${r.maxTurns} turns per run${asTime(r, r.maxTurns)}`]),
      // "Hit the cap" read as a fault, and on a branching story it is most
      // runs: one playthrough takes one path, so it rarely sees everything on
      // its own (the author, 2026-09-29). The words say so plainly and the
      // longer sentence waits in the tip, where the density rule keeps it.
      withTip(metaLine([`${t.exhausted} saw everything`, `${t.maxTurns} ran to the turn cap`, `${t.stuck} stuck`]),
        TERMINATIONS_TIP),
    ),

    // Every card, least reached first unless the author chose deck order.
    // The never dealt carry the honesty net's reason, so this table is also
    // where "why is this never dealt?" is answered.
    cardsBlock(r, {
      order,
      onOrderChange: (next) => { order = next; void studio.setCoverageOrder(next); },
      onOpen: reveal,
      onFindUsage: (ref) => { void studio.openSearch({ mode: "property", query: ref }); },
    }),

    // The quick-fix: propose + add drivers for the host-gated gaps, right
    // under the rows it would fix.
    hasDriverGap
      ? el("div", { className: "fixrow" },
          el("span", { className: "hint", text: "Some content is gated on host state nothing sets." }),
          el("button", { className: "btn", text: busy ? "Working…" : "Add coverage drivers", onClick: () => void addDrivers() }),
        )
      : null,

    deadOutcomes.length > 0
      ? el("section", { className: "block" },
          el("span", { className: "caption", text: `Outcomes never played (${deadOutcomes.length})` }),
          ...deadOutcomes.map((o) => {
            const card = cardById.get(o.card);
            return card
              ? openRow("gap", { kind: "card", box: card.box, deck: card.deck, card: card.id },
                  el("span", { className: "gname" }, metaLine([card.title ?? card.gameId, o.gameId])))
              : el("div", { className: "gap" }, el("span", { className: "gname", text: o.gameId }));
          }),
        )
      : null,

    // The warnings the runs actually fired, and the composed-name net's
    // static findings (design/board-legibility.md): a faulting condition is
    // content that silently never deals from the faulting hand, which the
    // counts above would otherwise present as an ordinary gap.
    r.unprovidedHandRefs.length > 0 || r.diagnostics.length > 0
      ? el("section", { className: "block" },
          el("span", { className: "caption", text: `Warnings (${r.unprovidedHandRefs.length + r.diagnostics.length})` }),
          ...r.unprovidedHandRefs.map((u) => el("div", { className: "gap" },
            el("span", { className: "gname", text: `${u.where} uses ${u.ref}` }),
            el("span", { className: "hint", text: `never composed by ${u.hands.join(", ")}` }))),
          ...r.diagnostics.map((d) => el("div", { className: "gap" },
            el("span", { className: "gname", text: d.where }),
            el("span", { className: "hint", text: `${d.message} (${d.runs}/${r.runs} runs)` }))),
        )
      : null,

    hands,
  ];
}

/** One-time wiring: everything here registers a listener that is never
 *  removed, so it must happen exactly ONCE for the window's lifetime.
 *
 *  Split from `refresh` below on 2026-08-29. `boot()` did both jobs and the
 *  project-changed handler called it, so every project switch added another
 *  theme handler, another pin handler and another job-progress handler. After
 *  n switches one pin change caused n renders. Find and the Board already answered
 *  onProjectChanged with a targeted refresh; this window was the exception. */
function mount(): void {
  initTooltips();
  studio.onTheme(applyTheme);
  // Reset View re-pins every helper window in main and tells the window after
  // the fact (app-shell 0.23.0). Re-rendering is the whole fix here: this head
  // is rebuilt from `pinned` on every render, so the button comes back agreeing
  // with the window instead of showing the state it last chose itself.
  studio.onWindowPinned((on) => { pinned = on; render(); });
  studio.onJobProgress((p) => {
    if (p.kind === "coverage") progress?.update(p.done, p.total, p.elapsedMs);
  });
}

/** Read the window's state - the project, the driver count, the pin, and any
 *  report cached from earlier this session - and draw. Safe to call again. */
async function refresh(): Promise<void> {
  const [state, info] = await Promise.all([studio.getState(), studio.coverageInfo()]);
  applyTheme(state.theme);
  hasProject = info.hasProject;
  name = info.name;
  driverCount = info.driverCount;
  pinned = info.pinned;
  order = state.coverageOrder;
  report = info.last;
  render();
  // A cached report is the whole point of caching: don't spend a run redoing it.
  if (!report && hasProject) void run();
}

// A different project was opened underneath the window: the cached report
// described the old one, so start again. REFRESH, not a re-mount.
studio.onProjectChanged(() => {
  report = undefined; error = "";
  void refresh();
});

mount();
void refresh();
