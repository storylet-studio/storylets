// ---------------------------------------------------------------------------
// Saving: Patterpad's dirty + autosave pattern, on our documents.
//
// Edits autosave ~700ms after they settle, with a visible status. Any pending
// write is flushed first on a transition (switching selection, opening the
// Board or Coverage, leaving or closing the window, Cmd+S) so nothing is lost
// and the simulation reads current disk. The clock and the status are the
// shell's save controller; WHAT is pending is ours, and lives here.
//
// Also here, because they are the same question asked of the same queue: the
// flush a delete waits on, whether the review walk or the problems bar may move
// the document away from a field, and Auto Rebuild, which follows the saves.
// ---------------------------------------------------------------------------

import { confirmDialog, createSaveController, debounce, isEditableTarget } from "@wildwinter/app-shell";
import type { ConfirmOptions, SaveStatus } from "@wildwinter/app-shell";
import { ok, quietly } from "./results.js";
import { remember } from "./session.js";
import type { Session } from "./session.js";
import type { BoxEdit, CardEdit, DeckEdit, HandEdit, OpenResult, TagGroupEdit, TemplateEdit } from "../../shared/api.js";

const AUTOSAVE_MS = 700;

type Mutation = () => Promise<OpenResult | { error: string }>;

export interface SaveQueueContext {
  session: Session;
  /** Take a mutation's answer whole: report it, or apply it. */
  applied: (r: OpenResult | { error: string }) => boolean;
  /** The save indicator's three states. */
  onStatus: (status: SaveStatus) => void;
  /** The navigator and the browse views; never the live editor. */
  repaintAfterSave: () => void;
  /** A write changes the local bits (checked out, read-only): re-badge. */
  refreshVc: () => void;
  /** Re-read the project after a quiet rebuild. */
  refreshProject: () => Promise<void>;
}

export type SaveQueue = ReturnType<typeof createSaveQueue>;

