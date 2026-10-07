// ---------------------------------------------------------------------------
// The Coverage window: run seeded playthroughs (computed in main, off the UI
// thread) and show every card, least reached first: what never gets dealt and
// why, what is dealt only rarely, and what is dealt but never played. The
// per-hand lens waits below, folded away (the author's ruling, 2026-09-29).
//
// A tool window, like the Board and Find: it STAYS OPEN while you edit, it
// sits over the editor, and main caches the last report so reopening shows it
// again, dated, and marked when the project has changed since (Patterpad's
// coverage window). Like Patterpad's, it never runs on its own: it waits for
// Run (ruling P). Every row is a way back into the editor: click a card to
// open it, click a gate ref to find everywhere it is used, click "Coverage
// drivers..." to go and set one.
//
// Kept deliberately spare: the primary question is "does my content get
// dealt?", so the answer leads and the raw numbers recede.
// ---------------------------------------------------------------------------

import "../src/theme.css";
import "../tool-window/base.css";
import "@wildwinter/app-shell/job.css";
import "./coverage.css";
import "@wildwinter/app-shell/tooltip.css";
import "@wildwinter/app-shell/toast.css";
import { el, metaLine, mountJobProgress, pinButton, plural, toast, toolWindowHead } from "@wildwinter/app-shell";
import type { CoverageInfo, CoverageOrder, CoverageReport, SearchSelection } from "../../shared/api.js";
import { turnSpan } from "@storylet-studio/model";
import { handsBlock } from "./hands.js";
import { cardsBlock, summaryBlock, withTip } from "./cards.js";
import { ranLine, runSetting } from "./run-settings.js";
import type { RanStamp } from "./run-settings.js";
import { bootToolWindow } from "../tool-window/boot.js";

const studio = window.studio;

const root = document.getElementById("coverage")!;
let report: CoverageReport | undefined;
/** When `report` ran, and on which version of the project (run-settings.ts). */
let ran: RanStamp | undefined;
/** The project has changed since `report` ran. */
let stale = false;
let name = "";
let driverCount = 0;
let hasProject = false;
/** The card table's order, remembered in the app's state (main keeps it). */
let order: CoverageOrder = "least";
/** Whether the per-hand section is unfolded. Kept here because every render
 *  rebuilds the body, and a sweep starting should not fold it back up. */
let handsOpen = false;
let error = "";
let busy = false;
/** The last report was cut short by Cancel, so it speaks for fewer runs. */
let partial = false;
/** Bumped when a different project opens underneath: a sweep that was running
 *  for the old one finishes into nothing. */
let generation = 0;

/** Run a sweep as a cancellable job, with the strip live above the results.
 *  The strip is mounted once and survives re-renders: it belongs to the job,
 *  not to the report underneath it. Main dates the report (`ran`): the time it
 *  finished and the project it read, after any drivers the job added. */
async function sweep(
  start: () => Promise<{ report: CoverageReport; name?: string; ran: RanStamp; cancelled?: boolean } | { error: string }>,
): Promise<void> {
  if (busy || !hasProject || !settingsValid()) return;
  const mine = generation;
  busy = true; error = ""; render();
  progress.begin(`Running ${plural(settings.runs, "playthrough")}…`);
  let result: Awaited<ReturnType<typeof start>>;
  try { result = await start(); }
  catch (e) { result = { error: e instanceof Error ? e.message : String(e) }; }
  busy = false;
  progress.end();
  // A different project opened while this ran: main cancels the job and drops
  // what it found, and so does this window, whatever came back.
  if (mine !== generation) { render(); return; }
  // The window keeps the error in view; the toast is the family's voice for a
  // failure in a tool window (parity row 19).
  if ("error" in result) { error = result.error; report = undefined; partial = false; toast(`Coverage failed: ${result.error}`, "error"); }
  else {
    report = result.report;
    if (result.name !== undefined) name = result.name;
    driverCount = result.report.drivers.length;
    partial = result.cancelled === true;
    ran = result.ran;
    stale = false;
    scrollTo = 0;   // a new report reads from the top
  }
  render();
}

