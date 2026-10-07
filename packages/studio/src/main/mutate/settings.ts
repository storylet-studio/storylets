// ---------------------------------------------------------------------------
// The project shard's settings, saved whole from the settings dialog.
// ---------------------------------------------------------------------------

import type { CoverageDriver, ProjectShard } from "@storylet-studio/model";
import { gameWorldWrite } from "../game-scopes.js";
import type { ProjectSession } from "../project.js";
import { declsFromDtos } from "../decls.js";
import type { CoverageDriverDto, ProjectSettingsDto } from "../../shared/api.js";
import { commit, freshKey } from "./write-path.js";
import type { Written } from "./write-path.js";
import { projectWrite } from "./shards.js";

/** The settings dialog's save: the whole project shard in one undo step (and
 *  the game's own @world file with it, where the game shares its scopes). */
export async function saveProjectSettings(session: ProjectSession, dto: ProjectSettingsDto): Promise<Written> {
  const source = session.loaded.source;
  if (!source) return { error: "no project open" };
  const p = source.project;
  // Where the game shares its scopes, @world is the game's file: written FIRST, with the
  // project's own declarations its synced copy (the same list, written below), so the
  // project still compiles packed or checked out alone (patterkit design/shared-scopes.md).
  // Asked before anything is changed, so a game file that can't be read refuses the save whole.
  const world = declsFromDtos(dto.world);
  const shared = gameWorldWrite(source, world);
  if ("error" in shared) return shared;
  p.project.name = dto.name;
  p.project.version = dto.version;
  p.world.properties = world;
  p.story.properties = declsFromDtos(dto.story);
  p.export.bundle = dto.bundlePath;
  p.export.metadata = dto.metadata;
  // Off is the default, so off is written as ABSENT rather than as `false`: a
  // shard says what an author chose, and a key nobody set is noise in a diff.
  if (dto.exportMap) p.export.map = true; else delete p.export.map;
  if (dto.warnUnreadWrites) p.validation = { warnUnreadWrites: true }; else delete p.validation;
  // The paired Patter project: absent when none, like every setting nobody chose.
  const patter = (dto.patterProject ?? "").trim();
  if (patter) p.patter = patter; else delete p.patter;
  p.settings.playAdvancesTurns = dto.playAdvancesTurns;
  // The play ladder's rung (design/engine-server.md 4.10). Written whatever it
  // is, "solo" included: it is a three-way choice, not an off/on flag, and a
  // shard that names its rung is one an author can read. The dialog refuses a
  // move down while content sits above the rung, so nothing arrives here that
  // would hide something the project contains.
  p.settings.play = dto.play;
  writeDrivers(p, dto.drivers);
  return commit(session, "Project settings", freshKey(), [...shared, projectWrite(session)]);
}

/** Fold the edited driver list back into the shard's map. A driver with no
 *  property name or an empty pool is inert, so a half-typed row is dropped
 *  rather than written; a repeated ref keeps the last one, matching what the
 *  editor's duplicate guard has already flagged. */
function writeDrivers(p: ProjectShard, dtos: CoverageDriverDto[]): void {
  const drivers: Record<string, CoverageDriver> = {};
  for (const d of dtos) {
    const ref = d.ref.trim();
    if (ref === "" || ref.endsWith(".") || d.values.length === 0) continue;
    drivers[ref] = {
      kind: d.kind,
      ...(d.kind === "recurring" ? { cadence: d.cadence ?? "sometimes" } : {}),
      values: [...d.values],
    };
  }
  if (Object.keys(drivers).length > 0) {
    p.coverage = { ...p.coverage, drivers };
  } else if (p.coverage) {
    delete p.coverage.drivers;
    // Removing the last driver removes the block, rather than leaving an
    // empty `coverage: {}` behind in the shard.
    if (Object.keys(p.coverage).length === 0) delete p.coverage;
  }
}
