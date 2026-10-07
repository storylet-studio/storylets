// ---------------------------------------------------------------------------
// Where the author is standing, and how they move.
//
// The FOCUS is what the centre shows and the navigator lights; the INSPECTED
// document is what is open there (a card, a setup item, or the page itself);
// the DETAIL is what a setup document draws from, fetched rather than sent.
// Beside them: the selected cards a deck's three views share, the back/forward
// history (the shell's, over our idea of a place), the sideways-arrival return
// (structure rule 12), and the place remembered for the next launch (rule 13).
//
// The moves themselves are the views' actions (actions.ts); this module is
// what they move, and the questions every move asks of it.
// ---------------------------------------------------------------------------

import { closeAnchoredPanel, createNavHistory } from "@wildwinter/app-shell";
import { docTabFor, expandOutcome, setDocTab } from "./inspector.js";
import { navId, setCameFrom } from "./views.js";
import type { Detail, Inspected } from "./inspector.js";
import type { Focus, ViewActions } from "./views.js";
import type { SearchSelection } from "./search.js";
import type { Session } from "./session.js";
import type { ProjectDto, ReviewAt } from "../../shared/api.js";

/** Where the author is standing: focus + open document + its tab, the one
 *  shape rememberPlace persists, returnHere labels and the history stacks. */
export interface CapturedPlace { focus: Focus; inspected?: Inspected; key?: string; tab?: string }

export interface NavigationContext {
  session: Session;
  /** The views' actions: restoring a place re-dispatches through them. */
  actions: () => ViewActions;
  /** Draw the workspace (renderWorkspace). */
  render: () => void;
}

export type Navigation = ReturnType<typeof createNavigation>;

/** Same DOCUMENT: tab and selection twitches coalesce instead of stacking. */
const samePlace = (a: CapturedPlace, b: CapturedPlace): boolean =>
  a.focus.kind === b.focus.kind && a.focus.box === b.focus.box
  && (a.focus.kind !== "deck" || a.focus.deck === (b.focus as { deck?: string }).deck)
  && (a.key ?? "") === (b.key ?? "");

/** The tab-memory key of an open document (doc-tab-memory.ts). */
function docKey(doc: Inspected): string {
  return doc.kind === "card" ? `card:${doc.deck}:${doc.card}`
    : doc.kind === "deck" ? `deck:${doc.deck}`
    : doc.kind === "box" ? `box:${doc.box}`
    : doc.kind === "template" ? `template:${doc.template}`
    : doc.kind === "hand" ? `hand:${doc.hand}`
    : `tagGroup:${doc.group}`;
}

/** Still restorable against `project` as it is NOW? A place whose document was
 *  deleted since (a merge, a VC update, plain editing) must be skipped, not
 *  restored into a blank page. */
export function placeUsable(project: ProjectDto | undefined, p: CapturedPlace): boolean {
  if (!project) return false;
  if (p.focus.kind === "story" || p.focus.kind === "project") return true;
  if (p.focus.kind === "map") return project.map !== undefined;
  const box = project.boxes.find((b) => b.id === p.focus.box);
  if (!box) return false;
  const doc = p.inspected;
  if (doc?.kind === "card") return box.decks.some((d) => d.id === doc.deck && d.cards.some((c) => c.id === doc.card));
  if (doc?.kind === "deck" || p.focus.kind === "deck") {
    const id = doc?.kind === "deck" ? doc.deck : (p.focus as { deck: string }).deck;
    return box.decks.some((d) => d.id === id);
  }
  if (doc?.kind === "template") return box.templates.some((t) => t.id === doc.template);
  if (doc?.kind === "hand") return box.hands.some((h) => h.id === doc.hand);
  if (doc?.kind === "tagGroup") return box.tagGroups.some((g) => g.id === doc.group);
  return true;   // box / decks / hands pages: the box exists, that is enough
}

