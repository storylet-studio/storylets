// ---------------------------------------------------------------------------
// The Coverage window: run seeded playthroughs (computed in main, off the UI
// thread) and show the per-hand lens first - what each hand can hold, what
// never gets dealt and why.
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
import { applyTheme } from "../src/theme.js";
import { toolWindowHead } from "../src/tool-window-head.js";
import { el } from "../src/dom.js";
import { initTooltips, mountJobProgress } from "@wildwinter/app-shell";
import type { JobProgressView } from "@wildwinter/app-shell";
import type { CoverageReport, SearchSelection, StudioApi } from "../../shared/api.js";

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
  progress?.begin(`Running ${runs} playthrough${runs === 1 ? "" : "s"}…`);
  const result = await start();
  busy = false;
  progress?.end();
  if ("error" in result) { error = result.error; report = undefined; partial = false; }
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
    // The project is named beside the title rather than folded into it: the
    // title says which window this is, and that should not change as projects
    // open.
    lead: [el("span", { className: "cname", text: name })],
    trail: [
      el("label", { className: "field" }, "runs ", numberInput(runs, (n) => { runs = n; })),
      el("label", { className: "field" }, "max turns ", numberInput(maxTurns, (n) => { maxTurns = n; })),
      el("label", { className: "field" }, "seed ", numberInput(seed, (n) => { seed = n; })),
      el("button", { className: "primary", text: busy ? "Running…" : "Run coverage", onClick: () => void run() }),
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
          ? `${driverCount} coverage driver${driverCount === 1 ? "" : "s"} feeding @world.`
          : "No coverage drivers: content gated on @world will read as never dealt.",
    }),
    el("button", { text: "Coverage drivers…", onClick: () => void studio.openProjectSettings("world") }),
  );

  // While a sweep runs, the results underneath belong to the PREVIOUS run.
  // Dim them: still readable, plainly not the thing being measured.
  const body = el("main", { className: busy ? "cbody stale" : "cbody" });
  if (error) body.append(el("pre", { className: "cerror", text: error }));
  else if (!report) body.append(el("p", { className: "hint", text: "Run coverage to see what each hand can hold." }));
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

/** A row that opens the thing it names in the editor. */
function revealRow(className: string, selection: SearchSelection, ...children: (HTMLElement | string | null)[]): HTMLElement {
  const row = el("button", { className: `${className} reveal` }, ...children);
  row.title = "Open in the editor";
  row.addEventListener("click", () => reveal(selection));
  return row;
}

/** A gate ref as a link into Find: "gated on @world.raining - where else is
 *  that used?" is the question a reader has the moment they read the flag. */
function gateRefs(refs: string[]): HTMLElement {
  const span = el("span", { className: "hint" }, "gated on ");
  refs.forEach((ref, i) => {
    if (i > 0) span.append(", ");
    const link = el("button", { className: "reflink", text: ref });
    link.title = `Find where ${ref} is used`;
    link.addEventListener("click", (event) => { event.stopPropagation(); void studio.openSearch({ mode: "property", query: ref }); });
    span.append(link);
  });
  // "or drives" only when a driver could actually help: drivers feed @world,
  // where @story and @hand state is the content's own to write.
  span.append(refs.some((r) => r.startsWith("@world.")) ? " - nothing writes or drives it" : " - nothing writes it");
  return span;
}

