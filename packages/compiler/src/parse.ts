// ---------------------------------------------------------------------------
// SourceFile[] -> SourceProject: shard recognition by extension, JSON5
// parsing, schema-tag checks, folder-structure rules. The directory is the
// registry (source doc section 1): a box exists because its folder exists, a
// deck because its file exists.
// ---------------------------------------------------------------------------

import {
  BOX_SCHEMA, DECK_SCHEMA, HANDS_SCHEMA, PROJECT_SCHEMA, NOTES_SCHEMA, SHARD_EXTENSIONS, TAGS_SCHEMA, VIEW_SCHEMA,
  isCaseOnlyPropertyName,
} from "@storylet-studio/model";
import type { BoxShard, DeckShard, HandsShard, ProjectShard, PropertyDecl, TagsShard, ViewShard , NotesShard } from "@storylet-studio/model";
import { parseSource } from "./serialize.js";
import type { Issue, SourceBox, SourceFile, SourceProject } from "./project.js";

interface Parsed {
  file: SourceFile;
  value: Record<string, unknown>;
}

/**
 * Parsed shards, keyed by path and validated by exact text.
 *
 * The editor's hot path is re-reading a project it has just written: one save
 * re-loads every shard, and JSON5 parsing is where that time goes (measured at
 * 3,600 cards: reading the bytes 1.3ms, parsing them 52ms, compiling them 11ms).
 * Almost every one of those shards is byte-identical to the one already parsed.
 *
 * Keyed by path but VALIDATED BY TEXT, which is what makes it safe: identical
 * bytes cannot parse differently, so there is no staleness to reason about and
 * no mtime to be fooled by. An entry per shard, replaced when its bytes change,
 * so the cache is bounded by the size of the project rather than by how long
 * the app has been open.
 */
const parsed = new Map<string, { text: string; value: Record<string, unknown> }>();

/** Empty the parse cache. For a host that has finished with a project and would
 *  rather have the memory back; correctness never depends on it. */
export function clearParseCache(): void { parsed.clear(); }

function parseShard(file: SourceFile, expectedSchema: string, issues: Issue[]): Parsed | undefined {
  // A hit hands back a COPY. Callers mutate what they are given (the studio edits
  // the loaded project in place before writing it), and a cache that handed out
  // its own object would be mutated from under itself and start answering with
  // somebody's unsaved edits. Cloning is 16x cheaper than parsing (3.2ms against
  // 52ms across a 3,600-card project), which is the whole reason this pays.
  const hit = parsed.get(file.path);
  if (hit && hit.text === file.text) {
    return { file, value: structuredClone(hit.value) };
  }

  let value: unknown;
  try {
    value = parseSource(file.text);
  } catch (e) {
    issues.push({ severity: "error", path: file.path, message: `unparseable JSON5: ${e instanceof Error ? e.message : String(e)}` });
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push({ severity: "error", path: file.path, message: "shard must be a JSON5 object" });
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  if (obj["schema"] !== expectedSchema) {
    issues.push({
      severity: "error", path: file.path,
      message: `schema tag ${JSON.stringify(obj["schema"])} is not "${expectedSchema}"`,
    });
    return undefined;
  }
  parsed.set(file.path, { text: file.text, value: structuredClone(obj) });
  return { file, value: obj };
}

const ext = (path: string): string => {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot);
};

/** Group SourceFiles into a SourceProject. Structural errors are issues, not
 *  exceptions; a project is returned when one is assemblable at all. */
