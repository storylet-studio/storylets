// ---------------------------------------------------------------------------
// The project session: ops in, display DTOs out. Everything here is a thin
// projection over @storylet-studio/ops (one core, many front-ends - the
// editor never grows logic the CLI does not have). Electron-free, so it
// tests headlessly against the example project.
// ---------------------------------------------------------------------------

import { basename, dirname, join } from "node:path";
import { loadProject, runExport, runInit, runValidate } from "@storylet-studio/ops";
import { mkdirSync } from "node:fs";
import type { LoadedProject } from "@storylet-studio/ops";
import { writeBinaryFile, writeTextFiles as vcWrite } from "@wildwinter/simple-vc-lib";
import { compileProject, projectHash } from "@storylet-studio/compiler";
import { writeTextFiles } from "@wildwinter/simple-vc-lib";
import { SHARD_EXTENSIONS, effectiveGameId, isSpatial, openThreadCounts, PLACE_GROUP } from "@storylet-studio/model";
import type { Bundle, Card, CoverageDriver, HandTemplate } from "@storylet-studio/model";
import type { SourceBox } from "@storylet-studio/compiler";
import type {
  BoxDto, CardDto, CoverageDriverDto, DeckDto, OpenResult, Problem, ProjectDto, ProjectSettingsDto, ShardVcDto, VcStatusDto,
} from "../shared/api.js";
import { History } from "./history.js";
import { resetShardStatus, shardStatus } from "./vc.js";
import type { ShardRef } from "./vc.js";

export interface ProjectSession {
  loaded: LoadedProject;
  dto: ProjectDto;
  history: History;
}

const chipValues = (
  box: SourceBox, tags: Record<string, string[]> | undefined,
): CardDto["tags"] => {
  const out: CardDto["tags"] = [];
  for (const [groupId, tagIds] of Object.entries(tags ?? {})) {
    if (groupId === PLACE_GROUP) {
      // The reserved group: its tags are hand ids; show hand gameIds.
      out.push({
        group: PLACE_GROUP,
        values: tagIds.map((id) => { const h = box.hands.hands.find((x) => x.id === id); return h ? effectiveGameId(h) : id; }),
      });
      continue;
    }
    const group = box.tags.groups.find((d) => d.id === groupId);
    if (!group) continue;
    out.push({
      group: effectiveGameId(group),
      values: tagIds.map((id) => { const v = group.tags.find((x) => x.id === id); return v ? effectiveGameId(v) : id; }),
    });
  }
  return out;
};

const blank = (src: string | undefined): boolean => src === undefined || src.trim() === "";

const declDto = (d: { name: string; type: string; default?: unknown; values?: string[]; stages?: string[]; purpose?: string }): { name: string; type: string; default: string; values?: string[]; stages?: string[]; purpose?: string } => ({
  name: d.name, type: d.type,
  default: d.default === undefined ? "" : typeof d.default === "string" ? d.default : JSON.stringify(d.default),
  ...(d.values !== undefined ? { values: d.values } : {}),
  ...(d.stages !== undefined ? { stages: d.stages } : {}),
  ...(d.purpose !== undefined ? { purpose: d.purpose } : {}),
});

/** The shard's driver map as an ordered list for the editor. Sorted by ref so
 *  the list is stable across saves (the map has no order of its own). */
const driverDtos = (drivers: Record<string, CoverageDriver> | undefined): CoverageDriverDto[] =>
  Object.entries(drivers ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([ref, d]) => ({
    ref, kind: d.kind, ...(d.cadence !== undefined ? { cadence: d.cadence } : {}), values: [...d.values],
  }));

const cardDto = (box: SourceBox, card: Card<string>): CardDto => ({
  id: card.id,
  gameId: effectiveGameId(card),
  ...(!blank(card.gameId) ? { gameIdPinned: card.gameId } : {}),
  ...(card.title !== undefined ? { title: card.title } : {}),
  ...(card.purpose !== undefined ? { purpose: card.purpose } : {}),
  ...(!blank(card.condition) ? { condition: card.condition } : {}),
  priority: card.priority ?? 0,
  redraw: String(card.redraw ?? "always"),
  tags: chipValues(box, card.tags),
  copies: card.copies === undefined || card.copies === 1 ? "" : String(card.copies),
  ...(card.shared !== undefined ? { shared: card.shared } : {}),
  sharedCopies: card.sharedCopies === undefined ? "" : String(card.sharedCopies),
  // The deck's own flag, so the card page can say what inheriting means here
  // rather than making an author open the deck to find out.
  fields: Object.entries(card.fields ?? {}).map(([name, value]) => ({ name, value: typeof value === "string" ? value : JSON.stringify(value) })),
  outcomes: byDisplay(card.outcomes ?? []).map((o) => ({
    id: o.id,
    gameId: effectiveGameId(o),
    ...(!blank(o.gameId) ? { gameIdPinned: o.gameId } : {}),
    ...(o.title !== undefined ? { title: o.title } : {}),
    ...(o.purpose !== undefined ? { purpose: o.purpose } : {}),
    ...(!blank(o.condition) ? { gate: o.condition } : {}),
    changes: Object.entries(o.changes ?? {}).map(([target, src]) => `${target} ← ${src}`),
  })),
});

