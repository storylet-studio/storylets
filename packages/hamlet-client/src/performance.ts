// ---------------------------------------------------------------------------
// The handoff, on its own, because it is the thing this sample exists to show.
//
// Storylets chooses the beat; Patter performs it (Reboot.md 10). The contract
// is entirely by name:
//
//   a card's gameId IS its Patter scene id
//   an outcome's gameId IS what the scene reports, in a gameEvent's
//     gameData.outcome, at the end of whichever branch it took
//
// Nothing declares either link, so nothing can half-declare one. What keeps it
// honest is the build-time cross-check (scripts/pairing.mjs), not a field.
// ---------------------------------------------------------------------------

import type { Engine as PatterEngine, Flow as PatterFlow, StepResult } from "@patterkit/runtime";

/** What the host shows while a scene plays. */
export type Shown =
  | { kind: "line"; character: string; text: string }
  | { kind: "text"; text: string };

export type Choice = { id: string; text: string };

/** Where a performance has got to. `outcome` is set once the scene has said
 *  what happened, which is the only thing the storylet side needs back. */
export interface Performance {
  shown: Shown[];
  choices: Choice[];
  outcome: string | null;
  done: boolean;
}

/**
 * Open the scene named by a card and run it to its next stop: either a choice
 * the player must answer, or the end.
 *
 * The flow id is the HOST'S name for "the conversation currently on screen",
 * not the scene's. `openFlow` replaces any flow of that id, which is what a
 * fresh performance wants: each card is performed from the top.
 */
export function perform(patter: PatterEngine, cardGameId: string): { flow: PatterFlow; state: Performance } {
  const flow = patter.openFlow("performance", { scene: cardGameId });
  return { flow, state: run(flow, { shown: [], choices: [], outcome: null, done: false }) };
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
export function resume(patter: PatterEngine, shown: Shown[], outcome: string | null): { flow: PatterFlow; state: Performance } | null {
  const flow = patter.getFlow("performance");
  if (!flow) return null;
  const choices = flow.getChoices().filter((o) => o.eligible).map((o) => ({ id: o.id, text: o.prompt?.text ?? o.id }));
  return { flow, state: { shown, choices, outcome, done: false } };
}

/** Answer the open choice and carry on to the next stop. */
export function answer(flow: PatterFlow, state: Performance, optionId: string): Performance {
  flow.choose(optionId);
  return run(flow, { ...state, choices: [] });
}

/** The step loop. Every host that plays Patter has one of these; ours is only
 *  unusual in what it does with a gameEvent. */
function run(flow: PatterFlow, state: Performance): Performance {
  for (;;) {
    const step: StepResult = flow.advance();
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
        if (typeof outcome === "string") state.outcome = outcome;
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
