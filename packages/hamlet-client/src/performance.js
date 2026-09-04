// ---------------------------------------------------------------------------
// The handoff, on its own, because it is the thing this sample exists to show.
//
// Storylets chooses the beat; Patter performs it (Reboot.md 10). The contract
// is entirely by name:
//
//   a card's gameId IS its Patter scene id
//   an outcome's gameId IS what the scene reports, in a gameEvent's
//     gameData.outcome, at the end of whichever branch it took
//   the host keeps ONE Patter flow per box it performs, named after the box
//
// Nothing declares either link, so nothing can half-declare one. What keeps it
// honest is the build-time cross-check (scripts/pairing.mjs), not a field.
// ---------------------------------------------------------------------------
/**
 * Enter the scene named by a card, on the ONE flow this host keeps for the box,
 * and run it to its next stop: either a choice the player must answer, or the end.
 *
 * The flow is opened once, when the game starts, and found again after a
 * load; a card is a `goto` on it, never a fresh flow. That is what keeps
 * Patter's memory: the flow's visit counts, shuffle cursors and PRNG carry on
 * from one performance to the next, so a scene that shuffles its lines shows a
 * different one each visit, and one that remembers what it said still does.
 * A flow whose last scene ended resumes at the new address (goto moves the
 * cursor and resets nothing). In a bigger project: one flow per box that Patter
 * performs, named after the box, as this one is.
 */
function perform(flow, cardGameId) {
    if (!flow.goto(cardGameId))
        throw new Error(`no Patter scene "${cardGameId}"`);
    return run(flow, { shown: [], choices: [], outcome: null, done: false });
}
/**
 * Pick a performance back up after a reload.
 *
 * Patter has already restored the flow's position through `loadGame`, and a
 * flow paused at a choice comes back still paused: `getChoices()` returns the
 * pending options, prompts and all. So the engine needs no help.
 *
 * What the host must supply is the TRANSCRIPT. The lines already spoken are
 * presentation, not engine state - Patter hands each beat to the host once and
 * does not keep them - so a host that wants the conversation still on screen
 * after a reload has to have saved them itself. That is the host's job, but it
 * is easy to miss, because everything else about the resume is free.
 */
function resume(flow, shown, outcome) {
    const choices = flow.getChoices().filter((o) => o.eligible).map((o) => ({ id: o.id, text: o.prompt?.text ?? o.id }));
    return { shown, choices, outcome, done: false };
}
/** Answer the open choice and carry on to the next stop. */
function answer(flow, state, optionId) {
    flow.choose(optionId);
    return run(flow, { ...state, choices: [] });
}
/** The step loop. Every host that plays Patter has one of these; ours is only
 *  unusual in what it does with a gameEvent. */
function run(flow, state) {
    for (;;) {
        const step = flow.advance();
        switch (step.type) {
            case "line":
                state.shown.push({ kind: "line", character: step.characterName || step.character || "", text: step.text ?? "" });
                break;
            case "text":
                state.shown.push({ kind: "text", text: step.text ?? "" });
                break;
            case "gameEvent": {
                // THE SEAM. Any other host cue would be a sound or a camera move; this
                // one is the scene saying which of the card's outcomes it reached.
                const outcome = step.gameData?.["outcome"];
                if (typeof outcome === "string")
                    state.outcome = outcome;
                break;
            }
            case "choice":
                state.choices = step.options
                    .filter((o) => o.eligible)
                    .map((o) => ({ id: o.id, text: o.prompt?.text ?? o.id }));
                return state;
            case "end":
                state.done = true;
                return state;
        }
    }
}
