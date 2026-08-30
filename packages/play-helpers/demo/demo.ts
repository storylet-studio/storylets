// ---------------------------------------------------------------------------
// The Board demo, JS idiom.
//
// The whole play loop as one clickable board: every hand from board() is a
// labelled group of card buttons, clicking a card reveals its outcomes,
// clicking an available outcome plays it, and every action writes one line to
// the transcript. Deal all hands / Next turn / Restart are the only other
// controls. The two JS examiners sit beside the board, so the state the board
// moves is visible as it moves: createPropertyInspector over the live flow,
// createBundleInspector over the compiled bundle.
//
// This is the same demo the Godot, Unity and Unreal runtimes ship: same board,
// same control labels in the same order, same transcript grammar, one idiom
// each. Read a minimal one-shot demo first if you want the smallest possible
// integration (ports/godot/addons/storyletengine/demo, or the Unity
// PlayThrough sample); this one is the loop.
//
// The bundle beside this file is a copy of the compiled Hamlet bundle that
// ships with the Godot addon demo. Nothing here re-exports from examples/.
//
// To run it, from the repo root:
//   npx esbuild packages/play-helpers/demo/demo.ts --bundle --format=esm \
//     --outfile=packages/play-helpers/demo/app.js --tsconfig=tsconfig.json
// then serve the folder (the page fetches the bundle) and open index.html.
// See README.md beside this file.
//
// This whole demo folder is freely deletable: nothing in the package depends
// on it.
// ---------------------------------------------------------------------------
/// <reference lib="dom" />

import type { Bundle } from "@storylet-studio/model";
import { Engine } from "@storylet-studio/runtime";
import type { DealtCard, Flow, OutcomeView } from "@storylet-studio/runtime";
import { applyLiveBundle, createBundleInspector, createLiveLink, createPropertyInspector } from "@storylet-studio/play-helpers";
import type { BundleInspector, LiveLink, PropertyInspector } from "@storylet-studio/play-helpers";

/** Seed 7, log on: the Board demo's run, identical in all four runtimes. */
const SEED = 7;
/** `?live=1` opens a Live Link to Storyletter on load (design/live-link.md):
 *  the editor's Board shows this run, and a save in the editor lands here
 *  without a restart. Off by default so the demo stays a plain page.
 *  `?live=ws://127.0.0.1:<port>` points it somewhere other than the default. */
const LIVE = new URLSearchParams(window.location.search).get("live");
const LIVE_URL = LIVE !== null && LIVE !== "1" ? LIVE : undefined;
/** What an empty hand says, on the board and in the transcript. */
const NOTHING = "(nothing here right now)";

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`no #${id}`);
  return el;
};

const named = (title: string | undefined, gameId: string): string => title ?? gameId;

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// --- the board's own state ---------------------------------------------------

let bundle: Bundle;
let identity = "";
let engine: Engine;
let flow: Flow;
let statePanel: PropertyInspector | undefined;
let bundlePanel: BundleInspector | undefined;
let link: LiveLink | undefined;
/** Hand gameId -> title-or-gameId: board() and dealMany() key by gameId. */
const handNames = new Map<string, string>();
/** The one open card, if any: only ever one at a time. */
let open: { hand: string; card: string } | undefined;

// --- the transcript ----------------------------------------------------------

const say = (text: string): void => {
  const transcript = $("transcript");
  const div = document.createElement("div");
  div.className = "tr-line";
  div.textContent = text;
  transcript.append(div);
  transcript.scrollTop = transcript.scrollHeight;
};

// --- the header line ---------------------------------------------------------

const renderHeader = (): void => {
  const clocks = flow.listBoxes()
    .map((box) => `${named(box.title, box.gameId)} turn ${box.turn}`)
    .join(", ");
  $("header-line").textContent = `${identity} - ${clocks}`;
};

// --- the board ---------------------------------------------------------------

/** Play one outcome and move the board, or report the refusal. */
const playOutcome = (hand: string, card: DealtCard, outcome: OutcomeView): void => {
  try {
    flow.play(card.id, outcome.gameId, hand);
  } catch (e) {
    say(`! ${message(e)}`);
    return;
  }
  say(`played "${named(card.title, card.gameId)}" -> ${named(outcome.title, outcome.gameId)}`);
  open = undefined;
  refill();
};

/** The world moved, so the board does too: re-deal every hand, which fills
 *  the slots the play emptied and drops any card the new state invalidated.
 *  Silently, on purpose: the transcript keeps the beats you caused, and the
 *  arrivals and departures are already in the examiner's log panel. */
const refill = (): void => {
  flow.dealMany();
  renderHeader();
  renderBoard();
};

/** The revealed outcomes of one card: available ones clickable, unavailable
 *  ones still shown but disabled and labelled "(locked)". */
const renderOutcomes = (hand: string, card: DealtCard): HTMLElement => {
  const wrap = document.createElement("div");
  wrap.className = "bd-outcomes";
  for (const outcome of flow.outcomes(card.id, hand)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bd-outcome";
    const label = named(outcome.title, outcome.gameId);
    button.textContent = outcome.available ? label : `${label} (locked)`;
    button.disabled = !outcome.available;
    if (outcome.available) {
      button.addEventListener("click", () => playOutcome(hand, card, outcome));
    }
    wrap.append(button);
  }
  return wrap;
};

