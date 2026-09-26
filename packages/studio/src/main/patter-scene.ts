// ---------------------------------------------------------------------------
// Create the scene in Patter: the quick fix for a card in a box Patter performs
// that has no scene yet (ops `patter-link.ts`, `create-scene`). The stub is
// Patter's to shape, so it comes from Patter core's `planScene`: named after the
// card, its address pinned to the card's gameId, the card's purpose as its
// opening line, and one option per outcome labelled with that outcome's gameId
// (no choice at all for a card with one). Storyletter only decides where the
// files go and writes them, through the version-control layer.
//
// It writes ANOTHER project's files, so it is not a step on this project's undo
// history; the confirmation says where they went. It never overwrites a scene:
// planScene picks a free file name, and a card whose scene already exists in
// the Patter project is refused.
// ---------------------------------------------------------------------------

import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { planScene } from "@patterkit/core";
import type { ScenePlan, ScenePlanTarget } from "@patterkit/core";
import { effectiveGameId } from "@storylet-studio/model";
import type { Card } from "@storylet-studio/model";
import { parseSource } from "@storylet-studio/compiler";
import { readPatterLink } from "@storylet-studio/ops";
import { writeTextFiles } from "@wildwinter/simple-vc-lib";
import type { ProjectSession } from "./project.js";

/** A card's stub scene, planned: named after the card, its address pinned to the card's gameId,
 *  its purpose as the opening line, and its outcomes in the order the author sees them, which is
 *  the order the options appear in. Shared by the quick fix and the Patter starter project. */
export function planCardScene(card: Card<string>, target: ScenePlanTarget): ScenePlan {
  const address = effectiveGameId(card);
  const outcomes = [...card.outcomes]
    .map((o, i) => ({ o, at: o.order ?? i }))
    .sort((a, b) => a.at - b.at)
    .map(({ o }) => ({ gameId: effectiveGameId(o), ...(o.title !== undefined ? { title: o.title } : {}) }));
  return planScene(target,
    { name: card.title?.trim() || address, gameId: address, ...(card.purpose ? { opening: card.purpose } : {}), outcomes });
}

export function createPatterScene(session: ProjectSession, cardId: string): { address: string; files: string[] } | { error: string } {
  const source = session.loaded.source;
  if (!source) return { error: "no project open" };
  const { link, issues } = readPatterLink(session.loaded);
  if (!link?.projectFile) return { error: issues[0]?.message ?? "This project isn't paired with a Patter project. Choose one in Project Settings." };

  const card = source.boxes.flatMap((b) => b.decks.flatMap((d) => d.shard.cards)).find((c) => c.id === cardId);
  if (!card) return { error: `unknown card (id ${cardId})` };
  const address = effectiveGameId(card);
  if (link.sourceScenes?.has(address)) return { error: `the Patter project already has a scene named "${address}"` };

  let project: { locales?: { default?: string }; layout?: { flow?: string; strings?: string } };
  try { project = parseSource(readFileSync(link.projectFile, "utf8")) as typeof project; }
  catch { return { error: `${relative(session.loaded.dir, link.projectFile)} doesn't parse` }; }
  const locale = project.locales?.default ?? "en";
  const flowDir = join(link.dir, project.layout?.flow ?? "scenes/");
  let taken: Set<string>;
  try { taken = new Set(readdirSync(flowDir).filter((f) => f.endsWith(".patterflow")).map((f) => f.replace(/\.patterflow$/, ""))); }
  catch { taken = new Set(); }

  const plan = planCardScene(card, { locale, ...(project.layout ? { layout: project.layout } : {}), takenStems: taken });
  const writes = plan.writes.map((w) => ({ filePath: join(link.dir, w.path), content: w.content }));
  for (const w of writes) mkdirSync(dirname(w.filePath), { recursive: true });
  const batch = writeTextFiles(writes);
  if (!batch.success) return { error: "couldn't write the scene's files (locked or read-only?)" };
  return { address, files: writes.map((w) => relative(session.loaded.dir, w.filePath)) };
}
