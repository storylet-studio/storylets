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
import { locateProperty, projectMapPath, renameProperty, renameStage, stageGateCount } from "@storylet-studio/ops";
import type { StageRenameResult, StageTarget } from "@storylet-studio/ops";
import type { FileState } from "../history.js";
import { gameWorldWrite } from "../game-scopes.js";
import type { ProjectSession } from "../project.js";
import { commit, commitFolded, freshKey, reload } from "./write-path.js";
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

/** Every shard a rename touched, as writes: the game's shared @world file
 *  first when the property is a shared @world one. */
function renameWrites(session: ProjectSession, target: StageTarget, result: StageRenameResult): FileState[] | { error: string } {
  const source = session.loaded.source!;
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
  return writes;
}

/**
 * Rename the property `target` names (by its old name, `from`) to `to`, and
 * carry every reference to it: conditions, priorities, changes and their
 * keys, a tag group's binding, a hand's holes, a coverage driver (ops
 * `renameProperty`; the hands-on review, 2026-10, foundation 4). One commit,
 * so one undo puts the lot back. The list's own save, queued behind this,
 * finds the declaration already renamed; a list that saved the new name first
 * leaves only the references to carry, which this does as well.
 */
export async function renamePropertyEverywhere(session: ProjectSession, target: StageTarget, from: string, to: string): Promise<Written> {
  const source = session.loaded.source;
  if (!source) return { error: "no project open" };
  if (target.kind !== "property") return reload(session);
  if (target.scope === "world") source.project.world.properties = [...worldDeclarations(source)];
  // The list may have saved the new name already, as its own step: then the
  // references finish that step rather than make a second one, so a single
  // Undo can't leave the name renamed and the cards reading the old one.
  const savedAlready = !declares(source, target, from) && declares(source, target, to);
  const result = renameProperty(source, { ...target, name: from }, to, projectDialect(source));
  // Not a rename this can make: no such property, or the name is taken.
  if (!result) return reload(session);
  const writes = renameWrites(session, target, result);
  if ("error" in writes) return writes;
  if (writes.length === 0) return reload(session);
  if (savedAlready) return commitFolded(session, writes);
  return commit(session, `Rename “${from}” to “${to}”`, freshKey(), writes);
}

/** Does the scope `target` names declare `name`? */
function declares(source: NonNullable<ProjectSession["loaded"]["source"]>, target: Extract<StageTarget, { kind: "property" }>, name: string): boolean {
  return locateProperty(source, { ...target, name }) !== undefined;
}

/** How many gates order against the target's ladder: what a reorder changes
 *  the meaning of. */
export function stageGates(session: ProjectSession, target: StageTarget): number {
  const source = session.loaded.source;
  return source ? stageGateCount(source, target, projectDialect(source)) : 0;
}
