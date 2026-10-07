// ---------------------------------------------------------------------------
// Every edit the editor can make, in one import. The work is in mutate/ (the
// write path, then a module per thing edited) and read/ (what the pages draw);
// this re-exports both, so a caller or a test that wants "the mutation API"
// names one module and need not know how it is filed.
// ---------------------------------------------------------------------------

export type { Written } from "./mutate/write-path.js";
export {
  commit, commitMaking, ensureBoxColours, freshKey, redo, refuse, reload, serialised, setProjectWrittenListener, undo,
} from "./mutate/write-path.js";
export {
  createCard, createCardOnCanvas, deleteCard, deleteCards, deleteCardsAcross, duplicateCard, layoutDeck, moveCard,
  moveCardsOnCanvas, saveCard, setCanvasFurniture,
} from "./mutate/cards.js";
export {
  createBox, createDeck, createTagGroup, deleteBox, deleteDeck, deleteTagGroup, duplicateBox, duplicateDeck,
  duplicateTagGroup, moveBox, moveDeck, renameDeck, saveBox, saveTagGroup,
} from "./mutate/structure.js";
export { saveProjectSettings } from "./mutate/settings.js";
export {
  createHand, createTemplate, deleteHand, deleteTemplate, duplicateHand, duplicateTemplate, moveHand, saveHand, saveTemplate,
} from "./mutate/hands.js";
export type { BackgroundEdit, MapSiteMove, SiteRebinding } from "./mutate/map.js";
export {
  addBackground, bindSitesToZones, boxMap, createGroupAsMap, createZone, editBackground, moveSitesOnMap, projectMapView,
  removeBackground, removeSitesFromMap, restackBackground, restackZone, setBoxColour, setGroupSpatial, setZonePolygon,
  useProjectMap,
} from "./mutate/map.js";
export { deleteCommentMessage, moveComment, postComment, setCommentResolved } from "./mutate/comments.js";
export { addCoverageDrivers, addNamedOutcome, declareProperty, repointTag } from "./mutate/quick-fixes.js";

// The reads the pages make between edits.
export { boxCatalogue, cardCatalogue } from "./read/catalogue.js";
export { handCards, handDetail, tagGroupDetail, templateDetail } from "./read/details.js";
export { mapZoneDetail, stampedAssetUrl } from "./read/map.js";
export { proposeDrivers } from "./read/coverage.js";