export function parseProjectFiles(files: SourceFile[]): { project?: SourceProject; issues: Issue[] } {
  const issues: Issue[] = [];

  const projectFiles = files.filter((f) => !f.path.includes("/") && ext(f.path) === SHARD_EXTENSIONS.project);
  if (projectFiles.length !== 1) {
    issues.push({
      severity: "error", path: projectFiles[1]?.path ?? ".",
      message: `a project has exactly one *${SHARD_EXTENSIONS.project} at its root; found ${projectFiles.length}`,
    });
    return { issues };
  }
  const projectParsed = parseShard(projectFiles[0]!, PROJECT_SCHEMA, issues);
  if (!projectParsed) return { issues };

  // Box folders: every directory holding a box shard.
  const boxFolders = new Map<string, SourceFile[]>();
  for (const file of files) {
    const parts = file.path.split("/");
    if (parts.length < 2) continue;
    const folder = parts[0]!;
    boxFolders.set(folder, [...(boxFolders.get(folder) ?? []), file]);
  }

  const boxes: SourceBox[] = [];
  for (const [folder, boxFiles] of [...boxFolders.entries()].sort()) {
    const find = (name: string): SourceFile | undefined =>
      boxFiles.find((f) => f.path === `${folder}/${name}`);

    const boxFile = find(`box${SHARD_EXTENSIONS.box}`);
    if (!boxFile) {
      issues.push({
        severity: "error", path: folder,
        message: `box folder has no box${SHARD_EXTENSIONS.box}`,
      });
      continue;
    }
    const boxParsed = parseShard(boxFile, BOX_SCHEMA, issues);
    if (!boxParsed) continue;

    const tagsFile = find(`tags${SHARD_EXTENSIONS.tags}`);
    const tagsParsed = tagsFile ? parseShard(tagsFile, TAGS_SCHEMA, issues) : undefined;
    const handsFile = find(`hands${SHARD_EXTENSIONS.hands}`);
    const handsParsed = handsFile ? parseShard(handsFile, HANDS_SCHEMA, issues) : undefined;
    // The arrangement layer. Optional by design: most projects have none until
    // somebody opens a canvas, and it is read here only so the editor and the
    // merge tooling see it as an ordinary shard.
    const viewFile = find(`view${SHARD_EXTENSIONS.view}`);
    const viewParsed = viewFile ? parseShard(viewFile, VIEW_SCHEMA, issues) : undefined;
    // The comment sidecar: optional in the same way, and read here for the same
    // reason - so the editor and the merge tooling treat it as an ordinary shard
    // rather than as a file only one feature knows about.
    const notesFile = find(`notes${SHARD_EXTENSIONS.notes}`);
    const notesParsed = notesFile ? parseShard(notesFile, NOTES_SCHEMA, issues) : undefined;
    if ((tagsFile && !tagsParsed) || (handsFile && !handsParsed) || (viewFile && !viewParsed)
      || (notesFile && !notesParsed)) continue;

    const decks = [];
    let decksOk = true;
    for (const file of boxFiles.filter((f) => f.path.startsWith(`${folder}/decks/`)).sort((a, b) => a.path.localeCompare(b.path))) {
      if (ext(file.path) !== SHARD_EXTENSIONS.deck) {
        issues.push({ severity: "warning", path: file.path, message: `unexpected file in decks/ (not *${SHARD_EXTENSIONS.deck}); ignored` });
        continue;
      }
      const deckParsed = parseShard(file, DECK_SCHEMA, issues);
      if (!deckParsed) {
        decksOk = false;
        continue;
      }
      decks.push({ path: file.path, shard: deckParsed.value as unknown as DeckShard });
    }
    if (!decksOk) continue;

    // Stray files in a box folder are worth a warning (typos hide there).
    for (const file of boxFiles) {
      const known = file.path === boxFile.path
        || file.path === tagsFile?.path
        || file.path === handsFile?.path
        || file.path === viewFile?.path
        || file.path === notesFile?.path
        || file.path.startsWith(`${folder}/decks/`);
      if (!known) {
        issues.push({ severity: "warning", path: file.path, message: "unrecognised file in a box folder; ignored" });
      }
    }

    boxes.push({
      path: folder,
      box: boxParsed.value as unknown as BoxShard,
      tags: (tagsParsed?.value as unknown as TagsShard) ?? { schema: TAGS_SCHEMA, groups: [] },
      hands: (handsParsed?.value as unknown as HandsShard) ?? { schema: HANDS_SCHEMA, templates: [], hands: [] },
      ...(viewParsed ? { view: viewParsed.value as unknown as ViewShard } : {}),
      ...(notesParsed ? { notes: notesParsed.value as unknown as NotesShard } : {}),
      decks,
    });
  }

  const project: SourceProject = {
    path: projectFiles[0]!.path,
    project: projectParsed.value as unknown as ProjectShard,
    boxes,
  };
  foldCaseOnlyPropertyNames(project);
  return { project, issues };
}

/**
 * Repair the ONE property-name fault a reader may repair without guessing at intent:
 * a name that is legal apart from its case (`isNight`).
 *
 * The expression parser folds every REFERENCE to lower case, so the capital was never
 * observable to anything; folding the declaration to match changes no behaviour. Every
 * other illegal name (`is-night`, `9lives`, `not`, a space) is LEFT ALONE for the
 * compiler to report, because choosing an underscore for a space would be inventing
 * intent - the line the gameId editor already draws when it refuses an illegal address
 * rather than quietly rewriting it.
 *
 * Patter does the same in its loader, from the same rule (app-shell property-names.ts).
 * Keeping the two identical is the point: an author moving between the apps should not
 * meet a different answer to "what may I call this?".
 */
function foldCaseOnlyPropertyNames(project: SourceProject): void {
  const fold = (decls: PropertyDecl[] | undefined): void => {
    for (const d of decls ?? []) if (isCaseOnlyPropertyName(d.name)) d.name = d.name.toLowerCase();
  };
  fold(project.project.story?.properties);
  fold(project.project.world?.properties);
  for (const box of project.boxes) {
    fold(box.box.box.properties);
    for (const group of box.tags.groups) for (const tag of group.tags) fold(tag.properties);
    for (const template of box.hands.templates) fold(template.properties);
    for (const deck of box.decks) fold(deck.shard.deck.properties);
  }
}
