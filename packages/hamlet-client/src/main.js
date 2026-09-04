// ---------------------------------------------------------------------------
// The Hamlet: one browser game running TWO engines.
//
//   the Storylet Engine decides WHICH beat happens, and when
//   Patter performs that beat's dialogue
//   the host owns @world, and hands the SAME resolver to both
//
// Read it in that order. `world.ts` is the shared surface, `performance.ts` is
// the handoff, and this file is the game around them.
//
// What is deliberately absent: neither engine is told the other exists. There
// is no adapter, no bridge, no shared library between them. The only thing
// joining them is a naming convention (Reboot.md 10) and the world object.
// ---------------------------------------------------------------------------
/// <reference lib="dom" />
// No build step, no imports. Two classic scripts (storyletengine.min.js,
// patterplay.min.js) define the two globals this page reads: `StoryletEngine`,
// the runtime with its helpers on it, and `Patterplay`, Patter's. world.js and
// performance.js are plain scripts loaded before this one, so `World`,
// `perform`, `resume` and `answer` are already here.
const { describeBundle, serializeState, deserializeState } = StoryletEngine;
const { serializeState: patterSerialize, deserializeState: patterDeserialize } = Patterplay;
const SAVE_KEY = "the-hamlet/save@1";
const SEED = 7;
const FLOW = "main";
/** The box this host performs through Patter, and the name of its one Patter flow. */
const BOX = "village";
const $ = (id) => document.getElementById(id);
let world;
let storylets;
let story;
let patter;
let places;
let at = null;
/** The card being performed, and the Patter flow performing it. */
/** `flow` is null once the scene has ended: the transcript stays on stage until
 *  the player continues, and an ended flow is nothing the host needs. */
/** The one Patter flow for the box this host performs (`village`): opened once,
 *  found again after a load, entered per card with goto. Never re-opened. */
let performance;
/** The card being performed. `done` in the state means the scene has ended
 *  and its lines wait on the Continue button. */
let playing = null;
const log = [];
async function boot() {
    const [storyletBundle, patterBundle] = await Promise.all([
        fetch("hamlet.storyletsc").then((r) => r.json()),
        fetch("hamlet.patterc").then((r) => r.json()),
    ]);
    // ONE world, handed to BOTH. This is the coexistence design, and it is a
    // single shared object rather than two copies kept in step, because two
    // copies kept in step is the bug this design exists to make impossible.
    // Time is the game's alone: neither story may move it. Both projects say the
    // same (writable: false); this is the game holding them to it at runtime.
    world = new World({ time_of_day: "day", knows_road: false }); // nothing read-only: both projects let a scene or a card move time
    storylets = new StoryletEngine.Engine(storyletBundle, {
        seed: SEED,
        world: world.resolver,
        // Dev diagnostic, wired here because the runtime never touches the console
        // itself. This is the trap the first cut of this client fell into.
        onReplacedFlow: (id, dealt) => console.warn(`openFlow("${id}") replaced a flow holding ${dealt} dealt card(s): after a load, use getFlow`),
    });
    patter = new Patterplay.Engine(patterBundle, { seed: SEED, world: world.resolver });
    story = storylets.openFlow(FLOW);
    performance = patter.openFlow(BOX); // once; every card is a goto on it
    const about = describeBundle(storyletBundle);
    places = (storyletBundle.boxes[0].hands ?? []).map((h) => ({ gameId: h.gameId, title: h.title ?? h.gameId }));
    $("title").textContent = about.title ?? "The Hamlet";
    if (!restore()) {
        story.dealMany();
        // Open where there is something to do: the first hand that deals a card.
        // The project does not order its hands for this (the demo opens with one
        // card, at the gate), so the host looks rather than guessing a place.
        const first = places.find((p) => story.deal(p.gameId).length > 0);
        if (first) at = first.gameId;
    }
    world.onChange = render;
    render();
}
// --- the loop ---------------------------------------------------------------
/** Arrive somewhere. A place is a HAND, so arriving means dealing it. */
function go(place) {
    at = place;
    playing = null;
    if (place !== null)
        story.deal(place);
    render();
    save();
}
/** Pick a card: the storylet side has chosen the beat, so Patter now performs
 *  it. The scene is found BY NAME - the card's own gameId - and nothing had to
 *  be declared to make that work. */
