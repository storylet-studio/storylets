// ---------------------------------------------------------------------------
// A quality's stage renamed where it is used, and a reorder said out loud
// (ops `stages.ts`; patterkit design/proposals/patter-qualities.md section 2).
//
// A rename rewrites the declaration and every value and literal naming the
// stage in ONE commit, so one undo puts all of it back: a rename that landed
// half-way would leave cards quietly off the ladder. The declaration lists
// hand renames here instead of saving through their own autosave.
// ---------------------------------------------------------------------------

import { canonicalStringify, projectDialect, worldDeclarations } from "@storylet-studio/compiler";
import { projectMapPath, renameStage, stageGateCount } from "@storylet-studio/ops";
import type { StageTarget } from "@storylet-studio/ops";
import type { FileState } from "../history.js";
import { gameWorldWrite } from "../game-scopes.js";
import type { ProjectSession } from "../project.js";
import { commit, freshKey, reload } from "./write-path.js";
import type { Written } from "./write-path.js";
import { boxWrite, deckWrite, handsWrite, projectWrite, tagsWrite } from "./shards.js";

/** Rename `from` to `to` on the quality `target` names, carrying every value
 *  and literal that names it. */
export async function renameQualityStage(session: ProjectSession, target: StageTarget, from: string, to: string): Promise<Written> {
  const source = session.loaded.source;
  if (!source) return { error: "no project open" };
  // A shared @world is declared in the game's own file first and copied into
  // the project, as the World settings save it.
  if (target.kind === "property" && target.scope === "world") source.project.world.properties = [...worldDeclarations(source)];
  const result = renameStage(source, target, from, to, projectDialect(source));
  // Nothing to carry: the quality isn't saved under that name yet (its row was
  // renamed in the same moment), or the ladder holds both names. The list's own
  // save, queued behind this, still renames the declaration.
  if (!result) return reload(session);

  const writes: FileState[] = [];
  if (target.kind === "property" && target.scope === "world") {
    const shared = gameWorldWrite(source, source.project.world.properties);
    if ("error" in shared) return shared;
    writes.push(...shared);
  }
  if (result.project) writes.push(projectWrite(session));
  if (result.map && source.map) writes.push({ path: projectMapPath(session.loaded.dir), content: canonicalStringify(source.map) });
  for (const box of result.boxes) writes.push(boxWrite(session, box));
  for (const box of result.tags) writes.push(tagsWrite(session, box));
  for (const box of result.hands) writes.push(handsWrite(session, box));
  for (const deck of result.decks) writes.push(deckWrite(session, deck));
  // Already declared under the new name and nothing names the old one.
  if (writes.length === 0) return reload(session);
  return commit(session, `Rename stage “${from}”`, freshKey(), writes);
}

/** How many gates order against the target's ladder: what a reorder changes
 *  the meaning of. */
export function stageGates(session: ProjectSession, target: StageTarget): number {
  const source = session.loaded.source;
  return source ? stageGateCount(source, target, projectDialect(source)) : 0;
}
