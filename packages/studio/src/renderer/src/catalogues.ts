// ---------------------------------------------------------------------------
// The condition catalogues the open page reads its expressions against.
//
// A card's conditions are read against its DECK's catalogue (which knows
// @deck); a hand, a hand template or a box page against the BOX's. Each comes
// from main, so the page draws with what it has and is drawn again when the
// answer lands. Kept here so a redraw does not fetch again.
// ---------------------------------------------------------------------------

import type { ConditionProperty } from "../../shared/api.js";
import type { Session } from "./session.js";

export interface CataloguesContext {
  session: Session;
  /** Draw the workspace (renderWorkspace). */
  render: () => void;
  /** Draw the centre alone (renderCentre). */
  renderCentre: () => void;
  /** The open box's decks, in order. */
  boxDecks: () => string[];
  /** Is this box's page the one showing? */
  onBoxPage: (boxId: string) => boolean;
}

export type Catalogues = ReturnType<typeof createCatalogues>;

export function createCatalogues(ctx: CataloguesContext) {
  const studio = ctx.session.studio;
  let catalogue: ConditionProperty[] = [];
  let catalogueDeck: string | undefined;
  let catalogueBox: string | undefined;
  /** Every deck's catalogue for one box's Contents, which draws all of its
   *  cards' conditions at once. Fetched together, drawn once they are all in,
   *  and kept for the box as the deck page keeps its own. */
  let boxCatalogues: { box: string; byDeck: Map<string, ConditionProperty[]> } | undefined;

  async function loadDeck(deckId: string): Promise<void> {
    catalogueDeck = deckId; catalogueBox = undefined;
    catalogue = await studio.cardCatalogue(deckId);
    ctx.render();
  }
  async function loadBox(boxId: string): Promise<void> {
    catalogueBox = boxId; catalogueDeck = undefined;
    catalogue = await studio.boxCatalogue(boxId);
    ctx.render();
  }

  return {
    loadDeck,

    /** The open deck's catalogue, kept loaded so card faces can preview their
     *  conditions. `catalogueDeck` is set at the START of the fetch, so the
     *  render the answer triggers does not fetch again; until it lands, the
     *  page draws with what is in hand. */
    forDeck(deckId: string): ConditionProperty[] {
      if (catalogueDeck !== deckId) {
        catalogueDeck = deckId; catalogueBox = undefined;
        void (async () => { catalogue = await studio.cardCatalogue(deckId); ctx.render(); })();
      }
      return catalogueDeck === deckId ? catalogue : [];
    },

    /** The box's catalogue, for a hand or a hand template: empty until it lands. */
    forBox(boxId: string): ConditionProperty[] {
      if (catalogueBox !== boxId) { catalogueBox = boxId; void loadBox(boxId); }
      return catalogueBox === boxId && !catalogueDeck ? catalogue : [];
    },

    /** One deck's catalogue for a page showing several decks' cards (a box's
     *  Contents): what it has now, fetched and redrawn when it has none. Keyed
     *  by the box AND its decks, so a deck made since is fetched too. */
    deckInBox(boxId: string, deckId: string): ConditionProperty[] {
      const decks = ctx.boxDecks();
      const key = `${boxId}:${decks.join(",")}`;
      if (boxCatalogues?.box === key) return boxCatalogues.byDeck.get(deckId) ?? [];
      const mine = { box: key, byDeck: new Map<string, ConditionProperty[]>() };
      boxCatalogues = mine;
      void (async () => {
        await Promise.all(decks.map(async (d) => { mine.byDeck.set(d, await studio.cardCatalogue(d)); }));
        if (boxCatalogues === mine && ctx.onBoxPage(boxId)) ctx.renderCentre();
      })();
      return [];
    },

    /** The deck's catalogue is stale (the project's properties changed, or it
     *  closed): the next draw fetches again. */
    forgetDeck(): void { catalogueDeck = undefined; },

    /** Fetch whichever catalogue is open again, after something outside the
     *  project changed it (Share Scopes); false when none was open. */
    async reload(): Promise<boolean> {
      if (catalogueDeck !== undefined) { await loadDeck(catalogueDeck); return true; }
      if (catalogueBox !== undefined) { await loadBox(catalogueBox); return true; }
      return false;
    },
  };
}
