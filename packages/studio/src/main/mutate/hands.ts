// ---------------------------------------------------------------------------
// Hands and hand templates. A hand is a place on the board (schema 2.6): a
// template instance (chosen tags fill its holes) or standalone with its own
// inline rule, living beside its templates in the box's hands shard. What a
// hand's page READS (its detail, what could come up there) is read/details.ts.
// ---------------------------------------------------------------------------

import type { SourceBox } from "@storylet-studio/compiler";
import { newId, planForgetSites, planMapSites } from "@storylet-studio/ops";
import { effectiveGameId, freeGameId, freeTitle, isHoleRef } from "@storylet-studio/model";
import type { Hand, HandTemplate } from "@storylet-studio/model";
import { boxWithMap } from "../project.js";
import type { ProjectSession } from "../project.js";
import { allFinite } from "../trust.js";
import { declsFromDtos } from "../decls.js";
import type { BindingDto, HandEdit, OpenResult, TemplateEdit } from "../../shared/api.js";
import { commit, commitMaking, freshKey } from "./write-path.js";
import type { Written } from "./write-path.js";
import {
  applyIdentity, blank, coerceSlots, dedupedGameId, gone, handsWrite, locateBox, locateBoxSeen, midpointOrder, refusedNumber,
} from "./shards.js";
import { bindSitesToZones } from "./map.js";

/** Resolve binding rows back to stored form (fixed bindings + chooses).
 *
 *  `allowRefs` is a HAND's rule: a standalone hand may fill a binding from a
 *  property, and the reference is stored as authored. A TEMPLATE may not - its
 *  bindings are the same for every instance, so a hole that moves belongs on
 *  the hand, and the compiler says so. */
function resolveBindingRows(box: SourceBox, rows: BindingDto[], allowRefs = false): { bindings: Record<string, string>; chooses: string[] } {
  const bindings: Record<string, string> = {};
  const chooses: string[] = [];
  for (const b of rows) {
    const group = box.tags.groups.find((d) => effectiveGameId(d) === b.group);
    if (!group) continue;
    if (b.hole) { chooses.push(group.id); continue; }
    if (b.value) {
      if (allowRefs && isHoleRef(b.value)) { bindings[group.id] = b.value; continue; }
      const tag = group.tags.find((x) => effectiveGameId(x) === b.value);
      if (tag) bindings[group.id] = tag.id;
    }
  }
  return { bindings, chooses };
}

// --- hands -----------------------------------------------------------------------

export async function saveHand(session: ProjectSession, boxId: string, handId: string, edit: HandEdit): Promise<Written> {
  const box = locateBoxSeen(session, boxId);
  const hand = box?.hands.hands.find((h) => h.id === handId);
  if (!box || !hand) return gone("hand");
  applyIdentity(hand, edit);
  if (edit.template !== undefined) {
    if (edit.template === "") {
      // Convert to standalone: an empty rule, exactly one of template / rule.
      delete hand.template;
      delete hand.chosen;
      hand.rule = hand.rule ?? { slots: "unbounded" };
    } else {
      const t = box.hands.templates.find((x) => effectiveGameId(x) === edit.template);
      if (t) {
        hand.template = t.id;
        delete hand.rule;
        // Keep only chosen entries that fill the new template's holes.
        const holes = new Set(t.chooses ?? []);
        const next = Object.fromEntries(Object.entries(hand.chosen ?? {}).filter(([g]) => holes.has(g)));
        if (Object.keys(next).length > 0) hand.chosen = next; else delete hand.chosen;
      }
    }
  }
  if (edit.chosen !== undefined && hand.template !== undefined) {
    const chosen: Record<string, string> = {};
    for (const c of edit.chosen) {
      const group = box.tags.groups.find((d) => effectiveGameId(d) === c.group);
      if (!group) continue;
      // A property reference is stored as authored: it names no tag, and the
      // runtime resolves it at ask time (the hand that moves).
      if (isHoleRef(c.value)) { chosen[group.id] = c.value; continue; }
      const tag = group.tags.find((x) => effectiveGameId(x) === c.value);
      if (tag) chosen[group.id] = tag.id;
    }
    if (Object.keys(chosen).length > 0) hand.chosen = chosen; else delete hand.chosen;
  }
  if (edit.rule !== undefined && hand.rule !== undefined) {
    if (edit.rule.bindings !== undefined) {
      const { bindings } = resolveBindingRows(box, edit.rule.bindings, true);
      if (Object.keys(bindings).length > 0) hand.rule.bindings = bindings; else delete hand.rule.bindings;
    }
    if (edit.rule.condition !== undefined) {
      if (blank(edit.rule.condition)) delete hand.rule.condition; else hand.rule.condition = edit.rule.condition;
    }
    if (edit.rule.slots !== undefined) hand.rule.slots = coerceSlots(edit.rule.slots);
  }
  if (edit.slots !== undefined) {
    const n = Number(edit.slots);
    if (edit.slots.trim() && Number.isInteger(n) && n >= 0) hand.slots = n; else delete hand.slots;
  }
  if (edit.properties !== undefined) hand.properties = declsFromDtos(edit.properties);
  return commit(session, "Edit hand", `hand:${handId}`, [handsWrite(session, box)]);
}

