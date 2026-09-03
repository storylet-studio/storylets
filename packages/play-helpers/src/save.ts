// ---------------------------------------------------------------------------
// Save-file plumbing over the .storyletsave file (storylets/savefile@1): the
// HOST's file - the engine's envelope (storylets/save@1, shared partitions +
// every flow) plus, when the host keeps one, its @world container. That is
// "host saves its container once, each engine saves its own envelope"
// (design/flows.md) folded into one file for the single-host case. These
// helpers are the string boundary - a foreign or malformed blob throws
// rather than corrupting a run.
// ---------------------------------------------------------------------------

import { SAVEFILE_SCHEMA, SAVE_SCHEMA } from "@storylet-studio/model";
import type { PropertyBag, SaveFile } from "@storylet-studio/model";
import type { Engine } from "@storylet-studio/runtime";

/** The current engine state (and the host's @world values, if given) as
 *  pretty-printed .storyletsave JSON. */
export function serializeState(engine: Engine, world?: PropertyBag): string {
  return JSON.stringify(saveState(engine, world), null, 2);
}

/**
 * Capture the whole engine (and the host's @world values, if it keeps any) as
 * the tagged save-file OBJECT.
 *
 * Four verbs, in Patterplay's pairing (`patter` play-helpers `save.ts`, and
 * the same in all four of its runtimes): saveState / loadState work on the
 * PARSED object, serializeState / deserializeState work on TEXT.
 *
 * This reference had a different shape until 2026-08-29 - `deserializeState`
 * parsed and did not restore, `loadState` took text - so one name meant two
 * things across the four Storylets runtimes, and neither matched the family.
 * Godot and Unreal already had Patter's shape; these two were brought to it.
 */
export function saveState(engine: Engine, world?: PropertyBag): SaveFile {
  return {
    schema: SAVEFILE_SCHEMA,
    engine: engine.saveGame(),
    ...(world !== undefined ? { world } : {}),
  };
}

/** Restore a {@link saveState} file into an engine. EVERY FLOW IS REBUILT, so
 *  the Flow handles you held before are inert: re-take them with
 *  `engine.getFlow(id)`, NOT `engine.openFlow(id)`. `openFlow` on an existing
 *  id REPLACES it, which here throws away the hand the file just restored, and
 *  the failure lands later, as `play()` refusing a card as "not dealt". (The
 *  engine's `onReplacedFlow` hook reports exactly this.) Throws on a foreign or malformed
 *  file, and the runtime's own project check still applies. Returns the file's
 *  @world values, if any - the HOST applies them to its container; the engine
 *  never touches them. */
export function loadState(engine: Engine, file: SaveFile): PropertyBag | undefined {
  if (!file || typeof file !== "object"
    || file.schema !== SAVEFILE_SCHEMA || file.engine?.schema !== SAVE_SCHEMA) {
    throw new Error(`not a storylets save (expected schema "${SAVEFILE_SCHEMA}")`);
  }
  engine.loadGame(file.engine);
  return file.world;
}

/** Parse + restore a {@link serializeState} string: the TEXT twin of
 *  loadState, as Patterplay pairs them. Throws on malformed JSON, a foreign
 *  file or a project mismatch. Returns the file's @world values for the host. */
export function deserializeState(engine: Engine, json: string): PropertyBag | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("not valid JSON");
  }
  return loadState(engine, parsed as SaveFile);
}