function start(card) {
    playing = { card, state: perform(performance, card.gameId) };
    save(); // mid-scene is a savable moment, not just between cards
    render();
}
function choose(optionId) {
    if (!playing)
        return;
    playing.state = answer(performance, playing.state, optionId);
    save();
    render();
}
/** The scene has ended and the player has read it (the Continue button). It
 *  reported which outcome it reached, and THAT is what the storylet engine
 *  plays: the world moves because of what happened in the dialogue, which is
 *  the whole point of running the two together. The outcome is NOT played the
 *  moment the scene ends: its closing lines, and the whole of a scene with no
 *  choice in it, would vanish under the redeal before anyone read them. */
function finish() {
    if (!playing || !playing.state.done)
        return;
    const { card, state } = playing;
    if (state.outcome === null) {
        // Loud, not silent. The build-time cross-check should have caught this, so
        // reaching it means the bundles on disk are not the ones that were checked.
        throw new Error(`scene "${card.gameId}" ended without reporting an outcome`);
    }
    story.play(card.id, state.outcome, at);
    log.unshift(`${card.title ?? card.gameId}: ${state.outcome}`);
    playing = null;
    // Re-prime EVERYWHERE, not just here: the outcome's changes, and anything the
    // scene wrote to @world, may have re-gated content in another place. The
    // Village does the same after a play. Know what a refresh does, though:
    // `dealMany` evicts cards no longer eligible and fills EMPTY slots, and a
    // card that is still eligible keeps its seat. So a card that became eligible
    // in a full hand (the tree has one slot) waits until the player acts there.
    // That is the engine's stability rule, not a bug, and the test pins it.
    story.dealMany();
    save();
    render();
}
/** Time passes. The world is the HOST'S, so this is the host's to change, and
 *  both engines see it at once because both hold the same resolver. */
