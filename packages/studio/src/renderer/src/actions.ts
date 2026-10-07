// ---------------------------------------------------------------------------
// What the pages can ask the editor to do: the views' actions (views.ts
// ViewActions) and the document pages' host (inspector.ts InspectorHost).
//
// Two interfaces because the two halves of the centre were written apart, and
// both are tested apart; ONE set of implementations behind them. Where both
// ask for the same thing (a comment opener, a queued save, a delete, a hand
// opened), both are handed the same function rather than one calling the
// other, which is how they used to delegate back and forth.
//
// Creating things lives here too: every create, duplicate and delete, and the
// one guarded path every card delete takes.
// ---------------------------------------------------------------------------

import { confirmDialog } from "@wildwinter/app-shell";
import { refusalDialog } from "./refusal-dialog.js";
import { openBoxKitPicker } from "./kits.js";
import { boxConfirm, cardsConfirm, handConfirm, templateConfirm } from "./deletes.js";
import { noteMadeInDeck, setDocTab } from "./inspector.js";
import { ok } from "./results.js";
import { remember } from "./session.js";
import type { InspectorHost } from "./inspector.js";
import type { Focus, ViewActions } from "./views.js";
import type { Navigation } from "./navigation.js";
import type { SaveQueue } from "./save-queue.js";
import type { Comments } from "./comments.js";
import type { Catalogues } from "./catalogues.js";
import type { MapPage } from "./map-page.js";
import type { DeckCanvas } from "./deck-canvas.js";
import type { Session } from "./session.js";
import type { BoxEdit, DeckEdit, OpenResult } from "../../shared/api.js";

export interface ActionsContext {
  session: Session;
  nav: Navigation;
  saves: SaveQueue;
  comments: Comments;
  catalogues: Catalogues;
  mapPage: MapPage;
  deckCanvas: DeckCanvas;
  /** Draw the workspace, the centre, the navigator (renderer.ts). */
  render: () => void;
  renderCentre: () => void;
  renderNavPane: () => void;
  applied: (r: OpenResult | { error: string }) => boolean;
  applyResult: (r: OpenResult) => void;
  refreshVc: () => void;
  /** The project map upgrade's prompt (renderer.ts). */
  offerMapUpgrade: (asked: boolean) => Promise<void>;
  openSettings: (section?: string) => void;
  /** A freshly made thing asks to be named: focus its title on the next draw. */
  focusNewTitle: () => void;
}

export type Actions = ReturnType<typeof createActions>;

