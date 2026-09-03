// ---------------------------------------------------------------------------
// The Village: a small browser game over a Storylet Engine bundle.
//
// This file is the whole integration. It is meant to be READ, so it is written
// in the order you would build one: load the bundle, open a flow, put the
// player somewhere, deal that place's hand, show what they can do, play it,
// let time pass. Everything else in the folder is drawing.
//
// The engine's part and the game's part are deliberately easy to tell apart:
//   the ENGINE decides what is eligible, ranks it, deals it and applies an
//   outcome's changes. Everything else here - where the player is, what a card
//   looks like, what the journal says - is the GAME's, and the engine neither
//   knows nor cares.
//
// The API this shows, and the API it deliberately does not, are tabled in the
// README and checked by scripts/check-sample-coverage.mjs.
// ---------------------------------------------------------------------------
/// <reference lib="dom" />

import { Engine } from "@storylet-studio/runtime";
import type { DealtCard, Flow, OutcomeView } from "@storylet-studio/runtime";
import { describeBundle } from "@storylet-studio/runtime";
import { serializeState, deserializeState } from "@storylet-studio/play-helpers";
import type { Bundle } from "@storylet-studio/model";
import { mountMap, type MapState, type VillageMap } from "./map.js";
import { journal, note } from "./journal.js";
import { el, $ } from "./dom.js";

/** One playthrough per browser, kept under this key. */
const SAVE_KEY = "the-village/save@1";
/** A fixed seed makes a session reproducible, which a sample wants and a real
 *  game would replace with something per-playthrough. */
const SEED = 11;
/** The engine has no default flow: a game opens the one it plays in. */
const FLOW = "main";

// --- state the GAME owns, not the engine ------------------------------------
// The engine knows nothing about where the player is standing. That is a game
// question, and this is the whole of the answer to it.
let engine: Engine;
let flow: Flow;
let maps: VillageMap[];
/** The drawn world. Built once; only its marker moves. */
let world: { update: (state: MapState) => void };
/** The site (a hand's gameId) the player is at, or null when out on the map. */
let at: string | null = null;
/** The card being played, if any. It fills the overlay over the map. */
let open: DealtCard | null = null;

/** Which box is the world? ASKED, not hard-coded: `listBoxes` is the engine's
 *  own answer, so a project with a differently-named box needs no edit here.
 *  The Village has one; a game with several would let the player's place say
 *  which one they are in. */
const box = (): string => flow.listBoxes()[0]!.gameId;

// --- the loop ---------------------------------------------------------------

/** Start, or resume. Every visible thing follows from these five lines. */
async function start(): Promise<void> {
  const bundle = await fetch("village.storyletsc").then((r) => r.json()) as Bundle;
  maps = await fetch("maps.json").then((r) => r.json()) as VillageMap[];

  engine = new Engine(bundle, {
    seed: SEED,
    // Dev diagnostic: the runtime never writes to the console itself. This
    // names the trap `resume` below avoids, should anyone reintroduce it.
    onReplacedFlow: (id, dealt) => console.warn(
      `openFlow("${id}") replaced a flow holding ${dealt} dealt card(s): after a load, use getFlow`),
  });
  flow = engine.openFlow(FLOW);

  // What am I playing? `describeBundle` is the bundle read back: its identity
  // and a summary of what is in it. A game wants this the moment a playtester
  // says "it did something odd" - the version and the content hash say exactly
  // which build they were on.
  //
  // Note what it does NOT carry: a human name for the project. The bundle's
  // `content.project` is the project ID (a save must agree with it), and the
  // authored name is not compiled in even at `metadata: full`. So the game's
  // title is the game's own, as a shipped game's title always is.
  const about = describeBundle(bundle);
  $("build").textContent = `v${about.identity.version} · ${about.identity.hash} · ${about.hands.length} places`;

  world = mountMap($("map"), maps, go);

  const saved = localStorage.getItem(SAVE_KEY);
  if (saved !== null) resume(saved);
  else opening();
  render();
}

/** A fresh game: deal every place once, so the world has something in it. */
function opening(): void {
  flow.dealMany();
  note("You come over the rise, and the valley opens below you.");
}

/** A resumed one. The engine's own save envelope carries the whole run; where
 *  the player was standing is the GAME's, so it rides alongside. */