const renderBoard = (): void => {
  const board = $("board");
  board.textContent = "";
  for (const [hand, cards] of Object.entries(flow.board())) {
    const group = document.createElement("section");
    group.className = "bd-hand";
    const label = document.createElement("h2");
    label.className = "bd-hand-label";
    label.textContent = handNames.get(hand) ?? hand;
    group.append(label);

    if (cards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bd-empty";
      empty.textContent = NOTHING;
      group.append(empty);
      board.append(group);
      continue;
    }

    for (const card of cards) {
      const row = document.createElement("div");
      row.className = "bd-card-row";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bd-card";
      button.textContent = named(card.title, card.gameId);
      const isOpen = open !== undefined && open.hand === hand && open.card === card.id;
      if (isOpen) button.classList.add("bd-card-open");
      button.addEventListener("click", () => {
        open = isOpen ? undefined : { hand, card: card.id };
        renderBoard();
      });
      row.append(button);
      if (isOpen) row.append(renderOutcomes(hand, card));
      group.append(row);
    }
    board.append(group);
  }
};

// --- the three controls ------------------------------------------------------

/** Deal every hand in one call, then say what each hand got. */
const dealAllHands = (): void => {
  for (const [hand, cards] of Object.entries(flow.dealMany())) {
    const names = cards.map((card) => named(card.title, card.gameId));
    say(`dealt: ${handNames.get(hand) ?? hand} <- ${names.length > 0 ? names.join(", ") : NOTHING}`);
  }
  open = undefined;
  renderHeader();
  renderBoard();
};

/** Advance every box by one, in listBoxes() order. */
const nextTurn = (): void => {
  for (const box of flow.listBoxes()) {
    flow.advanceTurns(box.gameId);
    say(`turn ${named(box.title, box.gameId)} -> ${flow.turn(box.gameId)}`);
  }
  refill();   // time passed: cooldowns lapse, so the hands refresh too
};

/** Drop the flow and the panel over it, build both again, clear the
 *  transcript, and deal: the clocks go back to 0 and the first hands come
 *  straight back out, so the board is never empty. */
const restart = (): void => {
  engine = new Engine(bundle, { seed: SEED, log: true });
  flow = engine.openFlow("main");
  mountStatePanel();
  link?.attach(engine);
  open = undefined;
  $("transcript").textContent = "";
  say(`restarted (seed ${SEED})`);
  dealAllHands();
};

const control = (label: string, onClick: () => void): void => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bd-control";
  button.textContent = label;
  button.addEventListener("click", () => {
    try {
      onClick();
    } catch (e) {
      say(`! ${message(e)}`);
    }
  });
  $("controls").append(button);
};

// --- the examiners -----------------------------------------------------------

/** The bundle examiner needs nothing running; it also carries the identity and
 *  the hand titles the board labels its groups with. Mounted again when a
 *  live refresh swaps the bundle. */
const mountBundlePanel = (): void => {
  bundlePanel?.destroy();
  bundlePanel = createBundleInspector(bundle, {
    container: $("examiner-bundle"),
    title: "Bundle (nothing running)",
  });
  identity = `${bundlePanel.description.identity.project} ${bundlePanel.description.identity.version}`;
  handNames.clear();
  for (const hand of bundlePanel.description.hands) {
    handNames.set(hand.gameId, named(hand.title, hand.gameId));
  }
};

/** The state examiner over the CURRENT flow: mounted again whenever the
 *  flow is replaced (Restart, a live refresh). */
const mountStatePanel = (): void => {
  statePanel?.destroy();
  statePanel = createPropertyInspector(engine, flow, {
    container: $("examiner-state"),
    title: "Runtime state (main flow)",
  });
};

// --- the live link -----------------------------------------------------------

/** The editor pushed a new build: swap it in under the run, re-bind
 *  everything that held the old flow or bundle, and tell the editor. */
const onBundle = ({ build, data }: { build: string; data: string }): void => {
  const r = applyLiveBundle(engine, data, { seed: SEED, log: true });
  if (!r.ok) {
    say(`! live link: ${r.error}`);
    return;
  }
  bundle = r.bundle;
  engine = r.engine;
  flow = engine.getFlow("main") ?? engine.openFlow("main");
  mountBundlePanel();
  mountStatePanel();
  open = undefined;
  say(`live link: build ${build} applied, the run carried across`);
  renderHeader();
  renderBoard();
  link?.attach(engine);
  link?.setBuild(build);
};

const openLiveLink = (): void => {
  link = createLiveLink({
    build: bundle.content.hash,
    project: identity,
    ...(LIVE_URL !== undefined ? { url: LIVE_URL } : {}),
    onBundle,
  });
  link.attach(engine);
  say(`live link: ${LIVE_URL ?? "ws://127.0.0.1:4472"} (Play > Live Link in Storyletter)`);
};

// --- start -------------------------------------------------------------------

const start = async (): Promise<void> => {
  const res = await fetch("./the-hamlet.storyletsc");
  if (!res.ok) throw new Error(`bundle fetch failed: ${res.status}`);
  bundle = (await res.json()) as Bundle;

  mountBundlePanel();

  // log: true is what fills the examiner's Log panel as you play.
  engine = new Engine(bundle, { seed: SEED, log: true });
  flow = engine.openFlow("main");
  mountStatePanel();

  control("Deal all hands", dealAllHands);
  control("Next turn", nextTurn);
  control("Restart", restart);

  // Attached before the first deal, so the editor sees the whole run.
  if (LIVE !== null) openLiveLink();

  // The board opens dealt: the first hands are already out, so there is
  // something to read and play the moment the demo loads.
  dealAllHands();
};

// Teardown: the panels hold a poll timer, so drop them with the page.
window.addEventListener("pagehide", () => {
  statePanel?.destroy();
  bundlePanel?.destroy();
  link?.close();
});

void start().catch((e: unknown) => {
  say(`! startup failed: ${message(e)}`);
});