export async function createHand(
  session: ProjectSession, boxId: string, site?: { x: number; y: number },
  /** An instance of this template rather than a standalone hand: the map's
   *  "+ Hand" menu offers the box's templates by title (the sign-off round). */
  templateId?: string,
): Promise<{ result: OpenResult; handId: string } | { error: string }> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  const template = templateId === undefined ? undefined : box.hands.templates.find((t) => t.id === templateId);
  if (templateId !== undefined && template === undefined) return gone("hand template");
  const map = session.loaded.source!.map;
  if (site !== undefined && (map === undefined || box.box.box.usesMap !== true)) {
    return { error: "this box is not on the project map" };
  }
  if (site !== undefined && !allFinite(site.x, site.y)) return refusedNumber;
  const taken = new Set(box.hands.hands.map((h) => effectiveGameId(h)));
  const title = freeTitle("New hand", taken);
  // Standalone by default (an empty rule pulls the whole stock); an instance
  // when a template was picked, its zone hole filled by the pin below.
  const hand: Hand<string> = template !== undefined
    ? { id: newId("h"), title, template: template.id }
    : { id: newId("h"), title, rule: { slots: "unbounded" } };
  box.hands.hands.push(hand);
  if (site === undefined) {
    return commitMaking(session, "New hand", freshKey(), [handsWrite(session, box)], { handId: hand.id });
  }
  // The map's "+ Site": the hand, its pin, and the zone it was dropped in, in
  // ONE commit, so one undo takes the whole gesture back. The binding is the
  // pin-drag rule (`bindSitesToZones`), so a site made here and a site dragged
  // here cannot come to different conclusions about the same spot.
  const at = { x: Math.round(site.x), y: Math.round(site.y) };
  bindSitesToZones(boxWithMap(session.loaded.source, box), map!.group.id, { [hand.id]: at });
  return commitMaking(session, "New hand on the map", freshKey("map"), [
    handsWrite(session, box),
    ...planMapSites(session.loaded.dir, box, [{ id: hand.id, ...at }]).map((w) => ({ path: w.path, content: w.content })),
  ], { handId: hand.id });
}

export async function moveHand(session: ProjectSession, boxId: string, handId: string, targetId: string, before: boolean): Promise<Written> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  const order = midpointOrder(box.hands.hands, handId, targetId, before);
  if (typeof order !== "number") return order;
  box.hands.hands.find((h) => h.id === handId)!.order = order;
  return commit(session, "Reorder hands", freshKey(), [handsWrite(session, box)]);
}

export async function duplicateHand(session: ProjectSession, boxId: string, handId: string): Promise<{ result: OpenResult; handId: string } | { error: string }> {
  const box = locateBox(session, boxId);
  const original = box?.hands.hands.find((h) => h.id === handId);
  if (!box || !original) return gone("hand");
  const clone = JSON.parse(JSON.stringify(original)) as Hand<string>;
  clone.id = newId("h");
  clone.gameId = dedupedGameId(effectiveGameId(original), new Set(box.hands.hands.map((h) => effectiveGameId(h))));
  if (clone.title !== undefined) clone.title = `${clone.title} (copy)`;
  box.hands.hands.push(clone);
  return commitMaking(session, "Duplicate hand", freshKey(), [handsWrite(session, box)], { handId: clone.id });
}