function results(r: CoverageReport): (HTMLElement | null)[] {
  const cardsDealt = r.cards.filter((c) => c.dealt > 0).length;
  const gaps = r.cards.filter((c) => c.dealt === 0);
  const hasDriverGap = gaps.some((c) => c.unwrittenRefs && c.unwrittenRefs.length > 0);
  // Dealt but never played: the card reaches the board and the player never
  // has a reason (or a way) to take it. A distinct fault from never dealt,
  // and invisible if you only count deals (the old system's diagnostic).
  // A card with NO outcomes is none of this: dealt is its whole job (the
  // news/codex pattern), so listing it here reads as "not selected", which
  // misled a reader (2026-08-28).
  const playable = new Set(r.outcomes.map((o) => o.card));
  const unplayed = r.cards.filter((c) => c.dealt > 0 && c.played === 0 && playable.has(c.id));
  const dealtOnly = r.cards.filter((c) => !playable.has(c.id)).length;
  const deadOutcomes = r.outcomes.filter((o) => o.played === 0);
  const cardById = new Map(r.cards.map((c) => [c.id, c]));
  const t = r.terminations;

  return [
    el("div", { className: "summary" },
      el("span", { className: "big", text: `${cardsDealt}/${r.cards.length}` }),
      el("span", { className: "sublabel", text: `cards dealt · ${r.runs} runs · seed ${r.seed}` }),
      partial ? el("span", { className: "partial", text: "stopped early" }) : null,
    ),
    // The run's own shape: how the playthroughs ended says whether the
    // numbers above are worth trusting. All "stuck" means the content jams.
    el("p", { className: "meta" },
      `${r.turns} turns · ${r.plays} plays · max ${r.maxTurns} turns per run`,
      el("span", { className: "sep", text: "·" }),
      `${t.exhausted} exhausted · ${t.maxTurns} hit the cap · ${t.stuck} stuck`,
    ),

    // The per-hand lens - the writer/programmer contract, front and centre.
    el("section", { className: "block" },
      el("span", { className: "overline", text: "By hand" }),
      ...r.hands.map((h) => {
        const total = h.cardsDealt.length + h.cardsNeverDealt.length;
        const full = h.cardsNeverDealt.length === 0;
        const row = revealRow(`qrow${full ? " full" : ""}`, { kind: "hand", box: h.box, hand: h.id },
          el("span", { className: "qname", text: h.gameId }),
          el("span", { className: "bar" }, el("i", { className: "fill" })),
          el("span", { className: "count", text: `${h.cardsDealt.length}/${total}` }),
        );
        const fill = row.querySelector<HTMLElement>(".fill")!;
        fill.style.width = total > 0 ? `${(h.cardsDealt.length / total) * 100}%` : "0%";
        return row;
      }),
    ),

    // Never dealt, with the honesty-net hint.
    gaps.length > 0
      ? el("section", { className: "block" },
          el("span", { className: "overline", text: `Never dealt (${gaps.length})` }),
          ...gaps.map((c) => revealRow("gap", { kind: "card", box: c.box, deck: c.deck, card: c.id },
            el("span", { className: "gname", text: c.title ?? c.gameId }),
            c.unwrittenRefs && c.unwrittenRefs.length > 0
              ? gateRefs(c.unwrittenRefs)
              // The honesty net's second hop: the gate IS written, just never
              // by anything that happened. Naming the culprit turns two
              // never-dealt cards from two mysteries into one.
              : c.refsWrittenOnlyByNeverDealtCards && c.refsWrittenOnlyByNeverDealtCards.length > 0
              ? el("span", { className: "hint", text: c.refsWrittenOnlyByNeverDealtCards
                  .map((d) => `${d.ref} is only written by ${d.by
                    .map((id) => r.cards.find((x) => x.id === id)?.title ?? r.cards.find((x) => x.id === id)?.gameId ?? id).join(", ")}, which never came up either`)
                  .join("; ") })
              : el("span", { className: "hint", text: "not reached in these runs" }),
          )),
        )
      : el("section", { className: "block" }, el("span", { className: "allgood", text: "Every card gets dealt." })),

    unplayed.length > 0
      ? el("section", { className: "block" },
          el("span", { className: "overline", text: `Dealt but never played (${unplayed.length})` }),
          el("p", { className: "hint", text: "These reach the board; no outcome of theirs was ever taken. Check their outcome gates." }),
          ...unplayed.map((c) => revealRow("gap", { kind: "card", box: c.box, deck: c.deck, card: c.id },
            el("span", { className: "gname", text: c.title ?? c.gameId }),
            el("span", { className: "hint", text: `dealt ${c.dealt}×` }),
          )),
        )
      : null,
    dealtOnly > 0
      ? el("p", { className: "hint", text: `${dealtOnly} card${dealtOnly === 1 ? " has" : "s have"} no outcomes - dealt is their whole job, so they are never counted as unplayed.` })
      : null,

    deadOutcomes.length > 0
      ? el("section", { className: "block" },
          el("span", { className: "overline", text: `Outcomes never played (${deadOutcomes.length})` }),
          ...deadOutcomes.map((o) => {
            const card = cardById.get(o.card);
            const label = card ? `${card.title ?? card.gameId} · ${o.gameId}` : o.gameId;
            return card
              ? revealRow("gap", { kind: "card", box: card.box, deck: card.deck, card: card.id },
                  el("span", { className: "gname", text: label }))
              : el("div", { className: "gap" }, el("span", { className: "gname", text: label }));
          }),
        )
      : null,

    // The warnings the runs actually fired, and the composed-name net's
    // static findings (design/board-legibility.md): a faulting condition is
    // content that silently never deals from the faulting hand, which the
    // counts above would otherwise present as an ordinary gap.
    r.unprovidedHandRefs.length > 0 || r.diagnostics.length > 0
      ? el("section", { className: "block" },
          el("span", { className: "overline", text: `Warnings (${r.unprovidedHandRefs.length + r.diagnostics.length})` }),
          ...r.unprovidedHandRefs.map((u) => el("div", { className: "gap" },
            el("span", { className: "gname", text: `${u.where} reads ${u.ref}` }),
            el("span", { className: "hint", text: `never composed by ${u.hands.join(", ")}` }))),
          ...r.diagnostics.map((d) => el("div", { className: "gap" },
            el("span", { className: "gname", text: d.where }),
            el("span", { className: "hint", text: `${d.message} (${d.runs}/${r.runs} runs)` }))),
        )
      : null,

    // The quick-fix: propose + add drivers for the host-gated gaps.
    hasDriverGap
      ? el("div", { className: "fixrow" },
          el("span", { className: "hint", text: "Some content is gated on host state nothing sets." }),
          el("button", { text: busy ? "Working…" : "Add coverage drivers", onClick: () => void addDrivers() }),
        )
      : null,
  ];
}

/** One-time wiring: everything here registers a listener that is never
 *  removed, so it must happen exactly ONCE for the window's lifetime.
 *
 *  Split from `refresh` below on 2026-08-29. `boot()` did both jobs and the
 *  project-changed handler called it, so every project switch added another
 *  keydown listener, another theme handler, another pin handler and another
 *  job-progress handler. After n switches one Escape fired n closes and one
 *  pin change caused n renders. Find and the Board already answered
 *  onProjectChanged with a targeted refresh; this window was the exception. */
function mount(): void {
  initTooltips();
  // Escape closes, as it does in Find and Links. NOT while a sweep is running:
  // the window is the only place the progress and the Cancel button live, and
  // closing it out from under a job would leave the job with nowhere to report.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !busy) void studio.closeCoverage();
  });
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
