// ---------------------------------------------------------------------------
// Cards over the bridge, and the deck's node canvas they sit on; and the
// problems bar's quick-fixes, which are ordinary edits to cards and their
// neighbours.
// ---------------------------------------------------------------------------

import {
  createCard, createCardOnCanvas, deleteCard, deleteCards, deleteCardsAcross, duplicateCard, layoutDeck, moveCard,
  moveCardsOnCanvas, saveCard, setCanvasFurniture,
} from "../mutate/cards.js";
import { addNamedOutcome, declareProperty, repointTag } from "../mutate/quick-fixes.js";
import { createPatterScene } from "../patter-scene.js";
import { cardCatalogue } from "../read/catalogue.js";
import { deckGraph } from "../read/canvas.js";
import type { MainContext } from "../context.js";
import type { Ipc } from "./registrar.js";
import { sessionGuards } from "./registrar.js";

export function registerCards(ipc: Ipc, deps: Pick<MainContext, "session">): void {
  const { project, read } = sessionGuards(deps.session);

  ipc.write("card:save", project(saveCard));
  ipc.write("card:create", project((open, deckId: string, place?: string, zone?: string) =>
    createCard(open, deckId, place, typeof zone === "string" ? zone : undefined)));
  ipc.write("card:duplicate", project(duplicateCard));
  ipc.write("card:delete", project(deleteCard));
  ipc.write("card:move", project(moveCard));
  ipc.handle("card:catalogue", read(cardCatalogue, []));
  // Several cards of one deck, as one undo step (review 2026-10, item 5).
  ipc.write("card:deleteMany", project((open, deckId: string, cardIds: string[]) =>
    deleteCards(open, deckId, Array.isArray(cardIds) ? cardIds : [])));
  // Cards spanning several decks (a box's Contents), still one undo step.
  ipc.write("card:deleteAcross", project((open, groups: unknown) => {
    const valid = Array.isArray(groups) ? groups.filter((g): g is { deckId: string; cardIds: string[] } =>
      typeof g === "object" && g !== null && typeof (g as { deckId?: unknown }).deckId === "string"
      && Array.isArray((g as { cardIds?: unknown }).cardIds) && (g as { cardIds: unknown[] }).cardIds.every((c) => typeof c === "string")) : [];
    return deleteCardsAcross(open, valid);
  }));

  // --- the deck's canvas ---------------------------------------------------------
  ipc.handle("graph:deck", (_event, deckId) => deckGraph(deps.session(), deckId));
  ipc.write("view:newCard", project(createCardOnCanvas));
  ipc.write("view:layout", project(layoutDeck));
  // Arranging: writes the box's `.storyletview` sidecar, never a content shard.
  // (The map's own arranging writes `.storyletmap` next door; see mutate/map.ts.)
  ipc.write("view:moveCards", project(moveCardsOnCanvas));
  ipc.write("canvas:setFurniture", project(setCanvasFurniture));

  // --- the problems bar's quick-fixes (storyletter.md section 4) ---------------------
  // Ordinary mutations: one undo step each, and the bar re-validates after, so a
  // fix that uncovers a second problem says so straight away.
  ipc.write("problem:declareProperty", project(declareProperty));
  ipc.write("problem:repointTag", project(repointTag));
  // The Patter quick fix: give a card the outcome its paired scene names (ops patter-link.ts).
  ipc.write("problem:addOutcome", project(addNamedOutcome));
  // The other Patter quick fix: write a stub scene for a card into the paired Patter project.
  ipc.write("problem:createScene", project(createPatterScene));
}