function resume(saved: string): void {
  try {
    const parsed = JSON.parse(saved) as { engine: string; at: string | null };
    deserializeState(engine, parsed.engine);
    // A LOAD REBUILDS THE FLOWS, so the handle from before it is inert. Take a
    // fresh one. This is the trap worth showing: the old handle keeps working
    // syntactically and stops doing anything, which is a bug you find later.
    const restored = engine.getFlow(FLOW);
    if (restored === undefined) throw new Error(`the save has no "${FLOW}" flow`);
    flow = restored;
    at = parsed.at;
    note("You pick up where you left off.");
  } catch {
    localStorage.removeItem(SAVE_KEY);
    opening();
  }
}

function save(): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify({ engine: serializeState(engine), at }));
}

/** Go somewhere. A site is a HAND, so arriving means dealing it: what is
 *  eligible HERE, ranked, up to the hand's slots. */
function go(site: string | null): void {
  at = site;
  closeCard();
  if (site !== null) flow.deal(site);
  render();
  save();
}

/** Take an outcome. This is the only thing in the client that changes the
 *  world: the engine applies the outcome's changes, and everything the player
 *  can do next follows from that.
 *
 *  Note what is NOT here. There is no `setProperty` anywhere in this client.
 *  A game does not write @story behind the engine's back; it plays an outcome
 *  and lets the project's own changes say what that meant. */
function take(card: DealtCard, outcome: OutcomeView): void {
  flow.play(card.id, outcome.gameId, at!);
  note(outcome.purpose ?? outcome.title ?? outcome.gameId);

  // TIME IS THE PROJECT'S POLICY, NOT THE CLIENT'S. `play` already advanced
  // the clock, because the Village's own settings say `playAdvancesTurns: 1`.
  // The first cut of this file called `advanceTurns` here as well, so every
  // choice cost two turns and quietly broke every redraw and cooldown the
  // designer had tuned. The client spends no time of its own here.
  //
  // `advanceTurns` is for time the GAME spends that the engine cannot see:
  // travelling, resting, a night passing. That is what `wait` below does.

  // RE-PRIME EVERYWHERE, not just here. What you did may have unlocked a card
  // three zones away, and the map says which places have something waiting -
  // so a board that is only fresh where you are standing is a map that lies.
  // (That was the first cut's bug: play the opening card, walk back out to the
  // map, and the whole valley reported nothing, because every other hand had
  // last been dealt at turn 0 when nothing was eligible yet.)
  flow.dealMany();
  render();
  // ...and STAY IN THE CARD to say what happened. Closing straight back to the
  // map made every choice feel inert: the world had moved, but the only word
  // about it was a line that appeared in the journal behind you. The outcome's
  // own purpose is the designer's account of the consequence, and it is the
  // whole reason they wrote it, so it gets the screen it was written for.
  showResult(card, outcome);
  save();
}

/** What just happened, in the same panel, with one way onward. */
function showResult(card: DealtCard, outcome: OutcomeView): void {
  $("cardview-title").textContent = outcome.title ?? card.title ?? card.gameId;
  $("cardview-purpose").textContent = outcome.purpose ?? outcome.title ?? "";
  const onward = el("button", { className: "choice onward", onClick: closeCard });
  onward.append(el("span", { className: "choice-title", text: "Onwards" }));
  $("cardview-choices").replaceChildren(onward);
  onward.focus();
}

/** Let time pass without doing anything, which is a real move in a world where
 *  cards come back on a cooldown. This is the client's own use of the clock,
 *  and the only place it touches it. */
function wait(): void {
  flow.advanceTurns(box(), 1);
  note("Time passes.");
  flow.dealMany();   // a cooldown may have expired anywhere, so re-prime everywhere
  render();
  save();
}

function restart(): void {
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}

// --- drawing ----------------------------------------------------------------

function render(): void {
  // ONE ask for the whole board, shared by the map and the place. `board()` is
  // the state of every table in the box, which is exactly what a player is
  // looking at: the map says where something is waiting, the panel says what.
  const board = flow.board(box());
  $("turn").textContent = `Turn ${flow.turn(box())}`;
  renderPlace(board);
  renderSheet();
  world.update({ at, counts: Object.fromEntries(Object.entries(board).map(([h, cards]) => [h, cards.length])) });
}