export function createSaveQueue(ctx: SaveQueueContext) {
  const studio = ctx.session.studio;
  /** Unwritten card edits, keyed by card so a later edit of the same one wins
   *  and edits of DIFFERENT cards queue up rather than evicting each other. */
  const pendingCards = new Map<string, { deckId: string; cardId: string; edit: CardEdit }>();
  /** Unwritten STRUCTURAL edits (box, deck config, template, tag group, hand,
   *  the Story page), in the order they were made.
   *
   *  Many slots, for the same reason `pendingCards` is a map: this was a single
   *  slot until 2026-08-29, so a second structural edit inside the 700ms window
   *  overwrote the first and it was never written at all. Renaming a tag group
   *  and then editing a hand, quickly, silently lost the rename. KEYED by the
   *  document and the fields an edit carries, since every field now commits as
   *  it is typed (ruling N): a later edit of the same thing replaces the one
   *  still waiting, so a sentence typed into a purpose is one write, not one
   *  per keystroke, and edits of different things all run, in the order made. */
  const pendingStructs = new Map<string, Mutation>();

  /**
   * The clock and the status are the shell's (0.14.0).
   *
   * Two things came back with it that the editor did not have. A maximum age,
   * so an author typing without pause is still written every few seconds rather
   * than only when they stop. And re-entrancy: this used to clear its queue and
   * then await the write, so a flush arriving mid-write saw nothing pending and
   * said "Saved" over bytes still in the air.
   */
  const saver = createSaveController({
    delayMs: AUTOSAVE_MS,
    onStatus: (status) => ctx.onStatus(status),
    write: async () => {
      const cards = [...pendingCards.values()]; pendingCards.clear();
      const structs = [...pendingStructs.values()]; pendingStructs.clear();   // take and clear in one step (re-entrancy)
      let landed = true;
      for (const pc of cards) if (!ctx.applied(await studio.saveCard(pc.deckId, pc.cardId, pc.edit))) landed = false;
      for (const run of structs) if (!ctx.applied(await run())) landed = false;
      ctx.repaintAfterSave();
      ctx.refreshVc();
      if (landed) scheduleAutoRebuild();
      return landed;
    },
  });

  // Auto Rebuild: when on, re-export the bundle shortly after edits settle so
  // the committed .storyletsc never goes stale. Quiet (no toast); the manual
  // Publish Bundle keeps its confirmation.
  const rebuildSoon = debounce(() => {
    void (async () => { if (ok(await studio.exportBundle(), quietly)) void ctx.refreshProject(); })();
  }, 600);
  function scheduleAutoRebuild(): void {
    if (ctx.session.state.autoRebuild) rebuildSoon();
  }

  function queueStruct(key: string, run: Mutation): void {
    // Delete first, so the replacement runs in the place of the latest edit.
    pendingStructs.delete(key);
    pendingStructs.set(key, run);
    saver.touch();
  }

  /** Keyed by the document and the fields the edit carries, so a later edit of
   *  the same thing replaces an earlier one still waiting (the box's partial
   *  edits, ranking and fields say, are different keys and both land). */
  const fieldsKey = (edit: object): string => Object.keys(edit).join(",");

  return {
    /** Write any pending edit now, and wait for it. */
    flush: (): Promise<void> => saver.flush(),
    /** An edit waiting, or a write still in flight. */
    get pending(): boolean { return saver.pending; },
    get status(): SaveStatus { return saver.status; },

    queueCard(deckId: string, cardId: string, edit: CardEdit): void {
      pendingCards.set(cardId, { deckId, cardId, edit });
      saver.touch();
    },
    queueStruct,
    saveBox(boxId: string, edit: BoxEdit): void { queueStruct(`box:${boxId}:${fieldsKey(edit)}`, () => studio.saveBox(boxId, edit)); },
    saveDeckConfig(deckId: string, edit: DeckEdit): void { queueStruct(`deck:${deckId}:${fieldsKey(edit)}`, () => studio.renameDeck(deckId, edit)); },
    saveTemplate(boxId: string, templateId: string, edit: TemplateEdit): void { queueStruct(`template:${templateId}`, () => studio.saveTemplate(boxId, templateId, edit)); },
    saveTagGroup(boxId: string, groupId: string, edit: TagGroupEdit): void { queueStruct(`tagGroup:${groupId}`, () => studio.saveTagGroup(boxId, groupId, edit)); },
    saveHand(boxId: string, handId: string, edit: HandEdit): void { queueStruct(`hand:${handId}`, () => studio.saveHand(boxId, handId, edit)); },

    /** Forget the waiting edits of cards about to be deleted: writing one would
     *  recreate the card. */
    dropCards(cardIds: string[]): void {
      for (const id of cardIds) pendingCards.delete(id);
    },

    /**
     * The delete guard's question, when there is one (deletes.ts builds it from
     * the evidence), after landing every pending edit: a delete is a write, and
     * a write that raced the save queue could recreate what it removed or lose an
     * edit made a moment before. True to go ahead.
     */
    async deleting(question: ConfirmOptions | undefined): Promise<boolean> {
      await saver.flush();
      return question === undefined || confirmDialog(question);
    },

    /**
     * Is it rude to move the document right now?
     *
     * The Board's rule, which A2 borrows: an ambient surface may move the VIEW
     * but must never move the author. Two cases where stepping stays put and
     * only updates what the bar says:
     *
     * - The cursor is in a field with an edit not yet written. Yanking the
     *   document away mid-sentence is the specific rudeness this exists to
     *   prevent, and the edit would be flushed by the navigation, so it would
     *   also be a silent save somebody did not ask for.
     * - Anything modal is up. A bar behind a dialog has no business changing
     *   what is underneath it.
     */
    mayStepAway(): boolean {
      if (document.querySelector("dialog[open]")) return false;
      if (!isEditableTarget(document.activeElement)) return true;
      // The controller's answer, which counts a write still in flight: every
      // field now commits as it is typed, so a pending edit is one being typed now.
      return !saver.pending;
    },

    /** Publish ▸ Auto Rebuild: on rebuilds once at once (a working build, so it
     *  pins nothing), then after every save that lands. */
    async toggleAutoRebuild(): Promise<void> {
      await remember(ctx.session, "autoRebuild", !ctx.session.state.autoRebuild);
      if (ctx.session.state.autoRebuild) rebuildSoon();
    },
  };
}
