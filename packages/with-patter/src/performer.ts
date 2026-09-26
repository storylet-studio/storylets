// ---------------------------------------------------------------------------
// Performing a dealt card through Patter: the card's gameId names a Patter
// scene, the scene runs, and the scene decides which of the card's outcomes
// was reached (the Storylets-with-Patter contract; the Hamlet's
// `performance.js`, lifted so a game, Storyletter's Board and the playable
// page all run the same code).
//
// The Hamlet's rules, kept exactly because they are the host's contract:
// - ONE Patter flow per performed box, named after the box, entered with
//   `goto` for each card: a flow is Patter's memory, and a fresh one per card
//   would forget its visits and restart its seeded shuffles (joint demo
//   finding 14).
// - The outcome is the LAST word: a gameEvent carrying one, else the label on
//   the option the player took, else the card's only outcome (finding 15).
// - An option is greyed when either engine says no: Patter's `eligible`, or
//   the Storylet Engine's gate on the outcome the option names.
//
// This module knows nothing of the DOM, or of the Storylet Engine: the host
// deals, draws what `start` and `choose` return, and plays the outcome.
// ---------------------------------------------------------------------------

import type { Bundle as PatterBundle, Engine as PatterEngine, Flow as PatterFlow, StepResult } from "@patterkit/runtime";

/**
 * A card's scene reference (its gameId) to the scene's internal id, as Patter's runtime resolves a
 * reference: an internal id first, else a scene's address by Patter's own rules. Undefined when no
 * scene matches.
 */
export function sceneIdFor(engine: PatterEngine, bundle: PatterBundle, ref: string): string | undefined {
  if (bundle.scenes[ref]) return ref;
  return Object.keys(bundle.scenes).find((id) => engine.sceneAddress(id) === ref);
}

/** One thing the scene has said, for the transcript. */
export type Beat =
  | { kind: "line"; who?: string; text: string }
  | { kind: "text"; text: string }
  /** The player's pick, shown back in the transcript. */
  | { kind: "chose"; text: string };

export interface SceneOption {
  id: string;
  text: string;
  /** False when Patter's condition fails, or the outcome it names is gated shut. */
  enabled: boolean;
  /** The outcome the option names, when it names one. */
  outcome?: string;
}

/** A card being performed: what has been said, and what the player can do now. */
export interface Performance {
  card: string;
  box: string;
  /** The scene's internal id, for reporting the position to Patterpad. */
  sceneId?: string;
  transcript: Beat[];
  /** The choice on screen, when the scene is waiting on one. */
  options?: SceneOption[];
  /** True once the scene has run to its end. */
  ended: boolean;
  /** The outcome the scene reached (last word wins); undefined until it ends, and after it
   *  ends when nothing named one and the card has several. */
  outcome?: string;
  /** Why the scene cannot be performed, or why it ended without an outcome. */
  problem?: string;
  /** Bookkeeping for the resolution. */
  lastEvent?: string;
  lastLabel?: string;
}

/** An outcome of the card, as the Storylet Engine reports it (`Table.outcomes`). */
export interface CardOutcome { gameId: string; available: boolean }

/** Where the Board reports its position, so Patterpad's playhead follows the line being played:
 *  the subset of play-helpers' `DebugLink` this needs. */
export interface PerformerLink {
  flowOpened(flowId: string): void;
  observe(flowId: string, sceneId: string | null, beatId: string | null, type: string, choiceId?: string): void;
}

/** A guard against a scene that loops without asking anything. */
const MAX_STEPS = 500;

export class Performer {
  /** Where to report the position; set once Patterpad's Live Link is up. */
  link: PerformerLink | undefined;

  constructor(
    private patter: PatterEngine,
    private readonly boxes: ReadonlySet<string>,
    /** A card's scene reference (its gameId) to the scene's internal id, as the runtime resolves it. */
    private readonly sceneIdOf: (ref: string) => string | undefined = () => undefined,
  ) {}

  /** A live refresh replaced the engine (a structural hot swap): carry on with the new one. */
  setEngine(patter: PatterEngine): void {
    this.patter = patter;
  }

  /** Does the project say Patter performs this box? */
  performs(boxGameId: string): boolean {
    return this.boxes.has(boxGameId);
  }