export function createActions(ctx: ActionsContext) {
  const { session, nav, saves, comments, catalogues } = ctx;
  const studio = session.studio;
  const { deleting } = saves;

  /** A box's or deck's title or address, written now: a rename moves a file, so
   *  these commit on blur rather than through the save controller. The open
   *  document is a live editor, so only the browse views repaint. */
  function saveBoxIdentityNow(boxId: string, edit: BoxEdit): void {
    void (async () => { if (ctx.applied(await studio.saveBox(boxId, edit))) ctx.renderNavPane(); })();
  }
  function renameDeckNow(deckId: string, edit: DeckEdit): void {
    void (async () => { if (ctx.applied(await studio.renameDeck(deckId, edit))) ctx.renderNavPane(); })();
  }

  /**
   * Make something, then open it asking to be named. Every create and duplicate
   * is this: wait for pending edits when it copies (a duplicate reads the
   * files), make it, take the result, ask for the title, open it.
   */
  function making<T extends { result: OpenResult }>(
    make: () => Promise<T | { error: string }>, open: (created: T) => void, flushFirst = false,
  ): void {
    void (async () => {
      if (flushFirst) await saves.flush();
      const created = await make();
      if (!ok(created)) return;
      ctx.applyResult(created.result);
      ctx.focusNewTitle();
      open(created);
    })();
  }

  /**
   * Delete cards from one deck: the one path for the Delete key, the context
   * menus, the card's own page and the canvas, in every view. One call, one
   * commit, one undo step, and one render, however many cards (the dialog has
   * always promised one step; it was one per card).
   *
   * The deck comes from the caller rather than from the focus, so a card in a
   * box's Contents, which shows several decks, deletes too. True when they
   * went: the canvas then lets a frame in the same selection go too, never
   * ahead of a cancelled question.
   */
  async function deleteCards(deckId: string, cardIds: string[]): Promise<boolean> {
    const deck = session.project?.boxes.flatMap((b) => b.decks).find((d) => d.id === deckId);
    if (!deck || cardIds.length === 0) return false;
    const cards = deck.cards.filter((c) => cardIds.includes(c.id));
    if (cards.length === 0) return false;
    // Writing an edit of a card we are about to delete would recreate it.
    saves.dropCards(cards.map((c) => c.id));
    if (!(await deleting(cardsConfirm(cards)))) return false;
    if (!ctx.applied(await studio.deleteCards(deckId, cards.map((c) => c.id)))) return false;
    nav.selectCards([]);
    // The card's own page goes back to its deck; any other page stays.
    const open = nav.inspected;
    if (open?.kind === "card" && cards.some((c) => c.id === open.card)) {
      nav.inspected = { kind: "deck", box: open.box, deck: deckId };
    }
    ctx.render();
    return true;
  }

  /**
   * The selection, wherever it is drawn: one deck's, or a box's Contents, whose
   * cards can come from several decks. One question for all of them, then one
   * delete for the lot.
   */
  async function deleteSelection(): Promise<void> {
    const box = nav.currentBox();
    const selection = nav.selection;
    if (!box || selection.length === 0) return;
    const byDeck = new Map<string, string[]>();
    for (const deck of box.decks) {
      const ids = deck.cards.filter((c) => selection.includes(c.id)).map((c) => c.id);
      if (ids.length > 0) byDeck.set(deck.id, ids);
    }
    if (byDeck.size <= 1) {
      const [only] = [...byDeck.entries()];
      if (only) await deleteCards(only[0], only[1]);
      return;
    }
    const cards = box.decks.flatMap((d) => d.cards).filter((c) => selection.includes(c.id));
    saves.dropCards(cards.map((c) => c.id));
    if (!(await deleting(cardsConfirm(cards)))) return;
    // One undo step for the lot, however many decks it spans.
    if (!ctx.applied(await studio.deleteCardsAcross([...byDeck].map(([deckId, cardIds]) => ({ deckId, cardIds }))))) return;
    nav.selectCards([]);
    ctx.render();
  }

  async function deleteDeck(boxId: string, deckId: string): Promise<void> {
    const deck = session.project?.boxes.find((b) => b.id === boxId)?.decks.find((d) => d.id === deckId);
    // A deck with cards is refused by main, naming why: nothing to ask here.
    if (!deck || !(await deleting(undefined))) return;
    if (!ctx.applied(await studio.deleteDeck(deckId))) return;
    nav.focus = { kind: "box", box: boxId }; nav.inspected = { kind: "box", box: boxId };
    ctx.render();
  }

  async function deleteTemplate(boxId: string, templateId: string): Promise<void> {
    const template = session.project?.boxes.find((b) => b.id === boxId)?.templates.find((t) => t.id === templateId);
    if (!template || !(await deleting(templateConfirm(template)))) return;
    if (!ctx.applied(await studio.deleteTemplate(boxId, templateId))) return;
    nav.detail = undefined;
    setDocTab(`box:${boxId}`, "templates"); actions.focus({ kind: "box", box: boxId });
  }

  /** No question here: main refuses a group that cards still carry, and says how
   *  many, so asking first would only be asking about a delete that cannot
   *  happen. An unused group goes at once (undo brings it back). */
  async function deleteTagGroup(boxId: string, groupId: string): Promise<void> {
    if (!(await deleting(undefined))) return;
    if (!ctx.applied(await studio.deleteTagGroup(boxId, groupId))) return;
    nav.detail = undefined;
    setDocTab(`box:${boxId}`, "tags"); actions.focus({ kind: "box", box: boxId });
  }

  /** A hand's evidence is its pin on the project map, which only the map knows. */
  async function deleteHand(boxId: string, handId: string): Promise<void> {
    const box = session.project?.boxes.find((b) => b.id === boxId);
    const hand = box?.hands.find((x) => x.id === handId);
    if (!box || !hand) return;
    const pinned = box.usesMap === true
      && (await studio.projectMapView()).layers.some((l) => l.box === boxId && l.sites.some((s) => s.id === handId));
    if (!(await deleting(handConfirm(hand, pinned)))) return;
    if (!ctx.applied(await studio.deleteHand(boxId, handId))) return;
    nav.detail = undefined; actions.focus({ kind: "hands", box: boxId });
  }

  /**
   * Make a card at a place and open it, the way any new card opens (on Dealing,
   * title focused), with the way back to where it was made. One path for the
   * three doors: a hand's Cards tab, a site on the map, and a zone on the map.
   */
  function newCardAt(boxId: string, deckId: string, place: { hand?: string; zone?: string }, back: { label: string; go: () => void }): void {
    making(() => studio.createCard(deckId, place.hand, place.zone), (created) => {
      setDocTab(`card:${deckId}/${created.cardId}`, "dealing");
      nav.arriveFrom(back.label, back.go, () => actions.inspectCard(boxId, deckId, created.cardId));
    }, true);
  }

  /** Arrive at a page: persist the previous selection, then switch. */
  function arrive(): void {
    nav.goingSomewhere();
    void saves.flush();
  }

  const actions: ViewActions = {
    // The comment openers, the comment machinery's own (comments.ts).
    openThreads: comments.openThreads,
    showComments: comments.showComments,
    focus(next: Focus): void {
      arrive();
      nav.focus = next;
      if (next.kind === "deck") { nav.inspected = { kind: "deck", box: next.box, deck: next.deck }; }
      else if (next.kind === "box") nav.inspected = { kind: "box", box: next.box };
      else nav.inspected = undefined;
      ctx.render();
    },
    // Opening a card also selects it, so coming back to any view of the deck (the
    // canvas included) shows where you were.
    inspectCard(box, deck, card) { arrive(); nav.focus = { kind: "deck", box, deck }; nav.inspected = { kind: "card", box, deck, card }; nav.selectCards([card]); void catalogues.loadDeck(deck); },
    // Setup items (templates, tag groups) open as centre documents while the
    // focus stays the box: their home is the box page's setup tab, not a nav
    // collection, so the nav lights the box row (the Mail model, rule 9).
    inspectTemplate(box, template) { arrive(); setDocTab(`box:${box}`, "templates"); nav.focus = { kind: "box", box }; nav.inspected = { kind: "template", box, template }; nav.detail = undefined; ctx.render(); nav.loadDetail(); },
    inspectTagGroup(box, group) { arrive(); setDocTab(`box:${box}`, "tags"); nav.focus = { kind: "box", box }; nav.inspected = { kind: "tagGroup", box, group }; nav.detail = undefined; ctx.render(); nav.loadDetail(); },
    inspectHand(box, hand) { arrive(); nav.focus = { kind: "hands", box }; nav.inspected = { kind: "hand", box, hand }; nav.detail = undefined; ctx.render(); nav.loadDetail(); },
    // The ways in that are about the PLACE (a pin, a Hands row, the Board's hand,
    // a Find hit) open it on Cards: a jump that targets a tab, which the tab
    // memory counts as the author's latest choice like any click on the bar
    // (doc-tab-memory.ts). A problem's jump does not come through here, so it
    // keeps the remembered tab.
    openHand(box, hand) { setDocTab(`hand:${hand}`, "cards"); actions.inspectHand(box, hand); },
    newCard(box, deck) {
      making(() => studio.createCard(deck), (created) => {
        // Creation is authoring from the top: the new document opens on its
        // default tab, recorded as the type's choice (the one carve-out from
        // the sticky-tab ruling, design/editor-legibility.md piece 6).
        setDocTab(`card:${deck}/${created.cardId}`, "dealing");
        noteMadeInDeck(created.cardId);
        actions.inspectCard(box, deck, created.cardId);
      });
    },
    newDeck(box) {
      making(() => studio.createDeck(box), (created) => {
        setDocTab(`deck:${created.deckId}`, "cards");
        actions.focus({ kind: "deck", box, deck: created.deckId });
      });
    },
    newBox() {
      // The New Box moment is a kit picker (RebootAmendments A10): Blank always
      // present, RPG the narrated starter. Kits are scaffold - the box is yours
      // (and indistinguishable from hand-made) the moment it lands.
      openBoxKitPicker((kit) => {
        making(() => studio.createBox(kit), (created) => actions.focus({ kind: "box", box: created.boxId }));
      });
    },
    duplicateBox(box) {
      making(() => studio.duplicateBox(box), (created) => actions.focus({ kind: "box", box: created.boxId }), true);
    },
    deleteBox(box) {
      const b = session.project?.boxes.find((x) => x.id === box);
      if (!b) return;
      void (async () => {
        if (!(await deleting(boxConfirm(b)))) return;
        const result = await studio.deleteBox(box);
        if (!ctx.applied(result)) return;
        nav.focus = nav.defaultFocus();
        nav.inspected = nav.focus?.kind === "deck" ? { kind: "deck", box: nav.focus.box, deck: nav.focus.deck } : undefined;
        nav.detail = undefined;
        ctx.render();
      })();
    },
    newTemplate(box) { making(() => studio.createTemplate(box), (created) => actions.inspectTemplate(box, created.templateId)); },
    newTagGroup(box) { making(() => studio.createTagGroup(box), (created) => actions.inspectTagGroup(box, created.groupId)); },
    // On a project from before the project map, its maps are still in its boxes,
    // and "Make a map" would start a second one beside them: the way on is the
    // upgrade, which lifts the map it already has (part A's dialog).
    newMap(box) {
      const project = session.project;
      if (project !== undefined && project.map === undefined && project.boxes.some((b) => b.tagGroups.some((g) => g.spatial === true))) {
        void ctx.offerMapUpgrade(true);
        return;
      }
      // A tag group that is already a map: one call, one commit, one undo step
      // (it was two calls, and so two steps, of which the first coalesced with
      // the last tag group edit).
      making(() => studio.createGroupAsMap(box), (created) => {
        actions.inspectTagGroup(box, created.groupId);   // the Map tab appears with it
        ctx.refreshVc();
      });
    },
    newHand(box) { making(() => studio.createHand(box), (created) => actions.inspectHand(box, created.handId)); },
    editBox(box) { setDocTab(`box:${box}`, "template"); actions.focus({ kind: "box", box }); },
    toggleNav(id) {
      const expanded = nav.expanded;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      void studio.setNavExpanded([...expanded]);
      ctx.renderNavPane();
    },
    openProjectSettings() { if (session.project) ctx.openSettings(); },
    revealProject() { studio.revealProject(); },
    saveDeck(deckId, edit) { renameDeckNow(deckId, edit); },
    saveBox(boxId, edit) { saveBoxIdentityNow(boxId, edit); },
    // The same edits through the save controller, as the document pages queue theirs.
    saveDeckLater: saves.saveDeckConfig,
    saveBoxLater: saves.saveBox,
    duplicateCard(box, deck, card) {
      making(() => studio.duplicateCard(deck, card), (created) => actions.inspectCard(box, deck, created.cardId), true);
    },
    // Every route to deleting a card goes through the guard: the context menus in
    // all three views and a box's Contents, the Delete key, and the canvas. The
    // deck comes from the caller, since a box's Contents shows several.
    deleteCard(_box, deck, card) { void deleteCards(deck, [card]); },
    // Asking about a card does not select it: the lens is pointed straight at it, so
    // a look at what touches a card leaves the editor exactly where it was.
    showLinks(card) { void studio.openLinks(card); },
    moveBox(box, target, before) { void (async () => { if (ctx.applied(await studio.moveBox(box, target, before))) ctx.render(); })(); },
    moveDeck(_box, deck, target, before) { void (async () => { if (ctx.applied(await studio.moveDeck(deck, target, before))) ctx.render(); })(); },
    moveHand(box, hand, target, before) { void (async () => { if (ctx.applied(await studio.moveHand(box, hand, target, before))) ctx.render(); })(); },
    duplicateDeck(box, deck) {
      making(() => studio.duplicateDeck(deck), (created) => actions.focus({ kind: "deck", box, deck: created.deckId }), true);
    },
    deleteDeck(box, deck) { void deleteDeck(box, deck); },
    duplicateTemplate(box, template) {
      making(() => studio.duplicateTemplate(box, template), (created) => actions.inspectTemplate(box, created.templateId), true);
    },
    deleteTemplate(box, template) { void deleteTemplate(box, template); },
    duplicateHand(box, hand) {
      making(() => studio.duplicateHand(box, hand), (created) => actions.inspectHand(box, created.handId), true);
    },
    deleteHand(box, hand) { void deleteHand(box, hand); },
    duplicateTagGroup(box, group) {
      making(() => studio.duplicateTagGroup(box, group), (created) => actions.inspectTagGroup(box, created.groupId), true);
    },
    deleteTagGroup(box, group) { void deleteTagGroup(box, group); },
    selectCard(card, how) {
      // The OS's three gestures (parity row 46): a click replaces, cmd/ctrl
      // toggles, and shift fills the contiguous run in deck order from the
      // anchor (the first card selected) to this one, the clicked card ending up
      // as the cursor.
      const selection = nav.selection;
      let next: string[];
      if (how === "toggle") {
        next = selection.includes(card) ? selection.filter((id) => id !== card) : [...selection, card];
      } else if (how === "range" && selection.length > 0) {
        const here = nav.focus;
        const order = (here?.kind === "deck" ? nav.currentBox()?.decks.find((d) => d.id === here.deck)?.cards : undefined)?.map((c) => c.id) ?? [];
        const a = order.indexOf(selection[0]!);
        const b = order.indexOf(card);
        next = a < 0 || b < 0 ? [card] : order.slice(Math.min(a, b), Math.max(a, b) + 1);
        if (a > b) next.reverse();
      } else {
        next = [card];
      }
      nav.selectCards(next);
      ctx.renderCentre();
    },
    setViewMode(mode) { void remember(session, "viewMode", mode); ctx.renderCentre(); },
    mountNodeView(host, deck) { ctx.deckCanvas.mount(host, deck); },
    mountBoxSites(host, box) { ctx.mapPage.mountBoxSites(host, box); },
    cardGroup(box, page) { return session.state.cardGroups?.[box]?.[page]; },
    deckCatalogue(box, deck) { return catalogues.deckInBox(box, deck); },
    setCardGroup(box, page, key) {
      // A person's way of looking (app state), so no undo and no shard: the
      // same footing as the map's layers.
      const state = session.state;
      session.state = { ...state, cardGroups: { ...state.cardGroups, [box]: { ...state.cardGroups?.[box], [page]: key } } };
      void studio.setCardGroup(box, page, key);
      ctx.renderCentre();
    },
    openMap(select) {
      ctx.mapPage.select(select);
      actions.focus({ kind: "map" });
    },
    useProjectMap(box, on) {
      void (async () => {
        await saves.flush();
        let result = await studio.useProjectMap(box, on);
        // Refused while something still names the map: main says what, by its
        // title, and the prompt offers to open it.
        if ("refused" in result) {
          const r = result.refused;
          const open = await refusalDialog({ title: r.title, body: r.body, ...(r.open !== undefined ? { openLabel: `Open "${r.open.label}"` } : {}) });
          if (!open || r.open === undefined) return;
          const at = r.open;
          if (at.kind === "hand") actions.openHand(at.box, at.id);
          else if (at.kind === "template") actions.inspectTemplate(at.box, at.id);
          else if (at.kind === "card") actions.inspectCard(at.box, at.deck, at.id);
          else actions.focus({ kind: "deck", box: at.box, deck: at.id });
          return;
        }
        // Leaving deletes the box's positions on the map: main says how many and
        // asks, and only a yes sends it again.
        if ("confirm" in result) {
          const leave = await confirmDialog({ title: result.confirm.title, body: result.confirm.body, confirmLabel: "Leave the map" });
          if (!leave) return;
          result = await studio.useProjectMap(box, on, true);
          if ("confirm" in result || "refused" in result) return;
        }
        if (!ctx.applied(result)) return;
        // Joining lands on the box's new Map tab, which is what it now leads
        // with; leaving goes back to Contents, the tab having gone.
        setDocTab(`box:${box}`, on ? "map" : "contents");
        ctx.render();
        ctx.refreshVc();
      })();
    },
    moveCard(_box, deck, card, target, before) {
      void (async () => {
        await saves.flush();
        if (ctx.applied(await studio.moveCard(deck, card, target, before))) ctx.renderCentre();
      })();
    },
  };

  /** What the document pages ask of the editor (inspector.ts). */
  const host: InspectorHost = {
    openThreads: comments.openThreads,
    showComments: comments.showComments,
    saveCard: saves.queueCard,
    saveBox: saves.saveBox,
    saveDeckConfig: saves.saveDeckConfig,
    saveTemplate: saves.saveTemplate,
    saveTagGroup: saves.saveTagGroup,
    saveHand: saves.saveHand,
    // Through the guard, like every other route to deleting a card: this one is
    // the card's own page, where the content at risk is on screen in front of you.
    deleteCard: (deckId, cardId) => void deleteCards(deckId, [cardId]),
    deleteTemplate: (boxId, templateId) => void deleteTemplate(boxId, templateId),
    deleteHand: (boxId, handId) => void deleteHand(boxId, handId),
    deleteTagGroup: (boxId, groupId) => void deleteTagGroup(boxId, groupId),
    handCards: (boxId, handId) => studio.handCards(boxId, handId),
    deckCatalogue: (deckId) => studio.cardCatalogue(deckId),
    openHand: actions.openHand,
    // From a hand's Cards tab, sideways: the card's parent is its deck, and the
    // way back to the place it was opened from is offered beside the way up
    // (structure rule 12), as the map does for a pin.
    openCardFromHand: (boxId, deckId, cardId, hand) =>
      nav.arriveFrom(hand.title, () => actions.openHand(boxId, hand.id), () => actions.inspectCard(boxId, deckId, cardId)),
    newCardAtHand: (boxId, deckId, hand) =>
      newCardAt(boxId, deckId, { hand: hand.id }, { label: hand.title, go: () => actions.openHand(boxId, hand.id) }),
    setGroupSpatial: (boxId, groupId, on) => void (async () => {
      // The whole box page repaints: the Map tab appears or goes, and the
      // group's own page has to show the switch in its new state.
      if (!ctx.applied(await studio.setGroupSpatial(boxId, groupId, on))) return;
      ctx.render();
      ctx.refreshVc();
    })(),
  };

  return { actions, host, deleteCards, deleteSelection, newCardAt };
}