/**
 * Display order for an id-sorted collection: the authored `order`, with array
 * position as the fallback, ties broken by keeping array (id) order.
 *
 * Storage is id-sorted under source rule 5, so array position IS id position;
 * every list an author can see has to come back through here or the editor
 * shows them alphabetically by a random id.
 */
export const byDisplay = <T extends { order?: number }>(items: T[]): T[] =>
  items.map((x, i) => ({ x, o: x.order ?? i })).sort((a, b) => a.o - b.o).map((e) => e.x);

const templateDto = (box: SourceBox, template: HandTemplate<string>): BoxDto["templates"][number] => ({
  id: template.id,
  gameId: effectiveGameId(template),
  ...(template.purpose !== undefined ? { purpose: template.purpose } : {}),
  bindings: [
    ...Object.entries(template.bindings ?? {}).map(([groupId, tagId]) => {
      const group = box.tags.groups.find((d) => d.id === groupId);
      const name = group ? effectiveGameId(group) : groupId;
      const tag = group?.tags.find((x) => x.id === tagId);
      return `${name} = ${tag ? effectiveGameId(tag) : tagId}`;
    }),
    ...(template.chooses ?? []).map((groupId) => {
      const group = box.tags.groups.find((d) => d.id === groupId);
      return `${group ? effectiveGameId(group) : groupId} = ?`;
    }),
  ],
  slots: String(template.slots ?? "unbounded"),
  instances: box.hands.hands.filter((h) => h.template === template.id).length,
});

export function toDto(loaded: LoadedProject): ProjectDto {
  const source = loaded.source!;
  return {
    dir: loaded.dir,
    name: source.project.project.name,
    storyPropertyCount: (source.project.story?.properties ?? []).length,
    // Every box's note counts in one map. Cheap (a count per noted id, and most
    // projects note a handful of things) and it saves the editor asking main
    // about each row it draws.
    threads: Object.assign({}, ...source.boxes.map((b) => openThreadCounts(b.notes))) as Record<string, number>,
    boxes: source.boxes
      .map((box, i) => ({ box, o: box.box.box.order ?? i }))
      .sort((a, b) => a.o - b.o)
      .map(({ box }): BoxDto => ({
      id: box.box.box.id,
      gameId: effectiveGameId(box.box.box),
      ...(!blank(box.box.box.gameId) ? { gameIdPinned: box.box.box.gameId } : {}),
      ...(box.box.box.title !== undefined ? { title: box.box.box.title } : {}),
      ...(box.box.box.purpose !== undefined ? { purpose: box.box.box.purpose } : {}),
      ranking: { specificity: box.box.box.ranking?.specificity ?? true },
      fields: (box.box.box.fields ?? []).map(declDto),
      properties: (box.box.box.properties ?? []).map(declDto),
      decks: box.decks
        .map((d, i) => ({ d, o: d.shard.deck.order ?? i }))
        .sort((a, b) => a.o - b.o)
        .map(({ d }): DeckDto => ({
        id: d.shard.deck.id,
        gameId: effectiveGameId(d.shard.deck),
        ...(!blank(d.shard.deck.gameId) ? { gameIdPinned: d.shard.deck.gameId } : {}),
        ...(d.shard.deck.title !== undefined ? { title: d.shard.deck.title } : {}),
        ...(d.shard.deck.purpose !== undefined ? { purpose: d.shard.deck.purpose } : {}),
        ...(!blank(d.shard.deck.condition) ? { gate: d.shard.deck.condition } : {}),
        ...(d.shard.deck.shared !== undefined ? { shared: d.shard.deck.shared } : {}),
        properties: (d.shard.deck.properties ?? []).map(declDto),
        // Display order: the authored `order` field, id position as the fallback
        // (storage is id-sorted). A stable sort keeps ties in id order.
        cards: d.shard.cards
          .map((c, i) => ({ c, o: c.order ?? i }))
          .sort((a, b) => a.o - b.o)
          .map(({ c }) => cardDto(box, c)),
      })),
      templates: byDisplay(box.hands.templates).map((t) => templateDto(box, t)),
      tagGroups: byDisplay(box.tags.groups).map((group) => ({
        id: group.id,
        gameId: effectiveGameId(group),
        values: byDisplay(group.tags).map((v) => effectiveGameId(v)),
        // A map, so the box page offers its Map tab and the group's own page can
        // say so. The geometry itself stays out of the DTO: only the map asks for
        // that, and it asks separately (boxMap).
        ...(isSpatial(group) ? { spatial: true } : {}),
      })),
      hands: byDisplay(box.hands.hands)
        .map((h) => ({
        id: h.id,
        gameId: effectiveGameId(h),
        ...(h.title !== undefined ? { title: h.title } : {}),
        ...(h.template !== undefined ? {
          template: (() => { const t = box.hands.templates.find((x) => x.id === h.template); return t ? effectiveGameId(t) : h.template; })(),
        } : {}),
        ...(h.slots !== undefined ? { slots: h.slots } : {}),
        // The hand's bound tags, resolved to gameIds per group gameId: template
        // bindings under the instance's chosen for an instance, the inline
        // rule's bindings for a standalone hand. The Where row reads this to
        // show each place's region and to warn when a home can never come up.
        tags: (() => {
          const t = h.template !== undefined ? box.hands.templates.find((x) => x.id === h.template) : undefined;
          const bound: Record<string, string> = { ...(t?.bindings ?? {}), ...(h.chosen ?? {}), ...(h.rule?.bindings ?? {}) };
          const out: Record<string, string> = {};
          for (const [groupId, tagId] of Object.entries(bound)) {
            const group = box.tags.groups.find((g) => g.id === groupId);
            const tag = group?.tags.find((v) => v.id === tagId);
            if (group && tag) out[effectiveGameId(group)] = effectiveGameId(tag);
          }
          return out;
        })(),
      })),
    })),
  };
}