const run = (): Promise<void> => sweep(() => studio.coverageRun({ ...settings }));
const addDrivers = (): Promise<void> => sweep(() => studio.coverageAddDrivers({ ...settings }));

const reveal = (selection: SearchSelection): void => { void studio.searchReveal(selection); };

// --- the bar: built once ---------------------------------------------------------
// The shell's tool-window chrome, the same as Find and Links: a title, the
// project, a spacer, the window's own controls, then the pin and close pair. It
// is MOUNTED ONCE, so a render never takes the caret out of a field half typed.

/** The run settings, as last accepted from their fields. */
const settings = { runs: 200, maxTurns: 100, seed: 0 };
/** Fields holding a value they refuse (blank, or out of range): Run waits. */
const refused = new Set<keyof typeof settings>();
const settingsValid = (): boolean => refused.size === 0;

/** A run setting's field. A refused value marks the field and holds Run back,
 *  rather than being quietly swapped for something else. */
function settingField(key: keyof typeof settings, label: string, min: number): HTMLElement {
  const input = el("input", { className: "num" }) as HTMLInputElement;
  input.value = String(settings[key]);
  input.inputMode = "numeric";
  input.setAttribute("aria-label", label);
  const check = (): void => {
    const n = runSetting(input.value, min);
    if (n === undefined) refused.add(key); else { refused.delete(key); settings[key] = n; }
    input.classList.toggle("invalid", n === undefined);
    input.setAttribute("aria-invalid", String(n === undefined));
    syncControls();
  };
  input.addEventListener("input", check);
  // Enter runs, as it would on a form.
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void run(); } });
  return el("label", { className: "field" }, `${label} `, input);
}

/** A Run button: the bar's, and the empty state's. Disabled while a sweep runs
 *  (a second click used to start a second sweep over the first), with no
 *  project, and while a setting is refused (syncControls). */
function runButton(primary: boolean): HTMLButtonElement {
  const b = el("button", { className: `btn${primary ? " primary" : ""} crun`, text: "Run coverage", onClick: () => void run() }) as HTMLButtonElement;
  b.type = "button";
  return b;
}

const nameEl = el("span", { className: "cname" });
const pin = pinButton({ pinned: true, onToggle: (on) => { void studio.setCoveragePinned(on); } });
const head = toolWindowHead({
  title: "Coverage",
  className: "cbar",
  pin,
  onClose: () => void studio.closeCoverage(),
  // Escape closes, as it does in Find and Links. NOT while a sweep is running:
  // the window is the only place the progress and the Cancel button live, and
  // closing it out from under a job would leave the job with nowhere to report.
  onEscape: () => busy,
  // The project is named beside the title rather than folded into it: the
  // title says which window this is, and that should not change as projects
  // open.
  lead: [nameEl],
  trail: [
    settingField("runs", "Runs", 1),
    settingField("maxTurns", "Max turns", 1),
    settingField("seed", "Seed", 0),
    runButton(true),
  ],
});

const progress = mountJobProgress(el("div"), { units: "runs", onCancel: () => { void studio.coverageCancel(); } });

// The driver note sits under the bar whatever the state of the results: it is
// the difference between "this content is unreachable" and "the test was never
// told how to reach it". Refreshed when the window comes forward, since the
// drivers are set in the editor.
const noteText = el("span", { className: "hint" });
const note = el("div", { className: "cnote" },
  noteText,
  el("button", { className: "btn", text: "Coverage drivers…", onClick: () => void studio.openProjectSettings("world") }));

/** While a sweep runs, the results underneath belong to the PREVIOUS run. */
const body = el("main", { className: "cbody" });
/** Where the report was scrolled to, put back after a render (undefined: keep
 *  wherever it is). */
let scrollTo: number | undefined;

function syncControls(): void {
  const why = !hasProject ? "Open a project first" : !settingsValid() ? "Runs and max turns must be 1 or more" : undefined;
  for (const b of root.querySelectorAll<HTMLButtonElement>(".crun")) {
    b.disabled = busy || why !== undefined;
    b.textContent = busy ? "Running…" : "Run coverage";
    if (why !== undefined && !busy) b.dataset["tip"] = why; else delete b.dataset["tip"];
  }
  // The quick fix runs a sweep too, so it waits on the same things.
  for (const b of body.querySelectorAll<HTMLButtonElement>(".cfix")) b.disabled = busy || !settingsValid();
}

