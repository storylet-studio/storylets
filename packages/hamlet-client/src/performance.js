// ---------------------------------------------------------------------------
// The handoff, on its own, because it is the thing this sample exists to show.
//
// Storylets chooses the beat; Patter performs it (Reboot.md 10). The contract
// is entirely by name:
//
//   a card's gameId IS its Patter scene id
//   the host keeps ONE Patter flow per box it performs, named after the box
//
// And the outcome, which the scene resolves in three steps, LAST WORD WINS:
//
//   1. a gameEvent's gameData.outcome, wherever one fires, beats everything
//      after it (the scene deciding late, having played the dialogue)
//   2. otherwise the outcome named on the option the player took
//   3. otherwise the card's only outcome, when it has exactly one
//
// So a scene with no choice says nothing at all, and a scene with a choice
// labels its options. A gameEvent is the escape hatch, not the routine case.
// Nothing declares either link, so nothing can half-declare one. What keeps it
// honest is the build-time cross-check (scripts/pairing.mjs), not a field.
//
// TWO GATES ON ONE OPTION, and each engine owns its own. Patter says whether
// the option can be offered at all (its own condition, on state we share or
// state only it can see); the Storylet Engine says whether the outcome that
// option leads to is open (a condition on @story or @deck, which Patter cannot
// read). An option is clickable only when both agree, and greyed with a reason
// when either does not.
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
 *
 * `open` is the set of outcome ids the Storylet Engine will currently accept,
 * from `flow.outcomes(cardId, hand)`. Pass it fresh at every stop: a scene can
 * write @world mid-performance and change what is open under itself.
 */
function perform(flow, cardGameId, open) {
  if (!flow.goto(cardGameId)) throw new Error(`no Patter scene "${cardGameId}"`);
  return run(flow, { shown: [], choices: [], outcome: null, labelled: null, done: false }, open);
}

/**
 * Pick a performance back up after a reload.
 *
 * Patter has already restored the flow's position through `loadGame`, and a
 * flow paused at a choice comes back still paused: `getChoices()` returns the
 * pending options, prompts and all. So the engine needs no help.
 *
 * What the host must supply is the TRANSCRIPT, and the outcome the performance
 * had settled on so far. The lines already spoken are presentation, not engine
 * state, and so is a label taken from an option two choices back: Patter hands
 * each beat to the host once and does not keep them. That is the host's job,
 * but it is easy to miss, because everything else about the resume is free.
 */
function resume(flow, shown, outcome, labelled, open) {
  return {
    shown,
    choices: choicesFrom(flow.getChoices(), open),
    outcome,
    labelled: labelled ?? null,
    done: false,
  };
}

/** Answer the open choice and carry on to the next stop. */
function answer(flow, state, optionId, open) {
  // The label rides with the option, so it is taken HERE, while the host still
  // knows which option was clicked. By the end of the branch it is gone.
  const picked = state.choices.find((c) => c.id === optionId);
  const next = { ...state, labelled: picked?.outcome ?? state.labelled, choices: [] };
  flow.choose(optionId);
  return run(flow, next, open);
}

/**
 * Which outcome the performance reached, by the three steps above.
 *
 * Throws when the scene said nothing and the card has more than one outcome:
 * the host cannot guess, and guessing wrong would move the world the wrong way.
 * The build catches this shape before a player can (scripts/pairing.mjs); this
 * is the backstop for a bundle that was never checked.
 */
function resolveOutcome(state, declared, cardGameId) {
  if (state.outcome) return state.outcome;
  if (state.labelled) return state.labelled;
  if (declared.length === 1) return declared[0];
  throw new Error(
    `scene "${cardGameId}" ended without saying which outcome it reached, and its card declares `
    + `${declared.length} (${declared.join(", ")}). Label the options, or fire a gameEvent.`,
  );
}

/** The choices a step offers, each with both engines' gates already applied. */
function choicesFrom(options, open) {
  return options.map((o) => {
    const outcome = o.gameData?.outcome ?? null;
    const shut = outcome !== null && !open.has(outcome);
    return {
      id: o.id,
      text: o.prompt?.text ?? o.id,
      outcome,
      enabled: o.eligible && !shut,
      // Shown to the player beside a greyed option. Plain here because the demo
      // is explaining a mechanism; a real game would write it in its own voice
      // ("Word of you has not spread far enough yet").
      why: !o.eligible ? "not available here" : shut ? `requirements not met` : "",
    };
  });
}

/** The step loop. Every host that plays Patter has one of these; ours is only
 *  unusual in what it does with a gameEvent. */
function run(flow, state, open) {
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
        // THE SEAM, and the escape hatch. Any other host cue would be a sound
        // or a camera move; this one is the scene overruling the option's
        // label, because the dialogue decided something the choice could not.
        const outcome = step.gameData?.["outcome"];
        if (typeof outcome === "string") state.outcome = outcome;
        break;
      }
      case "choice":
        state.choices = choicesFrom(step.options, open);
        return state;
      case "end":
        state.done = true;
        return state;
    }
  }
}