/** The player's own state, as a game shows it rather than as a debug table.
 *
 *  `listProperties` is every declared property with its live value; the client
 *  picks the ones a player should see (the story's, which is where the Village
 *  keeps its qualities and its lore) and leaves the machinery alone. Reading
 *  ONE of them is `getProperty`, shown here for the turn-by-turn line.
 *
 *  Reading state is fine. WRITING it from here would not be: see the note on
 *  `take`. */
function renderSheet(): void {
  // Only what has actually HAPPENED to you. A property at its default is not
  // news, and a character sheet that lists every unset flag is a debug table
  // with a nicer font.
  const marked = (v: unknown): boolean =>
    v !== undefined && v !== false && v !== "" && !(Array.isArray(v) && v.length === 0);
  const rows = flow.listProperties()
    .filter((p) => p.path.startsWith("story.") && marked(p.value))
    .map((p) => {
      const value = flow.getProperty(p.path);
      const shown = Array.isArray(value) ? value.join(", ").replace(/_/g, " ") : String(value);
      return el("div", { className: "prop" },
        el("span", { className: "propname", text: p.name.replace(/_/g, " ") }),
        el("span", { className: "propvalue", text: shown }));
    });
  $("sheet").replaceChildren(...(rows.length > 0
    ? rows
    : [el("p", { className: "hint", text: "Nothing has marked you yet." })]));
}

function renderPlace(board: Record<string, DealtCard[]>): void {
  const host = $("place");
  if (at === null) {
    const waiting = Object.values(board).filter((c) => c.length > 0).length;
    host.replaceChildren(el("p", { className: "hint",
      text: waiting === 0
        ? "Nowhere has anything for you yet. Let some time pass."
        : `Somewhere to go: ${waiting} ${waiting === 1 ? "place has" : "places have"} something waiting.` }));
    return;
  }
  const here = board[at] ?? [];
  const label = maps.flatMap((m) => m.sites).find((s) => s.hand === at)?.label ?? at;
  const rows: Node[] = [el("h2", { text: label })];
  if (here.length === 0) {
    rows.push(el("p", { className: "hint", text: "Nothing is happening here just now." }));
  }
  for (const card of here) {
    rows.push(el("button", { className: "card-face", text: card.title ?? card.gameId, onClick: () => showCard(card) }));
  }
  host.replaceChildren(...rows);
}

/** Play a card: its own words, and the choices, over the map.
 *
 *  This is the one place the client shows a whole storylet, so it gets the
 *  screen. The purpose scrolls and the choices do not, because a choice you
 *  cannot see is a choice you do not have. */
function showCard(card: DealtCard): void {
  open = card;
  $("cardview-title").textContent = card.title ?? card.gameId;
  $("cardview-purpose").textContent = card.purpose ?? "";
  // `outcomes` evaluates each gate against the state RIGHT NOW, never against
  // a snapshot taken when the card was dealt.
  $("cardview-choices").replaceChildren(...flow.outcomes(card.id, at!).map((o) => {
    const choice = el("button", {
      className: `choice${o.available ? "" : " locked"}`,
      onClick: () => { if (o.available) take(card, o); },
    }) as HTMLButtonElement;
    choice.append(el("span", { className: "choice-title", text: o.title ?? o.gameId }));
    // An unavailable choice is SHOWN, not hidden: "why can I not do that" is
    // half of what a storylet system is for.
    if (!o.available) choice.append(el("span", { className: "choice-why", text: "not yet" }));
    choice.disabled = !o.available;
    return choice;
  }));
  $("cardview").hidden = false;
  $("cardview-close").focus();
}

function closeCard(): void {
  open = null;
  $("cardview").hidden = true;
}

// --- wiring -----------------------------------------------------------------

$("restart").addEventListener("click", restart);
$("wait").addEventListener("click", wait);
$("cardview-close").addEventListener("click", closeCard);
// The backdrop, and Escape: the two ways out everyone already knows.
$("cardview").addEventListener("click", (e) => { if (e.target === $("cardview")) closeCard(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open !== null) closeCard(); });
$("journal-clear").addEventListener("click", () => journal([]));
void start();