function render(): void {
  nameEl.textContent = name;
  noteText.className = hasProject && driverCount === 0 ? "hint warnish" : "hint";
  noteText.textContent = !hasProject
    ? "Open a project to run coverage."
    : driverCount > 0
      ? `${plural(driverCount, "coverage driver")} feeding @world.`
      : "No coverage drivers. Content gated on @world will read as never dealt.";

  const keep = scrollTo ?? body.scrollTop;
  scrollTo = undefined;
  body.className = busy ? "cbody stale" : "cbody";
  if (!hasProject) {
    body.replaceChildren(el("p", { className: "empty", text: "Open a project to run coverage." }));
  } else if (error) {
    body.replaceChildren(el("pre", { className: "cerror", text: error }));
  } else if (!report) {
    // Coverage waits to be asked (ruling P, as Patterpad's does): a sweep takes
    // seconds on a large project, and Run should mean one thing.
    body.replaceChildren(el("div", { className: "cempty" },
      el("p", { className: "empty", text: "Run coverage to see how often each card comes up." }),
      busy ? null : runButton(false)));
  } else {
    // FILTERED: `results` returns nulls for the sections this report has nothing
    // to say about, and Element.append stringifies a null rather than skipping
    // it, so the window was printing "nullnullnull" under a clean run.
    body.replaceChildren(...results(report).filter((n): n is HTMLElement => n !== null));
  }
  body.scrollTop = keep;
  syncControls();
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

  const dated = ranLine(ran, stale);
  return [
    // When this ran, and whether the project has moved on since: a cached
    // report opens without running again, so it says how old it is.
    dated !== undefined ? el("p", { className: `cran${stale ? " stale" : ""}`, text: dated }) : null,
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
          (() => {
            const b = el("button", { className: "btn cfix", text: busy ? "Working…" : "Add coverage drivers", onClick: () => void addDrivers() }) as HTMLButtonElement;
            b.type = "button";
            b.disabled = busy;
            return b;
          })(),
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

/** Read the window's state - the project, the driver count and the report
 *  main cached earlier this session - and draw. Safe to call again. Never runs
 *  a sweep: the window waits for Run (ruling P). */
async function refresh(): Promise<void> {
  const [state, info] = await Promise.all([studio.getState(), studio.coverageInfo()]);
  takeProject(info);
  pin.set(info.pinned);
  order = state.coverageOrder;
  if (!busy) {
    report = info.last;
    ran = report !== undefined ? info.ran : undefined;
  }
  await checkStale();
  render();
}

/** The project as main has it now: whether there is one, its name, and how
 *  many coverage drivers feed @world. */
function takeProject(info: CoverageInfo): void {
  hasProject = info.hasProject;
  name = info.name;
  driverCount = info.driverCount;
}

/** Has the project moved on since the report ran? */
async function checkStale(): Promise<void> {
  if (!report || ran === undefined) { stale = false; return; }
  const now = await studio.projectHash();
  stale = now !== ran.hash;
}

/** Coming back to the window: the drivers may have been set in the editor and
 *  the project edited, so the note and the report's date are read again. Never
 *  the report itself while a sweep is running. */
async function refocus(): Promise<void> {
  takeProject(await studio.coverageInfo());
  await checkStale();
  render();
}

// A different project was opened underneath the window: the cached report
// described the old one, so it goes, and so does its date. A sweep running for
// the old project finishes into nothing (main cancels it). REFRESH, not a
// re-mount: everything above registers once.
studio.onProjectChanged(() => {
  generation++;
  report = undefined; error = ""; partial = false; ran = undefined; stale = false;
  scrollTo = 0;
  void refresh();
});
studio.onJobProgress((p) => {
  if (p.kind === "coverage") progress.update(p.done, p.total, p.elapsedMs);
});
window.addEventListener("focus", () => void refocus());

async function boot(): Promise<void> {
  await bootToolWindow({ onPinned: (on) => pin.set(on) });
  root.replaceChildren(head, progress.element, note, body);
  await refresh();
}
void boot();