function wait() {
    world.set("time_of_day", world.get("time_of_day") === "day" ? "night" : "day");
    story.advanceTurns(storyletBundle_boxGameId(), 1);
    story.dealMany();
    save();
    render();
}
const storyletBundle_boxGameId = () => story.listBoxes()[0].gameId;
// --- the joint save ---------------------------------------------------------
// One host-composed save, which falls straight out of the owned/foreign split:
// each engine serialises only what IT owns, and the host saves @world once,
// itself. Neither engine puts @world in its own envelope, so nothing is
// written twice and nothing can disagree on reload.
function save() {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
        storylets: serializeState(storylets),
        // Patter's half as ITS OWN text envelope (patter/save@0, via its play-helpers),
        // exactly as the storylet half above is ours. Never the raw saveGame() object:
        // the family's serializer is what the other runtimes load.
        patter: patterSerialize(patter),
        world: world.save(),
        at,
        // A save taken MID-SCENE is the one that matters, and the one a first cut
        // gets wrong: `patter.saveGame()` already holds the flow's position, so the
        // engine resumes itself, but nothing in either engine knows that the host
        // was in the middle of performing a card, or what had been said. Those two
        // are the host's, so the host saves them.
        performing: playing && {
            card: { id: playing.card.id, gameId: playing.card.gameId, title: playing.card.title },
            shown: playing.state.shown,
            outcome: playing.state.outcome,
            done: playing.state.done,
        },
    }));
}
function restore() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw)
        return false;
    try {
        const s = JSON.parse(raw);
        world.load(s.world ?? {});
        deserializeState(storylets, s.storylets);
        if (typeof s.patter === "string")
            patterDeserialize(patter, s.patter);
        else
            patter.loadGame(s.patter);
        // A LOAD REBUILDS THE FLOWS, and `openFlow` on an id that exists REPLACES
        // it with a fresh one - so calling it here would throw away the hand the
        // save just restored, and finishing a resumed card would be refused with
        // `card "x" is not dealt to hand "y"`. `getFlow` is the call. The Village
        // client says exactly this and calls it "the trap worth showing"; this
        // client was written with that file open and fell into it anyway, then
        // "fixed" it by re-dealing, which passed the test and was still wrong.
        const restored = storylets.getFlow(FLOW);
        if (restored === undefined)
            throw new Error(`the save has no "${FLOW}" flow`);
        story = restored;
        const perf = patter.getFlow(BOX);
        if (!perf)
            throw new Error(`the save has no "${BOX}" Patter flow`);
        performance = perf;
        at = s.at ?? null;
        // Back into the conversation, if we were in one. `resume` reads the pending
        // choice off the restored flow; the transcript comes from the envelope.
        if (s.performing) {
            const shown = (s.performing.shown ?? []);
            const outcome = s.performing.outcome ?? null;
            if (s.performing.done) {
                // The scene had ended and the player had not yet continued: nothing
                // to ask Patter for, the transcript and the outcome are the envelope's.
                playing = { card: s.performing.card, state: { shown, choices: [], outcome, done: true } };
            }
            else {
                playing = { card: s.performing.card, state: resume(performance, shown, outcome) };
            }
        }
        return true;
    }
    catch {
        localStorage.removeItem(SAVE_KEY);
        return false;
    }
}
// --- drawing ----------------------------------------------------------------
function render() {
    // The whole shared @world, as one line: what BOTH engines currently see.
    $("clock").textContent = Object.entries(world.save())
        .map(([k, v]) => (typeof v === "boolean" ? (v ? k : "") : String(v))).filter(Boolean).join(" · ");
    $("places").replaceChildren(...places.map((p) => {
        const b = document.createElement("button");
        b.textContent = p.title;
        b.className = p.gameId === at ? "place here" : "place";
        b.onclick = () => go(p.gameId);
        return b;
    }));
    const stage = $("stage");
    if (playing) {
        const lines = playing.state.shown.map((s) => {
            const d = document.createElement("p");
            d.className = s.kind;
            d.textContent = s.kind === "line" ? `${s.character}: ${s.text}` : s.text;
            return d;
        });
        const opts = playing.state.choices.map((c) => {
            const b = document.createElement("button");
            b.textContent = c.text;
            b.className = "option";
            b.onclick = () => choose(c.id);
            return b;
        });
        if (playing.state.done) {
            const b = document.createElement("button");
            b.textContent = "Continue";
            b.className = "option continue";
            b.onclick = finish;
            opts.push(b);
        }
        stage.replaceChildren(...lines, ...opts);
    }
    else if (at === null) {
        const p = document.createElement("p");
        p.className = "text";
        p.textContent = "Choose somewhere to be.";
        stage.replaceChildren(p);
    }
    else {
        const cards = story.deal(at).map((card) => {
            const b = document.createElement("button");
            b.className = "card";
            b.textContent = card.title ?? card.gameId;
            b.onclick = () => start(card);
            return b;
        });
        stage.replaceChildren(...(cards.length ? cards : [Object.assign(document.createElement("p"), { className: "text", textContent: "Nothing here just now." })]));
    }
    $("log").replaceChildren(...log.slice(0, 8).map((l) => Object.assign(document.createElement("li"), { textContent: l })));
}
$("wait").onclick = wait;
$("leave").onclick = () => go(null);
// A restart is the one thing the engines cannot do for you: their state is the
// playthrough. Forget the save and boot again from the bundles.
$("restart").onclick = () => { localStorage.removeItem(SAVE_KEY); location.reload(); };
void boot();