export function createNavigation(ctx: NavigationContext) {
  const { session } = ctx;
  const studio = session.studio;
  /** Arriving SIDEWAYS: set by `arriveFrom` around its own navigation. */
  let arriving = false;
  /** A back/forward restore in progress, which must not push what it left. */
  let travelling = false;

  const nav = {
    focus: undefined as Focus | undefined,
    inspected: undefined as Inspected | undefined,
    detail: undefined as Detail | undefined,
    /**
     * Every selected card in the focused deck, shared by its three views: a
     * selection made on the canvas shows in the card and table views too,
     * because they are three views OF one deck rather than three separate
     * places. The cursor is the one within it that the keyboard and Links follow.
     */
    selection: [] as string[],
    /** The keyboard cursor on the deck browse. */
    cursor: undefined as string | undefined,
    /** The navigator nodes the author has opened by their chevrons (persisted
     *  per user). The path to the focus is drawn open besides, transiently. */
    expanded: new Set<string>(),

    /** Select cards across the deck's views. The cursor moves to the last one
     *  touched, so keyboard browsing and the Links lens keep an anchor even when
     *  the author has several cards in hand. */
    selectCards(ids: string[]): void {
      nav.selection = ids;
      nav.cursor = ids.length > 0 ? ids[ids.length - 1] : undefined;
      void studio.setLinkFocus(nav.cursor);
    },

    /** Which card the Links lens should be looking at: the card the author last
     *  touched, whether that is a card OPEN in the editor or one selected in a
     *  deck's three views.
     *
     *  The fallback is load-bearing rather than a nicety. This is reported on
     *  every render, and while it reported only the open document it cleared
     *  the focus a card selection had just set the moment anything re-rendered:
     *  select a card on the node canvas, open Links, and the window said "open a
     *  card in the editor" about the card you had in hand. Two writers, one
     *  value, and the wrong one landed last. */
    lensCard(): string | undefined {
      return nav.inspected?.kind === "card" ? nav.inspected.card : nav.cursor;
    },

    /** The box the open page belongs to, if it has one. */
    currentBox(): ProjectDto["boxes"][number] | undefined {
      const id = nav.focus?.box ?? (nav.inspected && "box" in nav.inspected ? nav.inspected.box : undefined);
      return session.project?.boxes.find((b) => b.id === id);
    },

    /**
     * Every navigation starts here. Popovers do not survive it: a WHERE picker
     * floating over a different page taught nobody anything (the audit's orphan
     * find). The anchored panel closes through its own door; the body-portaled
     * poppers (ours and the expression editor's) are removed directly - their
     * click-away listeners self-heal on the next pointer-down.
     *
     * It clears the sideways return, so that is offered exactly once and only
     * where it makes sense, and it records the place it LEAVES (the browser
     * model, the shell's createNavHistory) - except a back/forward restore
     * itself, which travels through these same actions and must not push what
     * it just left.
     */
    goingSomewhere(): void {
      closeAnchoredPanel();
      for (const n of document.querySelectorAll(".popover, .ctxmenu, .exed-pop")) n.remove();
      if (!arriving) setCameFrom(undefined);
      if (!travelling) { const here = nav.capturePlace(); if (here) history.visit(here); }
    },

    /** Navigate SIDEWAYS (from a canvas, from Find, from Links), and remember the
     *  way back here: up and back are two moves, and this is the one the
     *  hierarchy cannot answer (structure rule 12). */
    arriveFrom(label: string, back: () => void, navigate: () => void): void {
      arriving = true;
      try { navigate(); } finally { arriving = false; }
      setCameFrom({ label, go: () => { setCameFrom(undefined); back(); } });
      ctx.render();
    },

    capturePlace(): CapturedPlace | undefined {
      if (!session.project || !nav.focus) return undefined;
      const f = { ...nav.focus } as Focus;
      const doc = nav.inspected ? { ...nav.inspected } as Inspected : undefined;
      const key = doc === undefined ? undefined : docKey(doc);
      const tab = key === undefined ? undefined : docTabFor(key);
      return { focus: f, ...(doc ? { inspected: doc } : {}), ...(key !== undefined ? { key } : {}), ...(tab !== undefined ? { tab } : {}) };
    },

    /** Re-dispatch through the same actions the original navigation used, so
     *  the document's detail loads the way it always does. */
    restorePlace(p: CapturedPlace): void {
      const actions = ctx.actions();
      const doc = p.inspected;
      if (doc?.kind === "card") actions.inspectCard(doc.box, doc.deck, doc.card);
      else if (doc?.kind === "template") actions.inspectTemplate(doc.box, doc.template);
      else if (doc?.kind === "tagGroup") actions.inspectTagGroup(doc.box, doc.group);
      else if (doc?.kind === "hand") actions.inspectHand(doc.box, doc.hand);
      else actions.focus(p.focus);
      if (p.key !== undefined && p.tab !== undefined) setDocTab(p.key, p.tab);
      ctx.render();
    },

    placeUsable(p: CapturedPlace): boolean {
      return placeUsable(session.project, p);
    },

    back(): void { travel((c) => history.back(c)); },
    forward(): void { travel((c) => history.forward(c)); },
    canBack(): boolean { return history.canBack(); },
    canForward(): boolean { return history.canForward(); },
    /** Forget both sides when the places stop meaning anything: another project
     *  opened, or the welcome screen with none. `usable` already hid the old
     *  project's places, but the arrows looked live (Patterpad clears on both). */
    clearHistory(): void { history.clear(); },

    /**
     * Where the author is standing right now, as an arriveFrom return: a label
     * naming the open document and the way back to it, tab included.
     */
    returnHere(): { label: string; go: () => void } | undefined {
      const project = session.project;
      const place = nav.capturePlace();
      if (!place || !project) return undefined;
      const doc = place.inspected;
      const box = place.focus.box === undefined ? undefined : project.boxes.find((b) => b.id === place.focus.box);
      let label = place.focus.kind === "story" ? "Story" : place.focus.kind === "map" ? "Map" : place.focus.kind === "project" ? project.name
        : box?.title ?? box?.gameId ?? "where you were";
      if (doc?.kind === "card") {
        const card = box?.decks.find((d) => d.id === doc.deck)?.cards.find((c) => c.id === doc.card);
        if (card?.title) label = card.title;
      } else if (doc?.kind === "deck") {
        const deck = box?.decks.find((d) => d.id === doc.deck);
        if (deck?.title) label = deck.title;
      }
      return { label, go: () => nav.restorePlace(place) };
    },

    /** Remember the page for next launch (structure rule 13). Called on every
     *  render rather than at each navigation, so a tab switch counts too; main
     *  writes only when the value actually changes. */
    rememberPlace(): void {
      const place = nav.capturePlace();
      if (!place) return;
      void studio.setLastPlace({
        focus: place.focus,
        ...(place.inspected ? { inspected: place.inspected } : {}),
        ...(place.tab !== undefined ? { tab: place.tab } : {}),
        ...(place.inspected?.kind === "hand" ? { handCards: true } : {}),
      });
    },

    /** Up a level (Esc, Cmd+Up, View > Up a Level): one level up the hierarchy. */
    goUp(): void {
      const actions = ctx.actions();
      const box = nav.currentBox();
      const focus = nav.focus;
      const inspected = nav.inspected;
      if (!box || !focus) return;
      if (inspected?.kind === "card" && focus.kind === "deck") { nav.selectCards([inspected.card]); actions.focus({ kind: "deck", box: focus.box, deck: focus.deck }); return; }
      // Setup items go up to the box page with their tab active (rule 10).
      if (inspected?.kind === "template") { setDocTab(`box:${box.id}`, "templates"); actions.focus({ kind: "box", box: box.id }); return; }
      if (inspected?.kind === "tagGroup") { setDocTab(`box:${box.id}`, "tags"); actions.focus({ kind: "box", box: box.id }); return; }
      if (inspected?.kind === "hand") { actions.focus({ kind: "hands", box: box.id }); return; }
      if (focus.kind === "deck") { actions.focus({ kind: "decks", box: box.id }); return; }
      if (focus.kind === "decks" || focus.kind === "hands") { actions.focus({ kind: "box", box: box.id }); return; }
      if (focus.kind === "box" || focus.kind === "story" || focus.kind === "map") { actions.focus({ kind: "project" }); return; }
    },

    /** The expandable nodes on the way to the current focus - navigation expands
     *  (never collapses) so the path to where you are is always visible. */
    navPath(): string[] {
      const f = nav.focus;
      if (!f || f.kind === "project" || f.kind === "story" || f.kind === "map") return [];
      const ids = [navId.box(f.box)];
      if (f.kind === "deck" || f.kind === "decks") ids.push(navId.collection(f.box, "decks"));
      else if (f.kind === "hands") ids.push(navId.collection(f.box, "hands"));
      return ids;
    },

    /** Where a project opens when nothing better is known: its first deck, or
     *  its first box. */
    defaultFocus(): Focus | undefined {
      const box = session.project?.boxes[0];
      if (!box) return undefined;
      const deck = box.decks[0];
      return deck ? { kind: "deck", box: box.id, deck: deck.id } : { kind: "box", box: box.id };
    },

    /**
     * The page the app was last closed on, checked against the project as it is
     * NOW and falling back UP THE TREE when what was open has gone: card, then
     * its deck, then its box, then the project's own default. A project edited on
     * another branch must never reopen to an error (structure rule 13).
     *
     * Returns undefined when there is nothing usable, and the caller falls back
     * to the ordinary default.
     */
    restoredPlace(): { focus: Focus; inspected?: Inspected } | undefined {
      const project = session.project;
      const place = session.state.lastPlace;
      if (!place || !project) return undefined;
      if (place.focus.kind === "story") return { focus: { kind: "story" } };
      if (place.focus.kind === "map") return project.map !== undefined ? { focus: { kind: "map" } } : undefined;
      const box = project.boxes.find((b) => b.id === place.focus.box);
      const deck = box?.decks.find((d) => d.id === place.focus.deck);
      const doc = place.inspected;

      // The document first, because it is the specific thing the author was looking at.
      if (doc && box) {
        const docDeck = box.decks.find((d) => d.id === doc.deck);
        const card = docDeck?.cards.find((c) => c.id === doc.card);
        if (doc.kind === "card" && docDeck && card) {
          if (place.tab) setDocTab(`card:${docDeck.id}:${card.id}`, place.tab);
          return { focus: { kind: "deck", box: box.id, deck: docDeck.id }, inspected: { kind: "card", box: box.id, deck: docDeck.id, card: card.id } };
        }
        if (doc.kind === "template" && box.templates.some((x) => x.id === doc.template)) {
          if (place.tab) setDocTab(`template:${doc.template}`, place.tab);
          return { focus: { kind: "box", box: box.id }, inspected: { kind: "template", box: box.id, template: doc.template! } };
        }
        if (doc.kind === "hand" && box.hands.some((x) => x.id === doc.hand)) {
          // ONCE, a hand left by a build before its Cards tab is not put back on
          // the tab it was left on: that build's first tab was Dealing, so
          // "dealing" there meant "the hand page", and the hand page now opens on
          // what can come up at it. Everything written since carries `handCards`,
          // and rule 13 (restore the document AND its tab) holds for it as for
          // every other page.
          if (place.tab && place.handCards === true) setDocTab(`hand:${doc.hand}`, place.tab);
          return { focus: { kind: "hands", box: box.id }, inspected: { kind: "hand", box: box.id, hand: doc.hand! } };
        }
        if (doc.kind === "tagGroup" && box.tagGroups.some((x) => x.id === doc.group)) {
          return { focus: { kind: "box", box: box.id }, inspected: { kind: "tagGroup", box: box.id, group: doc.group! } };
        }
      }
      // Then the deck it was in, then its box: the fallback up the tree.
      if (box && deck) {
        if (place.tab) setDocTab(`deck:${deck.id}`, place.tab);
        return { focus: { kind: "deck", box: box.id, deck: deck.id }, inspected: { kind: "deck", box: box.id, deck: deck.id } };
      }
      if (box) {
        // A box page remembers WHICH tab, which is the whole point for the Map.
        if (place.tab) setDocTab(`box:${box.id}`, place.tab);
        const kind = place.focus.kind === "decks" || place.focus.kind === "hands" ? place.focus.kind : "box";
        return { focus: { kind, box: box.id } as Focus, inspected: { kind: "box", box: box.id } };
      }
      return undefined;
    },

    /**
     * Fetch the open setup document's detail (a hand, a hand template or a tag
     * group draws from it, and it is fetched rather than sent), and draw it once
     * it arrives, if that document is still the one open. False when the open
     * document has no detail to fetch.
     */
    loadDetail(): boolean {
      const ins = nav.inspected;
      if (ins?.kind === "template") {
        void (async () => {
          const t = await studio.templateDetail(ins.box, ins.template);
          if (nav.inspected?.kind === "template" && nav.inspected.template === ins.template && t) { nav.detail = { kind: "template", template: t }; ctx.render(); }
        })();
        return true;
      }
      if (ins?.kind === "hand") {
        void (async () => {
          const hand = await studio.handDetail(ins.box, ins.hand);
          if (nav.inspected?.kind === "hand" && nav.inspected.hand === ins.hand && hand) { nav.detail = { kind: "hand", hand }; ctx.render(); }
        })();
        return true;
      }
      if (ins?.kind === "tagGroup") {
        void (async () => {
          const g = await studio.tagGroupDetail(ins.box, ins.group);
          if (nav.inspected?.kind === "tagGroup" && nav.inspected.group === ins.group && g) { nav.detail = { kind: "tagGroup", group: g }; ctx.render(); }
        })();
        return true;
      }
      return false;
    },

    /** A Find hit opens the item's own editor (v3: items are first-class docs).
     *  Hits arrive over IPC from the detached Find window (Cmd+F). */
    applySearchSelection(sel: SearchSelection): void {
      if (!session.project) return;
      const actions = ctx.actions();
      // A section opens the document on its Dealing tab first, and "when" then
      // lands on its condition: the Board's Why not? sending a reason home.
      if ((sel.kind === "card" || sel.kind === "deck") && sel.section !== undefined) {
        setDocTab(sel.kind === "card" ? `card:${sel.deck}/${sel.card}` : `deck:${sel.deck}`, "dealing");
      }
      if (sel.kind === "card") actions.inspectCard(sel.box, sel.deck, sel.card);
      else if (sel.kind === "deck") actions.focus({ kind: "deck", box: sel.box, deck: sel.deck });
      else if (sel.kind === "template") actions.inspectTemplate(sel.box, sel.template);
      else if (sel.kind === "hand") actions.openHand(sel.box, sel.hand);
      else actions.inspectTagGroup(sel.box, sel.group);
      if ((sel.kind === "card" || sel.kind === "deck") && sel.section === "when") {
        void landOnSection("when", sel.kind === "card" ? `card:${sel.deck}/${sel.card}` : `deck:${sel.deck}`);
      }
    },

    /** Go to anywhere a comment can live or a `--at` launch can name: a Find
     *  hit's item, a box, or an outcome (its card, with that outcome expanded). */
    goTo(at: ReviewAt): void {
      if (!session.project) return;
      const actions = ctx.actions();
      if (at.kind === "map") actions.focus({ kind: "map" });
      else if (at.kind === "box") actions.focus({ kind: "box", box: at.box });
      else if (at.kind === "outcome") {
        actions.inspectCard(at.box, at.deck, at.card);
        // The card editor keys its tab state by DECK and card, because the same
        // card id opening under a different deck is a different document.
        setDocTab(`card:${at.deck}/${at.card}`, "outcomes");
        expandOutcome(at.deck, at.card, at.outcome);
        ctx.render();
      } else nav.applySearchSelection(at);
    },
  };

  /** The back/forward stack (the shell's, over our own idea of a place). */
  const history = createNavHistory<CapturedPlace>({ same: samePlace, usable: (p) => placeUsable(session.project, p) });

  function travel(step: (current: CapturedPlace) => CapturedPlace | undefined): void {
    const current = nav.capturePlace();
    if (!current) return;
    const there = step(current);
    if (!there) return;
    travelling = true;
    try { nav.restorePlace(there); } finally { travelling = false; }
  }

  return nav;
}

