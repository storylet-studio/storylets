// ---------------------------------------------------------------------------
// The project's structure over the bridge: boxes, decks, hands, hand
// templates and tag groups, and undo and redo. Every write runs in the write
// queue; every handler answers "no project open" when there is none.
// ---------------------------------------------------------------------------

import {
  createBox, createDeck, createTagGroup, deleteBox, deleteDeck, deleteTagGroup, duplicateBox, duplicateDeck,
  duplicateTagGroup, moveBox, moveDeck, renameDeck, saveBox, saveTagGroup,
} from "../mutate/structure.js";
import {
  createHand, createTemplate, deleteHand, deleteTemplate, duplicateHand, duplicateTemplate, moveHand, saveHand, saveTemplate,
} from "../mutate/hands.js";
import { createGroupAsMap } from "../mutate/map.js";
import { redo, undo } from "../mutate/write-path.js";
import { boxCatalogue } from "../read/catalogue.js";
import { handCards, handDetail, tagGroupDetail, templateDetail } from "../read/details.js";
import type { MainContext } from "../context.js";
import type { Ipc } from "./registrar.js";
import { sessionGuards } from "./registrar.js";

export function registerStructure(ipc: Ipc, deps: Pick<MainContext, "session">): void {
  const { project, read } = sessionGuards(deps.session);

  ipc.write("box:create", project(createBox));
  ipc.write("box:duplicate", project(duplicateBox));
  ipc.write("box:delete", project(deleteBox));
  ipc.write("box:move", project(moveBox));
  ipc.write("box:save", project(saveBox));
  ipc.handle("box:catalogue", read(boxCatalogue, []));

  ipc.write("deck:create", project(createDeck));
  ipc.write("deck:delete", project(deleteDeck));
  ipc.write("deck:rename", project(renameDeck));
  ipc.write("deck:duplicate", project(duplicateDeck));
  ipc.write("deck:move", project(moveDeck));

  ipc.handle("hand:detail", read(handDetail, null));
  ipc.handle("hand:cards", read(handCards, null));
  ipc.write("hand:save", project(saveHand));
  ipc.write("hand:create", project((open, boxId: string, site?: { x: number; y: number }, templateId?: string) =>
    createHand(open, boxId, site, typeof templateId === "string" ? templateId : undefined)));
  ipc.write("hand:delete", project(deleteHand));
  ipc.write("hand:duplicate", project(duplicateHand));
  ipc.write("hand:move", project(moveHand));

  ipc.handle("template:detail", read(templateDetail, null));
  ipc.write("template:save", project(saveTemplate));
  ipc.write("template:create", project(createTemplate));
  ipc.write("template:delete", project(deleteTemplate));
  ipc.write("template:duplicate", project(duplicateTemplate));

  ipc.handle("tag-group:detail", read(tagGroupDetail, null));
  ipc.write("tag-group:save", project(saveTagGroup));
  ipc.write("tag-group:create", project(createTagGroup));
  ipc.write("tag-group:delete", project(deleteTagGroup));
  ipc.write("tag-group:duplicate", project(duplicateTagGroup));
  // A new tag group that is already the map: one commit (review 2026-10, item 13).
  ipc.write("tag-group:createMap", project(createGroupAsMap));

  // An undo or redo that cannot write says so, and its step stays where it was.
  ipc.write("edit:undo", read(undo, null));
  ipc.write("edit:redo", read(redo, null));
}
