// ---------------------------------------------------------------------------
// The expr-editor's property catalogue: what an expression written on a card,
// or on a box, can read. Authoring assist only; validate remains the check.
// ---------------------------------------------------------------------------

import { worldDeclarations } from "@storylet-studio/compiler";
import type { SourceBox, SourceDeck } from "@storylet-studio/compiler";
import { effectiveGameId } from "@storylet-studio/model";
import { otherToolsCatalogue } from "../game-scopes.js";
import { boxWithMap } from "../project.js";
import type { ProjectSession } from "../project.js";
import { locate, locateBoxSeen } from "../mutate/shards.js";
import type { ConditionProperty } from "../../shared/api.js";

/** The expr-editor catalogue reachable from a card in this deck: the five
 *  scopes' declared properties. @hand is composed per deal, so its entries
 *  are the superset of dimension-value properties and query params in the
 *  box (authoring assist; validate remains the real check). */
export function cardCatalogue(session: ProjectSession, deckId: string): ConditionProperty[] {
  const found = locate(session, deckId);
  if (!found) return [];
  return catalogueFor(session, boxWithMap(session.loaded.source, found.box), found.deck);
}

/** The box-scoped catalogue (no @deck feeder): query conditions and other
 *  box-level expressions edit against this. */
export function boxCatalogue(session: ProjectSession, boxId: string): ConditionProperty[] {
  const box = locateBoxSeen(session, boxId);
  return box ? catalogueFor(session, box, undefined) : [];
}

function catalogueFor(session: ProjectSession, box: SourceBox, deck: SourceDeck | undefined): ConditionProperty[] {
  const project = session.loaded.source!.project;
  const out: ConditionProperty[] = [];
  const add = (scope: string, decls: { name: string; type: string; values?: string[]; stages?: string[]; writable?: boolean; purpose?: string }[]): void => {
    for (const d of decls) {
      out.push({
        scope, name: d.name, type: d.type as ConditionProperty["type"],
        ...(d.values !== undefined ? { enumValues: d.values } : {}),
        // A quality's ladder, without which expr-editor can offer the property
        // and then no stage to compare it against (expr-editor 0.11.0).
        ...(d.stages !== undefined ? { stages: d.stages } : {}),
        ...(d.writable !== undefined ? { writable: d.writable } : {}),
        ...(d.purpose !== undefined ? { purpose: d.purpose } : {}),
      });
    }
  };
  // @world from the game's shared file when it declares one, which is what the compiler
  // checks against; the project's own copy otherwise.
  add("world", worldDeclarations(session.loaded.source!));
  add("story", project.story?.properties ?? []);
  add("box", box.box.box.properties ?? []);
  if (deck) add("deck", deck.shard.deck.properties ?? []);
  const handNames = new Set<string>();
  /** An @hand entry, once per name: the first feeder to declare it wins. */
  const addHand = (p: Parameters<typeof add>[1][number]): void => {
    if (!handNames.has(p.name)) { handNames.add(p.name); add("hand", [p]); }
  };
  for (const group of box.tags.groups) {
    // GROUP-level declarations first: the compiler flattens these onto every
    // tag (the patrolled pattern - declared once, set per tag), so
    // @hand.<name> is a legal read. Feeding only per-tag declarations left
    // the expression editor calling a compiling reference unknown - an error
    // pill on the card with nothing in the problems bar to explain it.
    for (const p of group.properties ?? []) addHand(p);
    for (const tag of group.tags) {
      for (const p of tag.properties ?? []) addHand(p);
    }
  }
  // @hand composes tag props -> hand props -> chosen tags / criteria by
  // group name (schema 3.6), so the catalogue offers all three feeders.
  for (const hand of box.hands.hands) {
    for (const p of hand.properties ?? []) addHand(p);
  }
  for (const template of box.hands.templates) {
    for (const p of template.properties ?? []) addHand(p);
  }
  for (const group of box.tags.groups) {
    // The chosen tag reads as its gameId, so the closed set of values IS the
    // group's tags: an enum, which gets the picker a list to offer and makes a
    // misspelt tag name a fault. The same shape the compiler infers for @hand
    // (design/hand-typing.md step A), so the two cannot disagree.
    addHand({ name: effectiveGameId(group), type: "enum", values: group.tags.map((t) => effectiveGameId(t)) });
  }
  // The other tools' game-wide scopes (`@patter.visits`, a game's `@player.hp`), when the
  // game shares its scopes: offered in the picker with who declares them.
  out.push(...otherToolsCatalogue(session.loaded.source!));
  return out;
}
