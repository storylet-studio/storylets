// ---------------------------------------------------------------------------
// Storyletter's half of the family's clash resolver (patterkit hands-on step 6,
// ruling Q21; app-shell 0.72's `openClashResolver`). A pack merge or a pull
// that can't agree keeps our side in the merged shard and names each clash
// under the shard's `unresolved` key, which validation then refuses; until
// now the author settled them by editing files. This reads the marks from
// every shard, words each clash for a person, and writes each decision as one
// undoable step through `commit`, so the VC layer, drift checks and Undo all
// apply as they do to any edit.
//
//   - Keep mine:     the shard already holds our side; the entry goes.
//   - Take theirs:   ops' `applyResolutions` sets the path to their side.
//   - Mark resolved: after Edit, the author's hand edit stands; the entry goes.
//
// The `.storyletconflict` sidecar a merge writes beside the shard (pack merges
// and pulls both write one) adds detail where it has any, and goes in the same
// step as the shard's last entry, so validation is clean once nothing is left.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSource } from "@storylet-studio/compiler";
import type { SourceProject } from "@storylet-studio/compiler";
import { CONFLICT_SIDECAR_EXTENSION, ResolutionError, applyResolutions, clashesOf, parseClashPath } from "@storylet-studio/ops";
import type { ShardClash } from "@storylet-studio/ops";
import type { LoadedProject } from "@storylet-studio/ops";
import { unresolvedOf } from "@wildwinter/toolkit/extensions";
import { commit, freshKey } from "./mutate/write-path.js";
import type { ProjectSession } from "./project.js";
import type { ClashDto, ClashGoto, ClashesAnswer } from "../shared/api.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** A clash's id: its shard and its path, which the mark holds once per shard. */
export const clashId = (file: string, path: string): string => `${file}#${path}`;

function splitId(id: string): { file: string; path: string } | undefined {
  const at = id.indexOf("#");
  return at > 0 ? { file: id.slice(0, at), path: id.slice(at + 1) } : undefined;
}

/** Every clash in the project, shard by shard in the loader's order, worded for the resolver. */
export function listClashes(loaded: LoadedProject): ClashDto[] {
  const out: ClashDto[] = [];
  for (const file of loaded.files) {
    if (!file.text.includes("unresolved")) continue;
    let shard: unknown;
    try { shard = parseSource(file.text); } catch { continue; }
    const clashes = clashesOf(shard);
    if (clashes.length === 0) continue;
    const sidecar = readSidecar(join(loaded.dir, file.path + CONFLICT_SIDECAR_EXTENSION));
    for (const clash of clashes) out.push(clashDto(loaded.source, file.path, shard as Obj, clash, sidecar));
  }
  return out;
}

// --- the sidecar ------------------------------------------------------------------

interface Sidecar { conflicts: { id?: string; path?: string }[]; warnings: { id?: string; path?: string; message?: string }[] }

function readSidecar(path: string): Sidecar | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Obj;
    return {
      conflicts: Array.isArray(raw["conflicts"]) ? raw["conflicts"] as Sidecar["conflicts"] : [],
      warnings: Array.isArray(raw["warnings"]) ? raw["warnings"] as Sidecar["warnings"] : [],
    };
  } catch {
    return undefined;   // a sidecar somebody has broken adds nothing, and the mark still drives the list
  }
}

/** What the sidecar adds about one clash: the merge's warnings on the same thing (a hand's Game ID renamed,
 *  which game code calls by name), and that it was the merge's record when it has no warning to give. */
function sidecarDetail(sidecar: Sidecar | undefined, path: string): string | undefined {
  if (sidecar === undefined) return undefined;
  const near = (p: string | undefined): boolean => p !== undefined && (p === path || path.startsWith(`${p}.`) || path.startsWith(`${p}[`) || p.startsWith(`${path}.`) || p.startsWith(`${path}[`));
  const said = sidecar.warnings.filter((w) => near(w.path) && typeof w.message === "string").map((w) => sentence(w.message!));
  return said.length > 0 ? said.join(" ") : undefined;
}

const sentence = (s: string): string => {
  const t = s.trim();
  const capital = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
};

// --- the words --------------------------------------------------------------------

function clashDto(source: SourceProject | undefined, file: string, shard: Obj, clash: ShardClash, sidecar: Sidecar | undefined): ClashDto {
  const place = describe(source, file, shard, clash);
  const detail = sidecarDetail(sidecar, clash.path);
  return {
    id: clashId(file, clash.path),
    where: place.where,
    path: `${file}: ${clash.path}`,
    kind: clash.kind,
    ...(clash.ours !== undefined ? { ours: display(clash.ours) } : {}),
    ...(clash.theirs !== undefined ? { theirs: display(clash.theirs) } : {}),
    ...(clash.base !== undefined ? { base: display(clash.base) } : {}),
    settable: clash.settable,
    ...(detail !== undefined ? { detail } : {}),
    ...(place.goto !== undefined ? { goto: place.goto } : {}),
  };
}