/**
 * Delete a hand, and its pin on the map in the same step (review 2026-10, item
 * 15): a pin left behind for a hand that is gone was four errors in the
 * problems bar, and an undo that brought the hand back without its place.
 */
export async function deleteHand(session: ProjectSession, boxId: string, handId: string): Promise<Written> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  if (!box.hands.hands.some((h) => h.id === handId)) return gone("hand");
  const pin = planForgetSites(session.loaded.dir, box, [handId]);
  box.hands.hands = box.hands.hands.filter((h) => h.id !== handId);
  return commit(session, "Delete hand", freshKey(), [
    handsWrite(session, box),
    ...pin.map((w) => ({ path: w.path, content: w.content })),
  ]);
}

// --- hand templates --------------------------------------------------------------

export async function saveTemplate(session: ProjectSession, boxId: string, templateId: string, edit: TemplateEdit): Promise<Written> {
  const box = locateBoxSeen(session, boxId);
  const template = box?.hands.templates.find((t) => t.id === templateId);
  if (!box || !template) return gone("hand template");
  applyIdentity(template, edit);
  if (edit.condition !== undefined) { if (blank(edit.condition)) delete template.condition; else template.condition = edit.condition; }
  if (edit.slots !== undefined) template.slots = coerceSlots(edit.slots);
  if (edit.properties !== undefined) template.properties = declsFromDtos(edit.properties);
  if (edit.bindings !== undefined) {
    const { bindings, chooses } = resolveBindingRows(box, edit.bindings);
    if (Object.keys(bindings).length > 0) template.bindings = bindings; else delete template.bindings;
    if (chooses.length > 0) template.chooses = chooses; else delete template.chooses;
    // A hole change reshapes every instance: drop chosen entries for groups
    // that are no longer holes (instances stay fully concrete).
    for (const hand of box.hands.hands) {
      if (hand.template !== template.id || hand.chosen === undefined) continue;
      const next = Object.fromEntries(Object.entries(hand.chosen).filter(([g]) => chooses.includes(g)));
      if (Object.keys(next).length > 0) hand.chosen = next; else delete hand.chosen;
    }
  }
  return commit(session, "Edit hand template", `template:${templateId}`, [handsWrite(session, box)]);
}

export async function createTemplate(session: ProjectSession, boxId: string): Promise<{ result: OpenResult; templateId: string } | { error: string }> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  const taken = new Set(box.hands.templates.map((t) => effectiveGameId(t)));
  const gameId = freeGameId("new-template", taken);
  const template: HandTemplate<string> = { id: newId("t"), gameId, slots: "unbounded", properties: [] };
  box.hands.templates.push(template);
  return commitMaking(session, "New hand template", freshKey(), [handsWrite(session, box)], { templateId: template.id });
}

export async function duplicateTemplate(session: ProjectSession, boxId: string, templateId: string): Promise<{ result: OpenResult; templateId: string } | { error: string }> {
  const box = locateBox(session, boxId);
  const original = box?.hands.templates.find((t) => t.id === templateId);
  if (!box || !original) return gone("hand template");
  const clone = JSON.parse(JSON.stringify(original)) as HandTemplate<string>;
  clone.id = newId("t");
  clone.gameId = dedupedGameId(effectiveGameId(original), new Set(box.hands.templates.map((t) => effectiveGameId(t))));
  if (clone.title !== undefined) clone.title = `${clone.title} (copy)`;
  box.hands.templates.push(clone);
  return commitMaking(session, "Duplicate hand template", freshKey(), [handsWrite(session, box)], { templateId: clone.id });
}

export async function deleteTemplate(session: ProjectSession, boxId: string, templateId: string): Promise<Written> {
  const box = locateBox(session, boxId);
  if (!box) return gone("box");
  if (!box.hands.templates.some((t) => t.id === templateId)) return gone("hand template");
  if (box.hands.hands.some((h) => h.template === templateId)) return { error: "a hand still instances this template" };
  box.hands.templates = box.hands.templates.filter((t) => t.id !== templateId);
  return commit(session, "Delete hand template", freshKey(), [handsWrite(session, box)]);
}
