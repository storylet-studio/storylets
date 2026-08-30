// ---------------------------------------------------------------------------
// The peek/deal ops: compile the project in memory, stand up a reference
// session, apply any state overrides, and ask - the writer's quickest answer
// to "what would this hand / this peek give me right now?".
// ---------------------------------------------------------------------------

import { compileProject, parseSource } from "@storylet-studio/compiler";
import type { Issue } from "@storylet-studio/compiler";
import { Engine } from "@storylet-studio/runtime";
import type { ScalarValue } from "@storylet-studio/model";
import type { LoadedProject } from "./load.js";

export interface AskOptions {
  /** Peek: the box to look at (with optional criteria). */
  box?: string;
  /** Peek criteria: tag group gameId -> tag gameId. */
  criteria?: Record<string, string>;
  /** Peek cap. */
  n?: number;
  /** Deal: the hand to refresh (by gameId). */
  hand?: string;
  /** State overrides applied before the ask, path -> value
   *  (e.g. "value.v_docks.danger" -> 3). */
  sets?: Record<string, ScalarValue>;
  seed?: number;
  /** Deal all hands first (so claims are visible in the result). */
  dealAll?: boolean;
}

export interface AskResult {
  issues: Issue[];
  cards?: { id: string; gameId: string; title?: string }[];
}

/** Parse a `k=v` flag value: JSON5 where it parses (numbers, booleans,
 *  arrays), the raw string otherwise. */
export function parseFlagValue(raw: string): ScalarValue {
  try {
    const v = parseSource(raw);
    if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  } catch {
    // fall through: a bare word is a string
  }
  return raw;
}

export function runAsk(loaded: LoadedProject, opts: AskOptions): AskResult {
  if (!loaded.source) return { issues: loaded.issues };
  const { bundle, issues } = compileProject(loaded.source);
  const all = [...loaded.issues, ...issues];
  if (!bundle) return { issues: all };

  const session = new Engine(bundle, { seed: opts.seed ?? 0 }).openFlow("main");
  try {
    for (const [path, value] of Object.entries(opts.sets ?? {})) {
      session.setProperty(path, value);
    }
    if (opts.dealAll) session.dealMany();
    const cards = opts.hand !== undefined
      ? session.deal(opts.hand)
      : session.peek(opts.box ?? bundle.boxes[0]?.gameId ?? "", opts.criteria ?? {}, opts.n).cards;
    return {
      issues: all,
      cards: cards.map((c) => ({
        id: c.id,
        gameId: c.gameId,
        ...(c.title !== undefined ? { title: c.title } : {}),
      })),
    };
  } catch (e) {
    all.push({ severity: "error", path: loaded.dir, message: e instanceof Error ? e.message : String(e) });
    return { issues: all };
  }
}