  /** Start a card's scene: its flow entered at the scene named after the card, run to the first
   *  choice or to its end. */
  start(card: { id: string; gameId: string }, boxGameId: string, outcomes: readonly CardOutcome[]): Performance {
    const sceneId = this.sceneIdOf(card.gameId);
    const p: Performance = { card: card.id, box: boxGameId, transcript: [], ended: false, ...(sceneId !== undefined ? { sceneId } : {}) };
    let flow: PatterFlow;
    try {
      // The engine's own answer, not a list kept here: a loaded save brings its flows back.
      const existing = this.patter.getFlow(boxGameId);
      if (existing) {
        if (!existing.goto(card.gameId)) return { ...p, ended: true, problem: `The Patter project has no scene named "${card.gameId}".` };
        flow = existing;
      } else {
        flow = this.patter.openFlow(boxGameId, { scene: card.gameId });
        this.link?.flowOpened(boxGameId);
      }
    } catch (e) {
      return { ...p, ended: true, problem: `The Patter project has no scene named "${card.gameId}" (${e instanceof Error ? e.message : String(e)}).` };
    }
    return this.run(p, flow, outcomes);
  }

  /** The player picks an option; the scene runs on to its next choice or its end. */
  choose(p: Performance, optionId: string, outcomes: readonly CardOutcome[]): Performance {
    const flow = this.patter.getFlow(p.box);
    const option = p.options?.find((o) => o.id === optionId);
    if (!flow || !option || !option.enabled) return p;
    flow.choose(optionId);
    this.link?.observe(p.box, p.sceneId ?? null, null, "choose", optionId);
    const next: Performance = {
      ...p, options: undefined, transcript: [...p.transcript, { kind: "chose", text: option.text }],
      ...(option.outcome !== undefined ? { lastLabel: option.outcome } : {}),
    };
    return this.run(next, flow, outcomes);
  }

  /** A new run: every box's flow closes, so the next card opens a fresh one. Patter's own
   *  properties are the registry's, and the Board resets those with the rest. */
  reset(): void {
    for (const box of this.boxes) {
      if (this.patter.getFlow(box)) this.patter.closeFlow(box);
    }
  }

  private run(start: Performance, flow: PatterFlow, outcomes: readonly CardOutcome[]): Performance {
    const p: Performance = { ...start, transcript: [...start.transcript] };
    for (let i = 0; i < MAX_STEPS; i++) {
      const step: StepResult = flow.advance();
      this.link?.observe(p.box, p.sceneId ?? null, "id" in step ? step.id : null, step.type);
      if (step.type === "line") {
        p.transcript.push({ kind: "line", ...(step.characterName ?? step.character ? { who: step.characterName ?? step.character } : {}), text: step.text });
      } else if (step.type === "text") {
        p.transcript.push({ kind: "text", text: step.text });
      } else if (step.type === "gameEvent") {
        const named = step.gameData?.["outcome"];
        if (typeof named === "string") p.lastEvent = named;
      } else if (step.type === "choice") {
        p.options = step.options.map((o) => {
          const named = o.gameData?.["outcome"];
          const outcome = typeof named === "string" ? named : undefined;
          // Two gates, each engine's own: Patter's condition, and ours on the outcome it names.
          const shut = outcome !== undefined && outcomes.find((x) => x.gameId === outcome)?.available === false;
          return { id: o.id, text: o.prompt?.text || o.id, enabled: o.eligible && !shut, ...(outcome !== undefined ? { outcome } : {}) };
        });
        return p;
      } else {
        return this.finish(p, outcomes);
      }
    }
    return { ...p, ended: true, problem: `The scene ran ${MAX_STEPS} steps without a choice or an end.` };
  }

  /** Last word wins: an event, else the option's label, else the card's only outcome. */
  private finish(p: Performance, outcomes: readonly CardOutcome[]): Performance {
    const reached = p.lastEvent ?? p.lastLabel ?? (outcomes.length === 1 ? outcomes[0]!.gameId : undefined);
    if (reached === undefined) {
      return { ...p, ended: true, problem: "The scene ended without saying which outcome it reached." };
    }
    if (!outcomes.some((o) => o.gameId === reached)) {
      return { ...p, ended: true, problem: `The scene reached "${reached}", which this card doesn't have.` };
    }
    return { ...p, ended: true, outcome: reached };
  }
}