/** Bring a marked section of a document (`data-land`, on the document named by
 *  `data-land-for`) to the middle of the page and light it for a moment, as
 *  app-shell's `revealRowWhenReady` does for a settings row. Retried over the
 *  next frames, since a card's detail arrives on its own time after the
 *  navigation; matching the document as well as the section is what stops it
 *  lighting the When of the card that was showing before. Giving up is quiet. */
export function landOnSection(name: string, owner: string, tries = 30): Promise<boolean> {
  const find = (): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>("[data-land]")].find((e) => e.dataset.land === name && e.dataset.landFor === owner);
  const light = (sect: HTMLElement, scroll: boolean): void => {
    if (scroll) {
      const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      sect.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    }
    sect.classList.remove("landed");
    void sect.offsetWidth;
    sect.classList.add("landed");
    sect.addEventListener("animationend", () => sect.classList.remove("landed"), { once: true });
  };
  // A page can draw twice as it finishes loading (a deck's does), replacing the
  // section that was just lit. For a moment after landing, a replaced section's
  // successor is lit in its place, so the mark survives the redraw.
  const follow = (sect: HTMLElement, left: number): void => {
    if (left <= 0) return;
    requestAnimationFrame(() => {
      if (sect.isConnected) { follow(sect, left - 1); return; }
      const next = find();
      if (next) { light(next, false); follow(next, left - 1); } else follow(sect, left - 1);
    });
  };
  return new Promise((resolve) => {
    const attempt = (left: number): void => {
      const sect = find();
      if (sect) { light(sect, true); follow(sect, 60); resolve(true); return; }
      if (left <= 0) { resolve(false); return; }
      requestAnimationFrame(() => attempt(left - 1));
    };
    attempt(tries);
  });
}