/** A side as text: a word or a number as it is, a list of names (an order) as a list, anything bigger as its
 *  JSON, cut short past a screenful. */
export function display(value: unknown): string {
  if (typeof value === "string") return value === "" ? "(empty)" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value) && value.every((x) => typeof x === "string")) return value.length === 0 ? "(none)" : value.join(", ");
  const text = JSON.stringify(value, null, 2);
  return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
}

/** A shard field's name as words: `inOneHand` is "in one hand", `gameId` "Game ID". */
export function fieldWords(name: string): string {
  if (name === "gameId") return "Game ID";
  if (name === "id") return "id";
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

const named = (item: unknown, fallback: string): string => {
  if (!isObj(item)) return fallback;
  for (const k of ["title", "name", "gameId", "id"]) if (typeof item[k] === "string" && item[k] !== "") return item[k] as string;
  return fallback;
};

/** The item of a keyed list a path names, as the shard has it, else as either side had it (a card only one side
 *  kept). */
const itemIn = (list: unknown, key: string, field = "id"): Obj | undefined =>
  Array.isArray(list) ? list.find((x): x is Obj => isObj(x) && x[field] === key) : undefined;

interface Place { where: string; goto?: ClashGoto }

/** "Card 'Tavern Brawl' in Opening deck", "@story.trust's default": where a clash is, for a person, and where
 *  Edit goes. */
export function describe(source: SourceProject | undefined, file: string, shard: Obj, clash: Pick<ShardClash, "path" | "ours" | "theirs">): Place {
  const parsed = parseClashPath(clash.path);
  const steps = parsed?.steps ?? [];
  const order = parsed?.order === true;
  const box = source?.boxes.find((b) => file.startsWith(`${b.path}/`));
  const boxName = box !== undefined ? named(box.box.box, box.path) : undefined;
  const boxId = box?.box.box.id;
  const inBox = boxName !== undefined ? ` in ${boxName} box` : "";
  const keyAt = (i: number): string | undefined => { const s = steps[i]; return s?.kind === "key" ? s.name : undefined; };
  const itemAt = (i: number): string | undefined => { const s = steps[i]; return s?.kind === "item" ? s.key : undefined; };
  /** The words for the rest of the path from step `i`: a field, a change, or nothing. */
  const rest = (i: number): string => {
    const k = keyAt(i);
    if (k === undefined) return "";
    const tail = steps.slice(i + 1).map((s) => (s.kind === "key" ? s.name : s.key)).join(".");
    if (k === "fields") return tail !== "" ? `: field ${tail}` : ": fields";
    if (k === "changes") return tail !== "" ? `: change to ${tail}` : ": changes";
    if (k === "tags") return tail !== "" ? `: tags in ${tail}` : ": tags";
    return `: ${fieldWords(k)}${tail !== "" ? ` ${tail}` : ""}`;
  };
  const schema = typeof shard["schema"] === "string" ? (shard["schema"] as string).split("@")[0] : "";

  switch (schema) {
    case "storylets/deck": {
      const deck = isObj(shard["deck"]) ? shard["deck"] : {};
      const deckName = `${named(deck, "this")} deck`;
      const deckId = typeof deck["id"] === "string" ? deck["id"] as string : undefined;
      const deckGoto: ClashGoto | undefined = boxId !== undefined && deckId !== undefined ? { kind: "deck", box: boxId, deck: deckId } : undefined;
      if (keyAt(0) === "cards" && itemAt(1) !== undefined) {
        const cardId = itemAt(1)!;
        const here = itemIn(shard["cards"], cardId);
        // A card only one side kept is named from that side.
        const card = here ?? (isObj(clash.ours) ? clash.ours : isObj(clash.theirs) ? clash.theirs : undefined);
        const cardWords = `card '${named(card, cardId)}' in ${deckName}`;
        const cardGoto: ClashGoto | undefined = boxId !== undefined && deckId !== undefined && here !== undefined
          ? { kind: "card", box: boxId, deck: deckId, card: cardId } : deckGoto;
        if (keyAt(2) === "outcomes" && itemAt(3) !== undefined) {
          const oid = itemAt(3)!;
          const outcome = itemIn(here?.["outcomes"], oid);
          const goto: ClashGoto | undefined = cardGoto?.kind === "card" && outcome !== undefined
            ? { kind: "outcome", box: cardGoto.box, deck: cardGoto.deck, card: cardGoto.card, outcome: oid } : cardGoto;
          return { where: `Outcome '${named(outcome, oid)}' of ${cardWords}${rest(4)}`, ...(goto ? { goto } : {}) };
        }
        if (keyAt(2) === "outcomes" && order) return { where: `The order of the outcomes of ${cardWords}`, ...(cardGoto ? { goto: cardGoto } : {}) };
        return { where: `${capital(cardWords)}${rest(2)}`, ...(cardGoto ? { goto: cardGoto } : {}) };
      }
      if (keyAt(0) === "deck" && keyAt(1) === "properties") {
        return { where: declWords("deck", steps.slice(2), order, `${deckName}'s properties`), ...(deckGoto ? { goto: deckGoto } : {}) };
      }
      if (keyAt(0) === "deck") return { where: `${capital(deckName)}${rest(1)}`, ...(deckGoto ? { goto: deckGoto } : {}) };
      return { where: `${capital(deckName)}${rest(0)}`, ...(deckGoto ? { goto: deckGoto } : {}) };
    }
    case "storylets/project": {
      const project: ClashGoto = { kind: "project" };
      if (keyAt(0) === "story" && keyAt(1) === "properties") return { where: declWords("story", steps.slice(2), order, "@story's properties"), goto: project };
      if (keyAt(0) === "world" && keyAt(1) === "properties") return { where: declWords("world", steps.slice(2), order, "@world's properties"), goto: project };
      if (keyAt(0) === "scopeRegistry" && keyAt(1) === "scopes") {
        const token = itemAt(2);
        if (token === undefined) return { where: order ? "The order of the game's scopes" : "The game's scopes", goto: project };
        if (keyAt(3) === "declarations") return { where: declWords(token, steps.slice(4), order, `@${token}'s properties`), goto: project };
        return { where: `The @${token} scope${rest(3)}`, goto: project };
      }
      if (keyAt(0) === "project") return { where: `The project${rest(1)}`, goto: project };
      if (keyAt(0) === "settings") return { where: `Project setting ${steps.slice(1).map((s) => (s.kind === "key" ? s.name : s.key)).join(".")}`, goto: project };
      return { where: `The project${rest(0)}`, goto: project };
    }
    case "storylets/box": {
      const goto: ClashGoto | undefined = boxId !== undefined ? { kind: "box", box: boxId } : undefined;
      const boxWords = boxName !== undefined ? `${boxName} box` : "This box";
      const b = keyAt(1);
      if (keyAt(0) === "box" && b === "properties") return { where: declWords("box", steps.slice(2), order, `${boxWords}'s properties`), ...(goto ? { goto } : {}) };
      if (keyAt(0) === "box" && (b === "fields" || b === "outcomeFields")) {
        const half = b === "fields" ? "card template" : "outcome template";
        const name = itemAt(2);
        if (order || name === undefined) return { where: `The order of ${boxWords}'s ${half} fields`, ...(goto ? { goto } : {}) };
        return { where: `Field '${name}' of ${boxWords}'s ${half}${rest(3)}`, ...(goto ? { goto } : {}) };
      }
      return { where: `${boxWords}${rest(keyAt(0) === "box" ? 1 : 0)}`, ...(goto ? { goto } : {}) };
    }
    case "storylets/hands": {
      const list = keyAt(0);
      const id = itemAt(1);
      if ((list === "hands" || list === "templates") && id !== undefined) {
        const item = itemIn(shard[list], id) ?? (isObj(clash.ours) ? clash.ours : isObj(clash.theirs) ? clash.theirs : undefined);
        const what = list === "hands" ? "Hand" : "Hand template";
        const there = itemIn(shard[list], id) !== undefined && boxId !== undefined;
        const goto: ClashGoto | undefined = there ? (list === "hands" ? { kind: "hand", box: boxId!, hand: id } : { kind: "template", box: boxId!, template: id })
          : boxId !== undefined ? { kind: "box", box: boxId } : undefined;
        if (keyAt(2) === "properties") {
          return { where: declWords("hand", steps.slice(3), order, `${what.toLowerCase()} '${named(item, id)}''s properties`), ...(goto ? { goto } : {}) };
        }
        return { where: `${what} '${named(item, id)}'${inBox}${rest(2)}`, ...(goto ? { goto } : {}) };
      }
      return { where: `The hands${inBox}${rest(0)}`, ...(boxId !== undefined ? { goto: { kind: "box", box: boxId } } : {}) };
    }
    case "storylets/tags": {
      const gid = itemAt(1);
      const group = gid !== undefined ? itemIn(shard["groups"], gid) : undefined;
      const goto: ClashGoto | undefined = group !== undefined && boxId !== undefined ? { kind: "tagGroup", box: boxId, group: gid! }
        : boxId !== undefined ? { kind: "box", box: boxId } : undefined;
      if (gid === undefined) return { where: `The tag groups${inBox}`, ...(goto ? { goto } : {}) };
      const groupWords = `tag group '${named(group, gid)}'${inBox}`;
      const tid = keyAt(2) === "tags" ? itemAt(3) : undefined;
      if (tid !== undefined) {
        const tag = itemIn(group?.["tags"], tid);
        if (keyAt(4) === "properties") {
          const prop = itemAt(5);
          const field = keyAt(6);
          const words = order || prop === undefined ? `The order of tag '${named(tag, tid)}''s properties`
            : `Property '${prop}' of tag '${named(tag, tid)}'${field !== undefined ? `: ${fieldWords(field)}` : ""}`;
          return { where: words, ...(goto ? { goto } : {}) };
        }
        return { where: `Tag '${named(tag, tid)}' in ${groupWords}${rest(4)}`, ...(goto ? { goto } : {}) };
      }
      return { where: `${capital(groupWords)}${rest(2)}`, ...(goto ? { goto } : {}) };
    }
    case "storylets/view":
      return { where: `Where things sit on the canvases${inBox}`, ...(boxId !== undefined ? { goto: { kind: "box", box: boxId } } : {}) };
    case "storylets/map":
      return { where: `Where hands stand on the map${inBox}`, ...(boxId !== undefined ? { goto: { kind: "box", box: boxId } } : {}) };
    case "storylets/projectmap":
      return { where: "The project map", goto: { kind: "map" } };
    case "storylets/notes":
      return { where: `A comment thread${inBox}${keyAt(2) === "messages" || steps.length > 3 ? ", one message" : ""}`, ...(boxId !== undefined ? { goto: { kind: "box", box: boxId } } : {}) };
    case "storylets/contract":
      return { where: "The installation contract" };
    case "storylets/extension": {
      const ext = typeof shard["extension"] === "string" ? shard["extension"] : "an extension";
      return { where: `${ext}'s data${inBox}${steps.length > 3 ? `, ${steps.slice(3).map((s) => (s.kind === "key" ? s.name : s.key)).join(".")}` : ""}`,
        ...(boxId !== undefined ? { goto: { kind: "box", box: boxId } } : {}) };
    }
    default:
      return { where: file };
  }
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A declaration's clash: "@story.trust's default", "@deck.mood", or the order of a list of them. */
function declWords(scope: string, steps: readonly { kind: "key" | "item"; name?: string; key?: string }[], order: boolean, list: string): string {
  const first = steps[0];
  if (order || first === undefined || first.kind !== "item") return `The order of ${list}`;
  const name = `@${scope}.${first.key}`;
  const field = steps[1];
  return field !== undefined && field.kind === "key" ? `${name}'s ${fieldWords(field.name!)}` : name;
}

// --- deciding ---------------------------------------------------------------------

/** One decision, as one undoable step: the shard's new text, and its sidecar gone with its last entry. Answers the
 *  fresh project and the clashes left. */
async function decide(session: ProjectSession, id: string, decision: "ours" | "theirs" | "resolved"): Promise<ClashesAnswer> {
  const at = splitId(id);
  const file = at !== undefined ? session.loaded.files.find((f) => f.path === at.file) : undefined;
  if (at === undefined || file === undefined) return { error: "that clash isn't in the project any more" };
  let text: string;
  try {
    text = applyResolutions(file.text, { [at.path]: decision });
  } catch (e) {
    if (e instanceof ResolutionError) return { error: e.message };
    return { error: `couldn't read ${at.file}: ${e instanceof Error ? e.message : String(e)}` };
  }
  const shardPath = join(session.loaded.dir, at.file);
  const sidecarPath = shardPath + CONFLICT_SIDECAR_EXTENSION;
  const cleared = unresolvedOf(parseSource(text)) === undefined;
  const writes = [
    { path: shardPath, content: text },
    // The merge's record goes with the shard's last clash, so the project validates again.
    ...(cleared && existsSync(sidecarPath) ? [{ path: sidecarPath, content: null }] : []),
  ];
  const label = decision === "ours" ? "Keep my side of a clash" : decision === "theirs" ? "Take their side of a clash" : "Mark a clash resolved";
  const result = await commit(session, label, freshKey("clash"), writes);
  if ("error" in result) return result;
  return { result, clashes: listClashes(session.loaded) };
}

/** Keep mine or Take theirs. */
export function resolveClash(session: ProjectSession, id: string, side: "ours" | "theirs"): Promise<ClashesAnswer> {
  if (side !== "ours" && side !== "theirs") return Promise.resolve({ error: "Keep mine or Take theirs, nothing else" });
  return decide(session, id, side);
}

/** Mark resolved, after Edit: what's there now stands. */
export function markClashResolved(session: ProjectSession, id: string): Promise<ClashesAnswer> {
  return decide(session, id, "resolved");
}