export function openProject(path: string): { session: ProjectSession; problems: Problem[] } | { error: string } {
  const loaded = loadProject(path);
  if (!loaded.source) {
    const message = loaded.issues.map((i) => i.message).join("; ") || "not a storylets project";
    return { error: message };
  }
  resetShardStatus();   // a new project never inherits the last one's VC answers
  return {
    session: { loaded, dto: toDto(loaded), history: new History() },
    problems: runValidate(loaded, { checkBundle: false }).issues,
  };
}

/** Every shard of the open project, keyed the way the editor addresses it
 *  (see ShardVcDto). Pure string work over the loaded source - no fs - so it
 *  is rebuilt per call rather than memoised. */
export function shardRefs(session: ProjectSession): ShardRef[] {
  const source = session.loaded.source!;
  const dir = session.loaded.dir;
  //
  // `primary` NAMES THE FILE THAT DECIDES "new" (app-shell 0.26.0). Every other
  // state folds by "any shard counts", which is right: a lock anywhere locks the
  // row. Untracked cannot, because a box whose own shard is committed and whose
  // tags shard has never been written is an EDITED box, not a new one, and
  // folding it the usual way would report "new" for half a mature project.
  //
  // Our keys are one file each, so the seam does its work a level up: the nav's
  // box row folds `box:`, `tags:` and `hands:` (views.ts `vcKeys`), and marking
  // only the box shard primary is what stops a missing sidecar from making the
  // box look new. Tags and hands never carry `untracked` at all, which costs
  // nothing: neither has a row of its own to badge - they are box setup tabs.
  const refs: ShardRef[] = [{ key: "project", path: join(dir, source.path), primary: true }];
  for (const box of source.boxes) {
    const id = box.box.box.id;
    refs.push({ key: `box:${id}`, path: join(dir, box.path, `box${SHARD_EXTENSIONS.box}`), primary: true });
    refs.push({ key: `tags:${id}`, path: join(dir, box.path, `tags${SHARD_EXTENSIONS.tags}`) });
    refs.push({ key: `hands:${id}`, path: join(dir, box.path, `hands${SHARD_EXTENSIONS.hands}`) });
    for (const deck of box.decks) {
      refs.push({ key: `deck:${deck.shard.deck.id}`, path: join(dir, deck.path), primary: true });
    }
  }
  return refs;
}

/** The version-control snapshot for the badges, trimmed to the shards with
 *  something to say (absent = clean, writable, up to date). */
export async function vcStatus(session: ProjectSession): Promise<VcStatusDto> {
  const { system, states } = await shardStatus(shardRefs(session));
  const shards: ShardVcDto[] = [];
  for (const [key, s] of states) {
    // Trimmed to shards with something to SAY, and the three states restored in
    // app-shell 0.26.0 count as something: a shard you hold, or have edited, or
    // have never committed, all need a badge. Leaving the old test here would
    // have carried them across the wire and then dropped them on the floor.
    if (s.writable && !s.lockedBy?.length && !s.outOfDate && !s.checkedOutByMe && !s.dirty && !s.untracked) continue;
    shards.push({
      key, writable: s.writable,
      ...(s.lockedBy?.length ? { lockedBy: s.lockedBy } : {}),
      ...(s.outOfDate ? { outOfDate: true } : {}),
      ...(s.checkedOutByMe ? { checkedOutByMe: true } : {}),
      ...(s.dirty ? { dirty: true } : {}),
      ...(s.untracked ? { untracked: true } : {}),
    });
  }
  return { system, shards };
}

export function validate(session: ProjectSession): Problem[] {
  // Re-read from disk: hand edits and VCS updates should always be seen.
  const loaded = loadProject(session.loaded.dir);
  if (loaded.source) {
    session.loaded = loaded;
    session.dto = toDto(loaded);
  }
  return runValidate(loaded, { checkBundle: false }).issues;
}

export function createProject(parentDir: string, name: string): { path: string } | { error: string } {
  try {
    const result = runInit({ dir: `${parentDir}/${name}`, name });
    const batch = writeTextFiles(result.writes.map((w) => ({ filePath: w.path, content: w.content })));
    if (!batch.success) return { error: "could not write the project files" };
    return { path: result.dir };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function openResult(session: ProjectSession, problems: Problem[]): OpenResult {
  return { project: session.dto, problems };
}

/** The project-level settings (from the .storyletproj shard) for the dialog. */
export function projectSettings(session: ProjectSession): ProjectSettingsDto {
  const p = session.loaded.source!.project;
  return {
    name: p.project.name,
    version: p.project.version,
    world: p.world.properties.map(declDto),
    story: p.story.properties.map(declDto),
    drivers: driverDtos(p.coverage?.drivers),
    bundlePath: p.export.bundle,
    metadata: p.export.metadata,
    exportMap: p.export.map === true,
    playAdvancesTurns: p.settings.playAdvancesTurns,
    warnUnreadWrites: p.validation?.warnUnreadWrites === true,
  };
}

/** Compile the freshly re-read project to a bundle for the Board (files are
 *  the truth: the live session reflects the latest saved state). */
export function compileBundle(session: ProjectSession): { bundle: Bundle; name: string } | { error: string } {
  const loaded = loadProject(session.loaded.dir);
  if (!loaded.source) {
    return { error: loaded.issues.map((i) => i.message).join("; ") || "not a storylets project" };
  }
  const { bundle, issues } = compileProject(loaded.source);
  if (!bundle) {
    const errors = issues.filter((i) => i.severity === "error").map((i) => `${i.where ? `${i.where}: ` : ""}${i.message}`);
    return { error: `the project does not compile:\n${errors.join("\n")}` };
  }
  return { bundle, name: loaded.source.project.project.name };
}

/** The current source content hash (freshly re-read from disk), or null if the
 *  project no longer loads. The Table compares this to its running bundle's
 *  content.hash to know when it has gone out of date. */
export function currentProjectHash(session: ProjectSession): string | null {
  const loaded = loadProject(session.loaded.dir);
  return loaded.source ? projectHash(loaded.source) : null;
}

/** Compile and write the .storyletsc bundle to its declared path (through the
 *  VC layer; the bundle is committed with merge=ours). */
export function exportBundle(session: ProjectSession): { path: string } | { error: string } {
  const loaded = loadProject(session.loaded.dir);
  const result = runExport(loaded);
  if (!result.write) {
    const errors = result.issues.filter((i) => i.severity === "error").map((i) => i.message);
    return { error: errors.join("; ") || "the project does not compile" };
  }
  const batch = vcWrite([{ filePath: result.write.path, content: result.write.content }]);
  if (!batch.success) return { error: "could not write the bundle" };
  // The pictures a shipped map needs, beside it. Only ever non-empty when the
  // project asked for maps, and a failure here is a failure of the export: a
  // bundle naming pictures that are not there would be worse than no bundle.
  for (const asset of result.assets) {
    mkdirSync(dirname(asset.path), { recursive: true });
    const one = writeBinaryFile(asset.path, Buffer.from(asset.bytes));
    if (!one.success) return { error: `could not write ${basename(asset.path)}` };
  }
  return { path: result.write.path };
}

/** Live Link's refresh: the same compile Publish Bundle makes, handed back as
 *  the bundle's text and hash rather than written anywhere. Null when the
 *  project does not compile (a broken save is not pushed into a running game). */
export function compileForLivePush(session: ProjectSession): { hash: string; json: string } | null {
  const result = runExport(loadProject(session.loaded.dir), "-");
  if (!result.bundle || result.text === undefined) return null;
  return { hash: result.bundle.content.hash, json: result.text };
}
