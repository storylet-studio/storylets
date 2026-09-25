// ---------------------------------------------------------------------------
// Pin on publish (design/pin-on-publish.md in the workshop repo): every titled
// item whose gameId still follows its title gets that address written down,
// unchanged, so a later title edit (or a project-wide Replace) no longer moves
// a name that game code, a Patter scene or a venue may now rely on.
//
// The editor's Publish calls this; Auto Rebuild, Live Link and the CLI's
// export never do. Pinning at creation would freeze `new-card` before the
// author has settled on a title, which is why the moment is publish: the first
// time the name leaves the project.
//
// Boxes, decks, cards, outcomes, hand templates and hands. Tags and tag groups
// carry no title, so their address is already pinned or the raw id. An item
// with no title is still a draft and keeps falling back to its id: pinning
// that would freeze a meaningless name.
//
// Pure: returns what it pinned (for the toast) plus the planned shard writes,
// canonical, one per touched shard, which the caller commits through the VC
// layer. The value written is the address the item already had, so the
// bundle's names do not change.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { canonicalStringify } from "@storylet-studio/compiler";
import { SHARD_EXTENSIONS, effectiveGameId, gameIdify } from "@storylet-studio/model";
import type { LoadedProject } from "./load.js";
import type { ResolveKind } from "./resolve.js";
import type { PlannedWrite } from "./write.js";

/** One address written down. */
export interface PinnedName {
  /** The item's immutable id. */
  id: string;
  kind: ResolveKind;
  /** The address, now pinned: the same one it had while it followed the title. */
  gameId: string;
}

export interface PinPlan {
  pinned: PinnedName[];
  /** Shard writes the caller commits through the VC layer (one per touched shard). */
  writes: PlannedWrite[];
}

type Titled = { id: string; gameId?: string; title?: string };

/** The address to pin, or undefined when there is nothing to do: already
 *  pinned, or untitled (so still following its id, a draft). */
function toPin(item: Titled): string | undefined {
  if (item.gameId?.trim()) return undefined;
  if (!item.title || !gameIdify(item.title)) return undefined;
  return effectiveGameId(item);
}

/** Plan pinning every titled, unpinned address in the project. */
export function planPins(loaded: LoadedProject): PinPlan {
  const plan: PinPlan = { pinned: [], writes: [] };
  const source = loaded.source;
  if (!source) return plan;

  /** A copy of `item` with its address pinned, noted, or undefined when it
   *  needs none. */
  const pin = <T extends Titled>(item: T, kind: ResolveKind): T | undefined => {
    const gameId = toPin(item);
    if (gameId === undefined) return undefined;
    plan.pinned.push({ id: item.id, kind, gameId });
    return { ...item, gameId };
  };

  for (const box of source.boxes) {
    const nextBox = pin(box.box.box, "box");
    if (nextBox) {
      plan.writes.push({ path: join(loaded.dir, box.path, `box${SHARD_EXTENSIONS.box}`), content: canonicalStringify({ ...box.box, box: nextBox }) });
    }

    for (const deck of box.decks) {
      const nextDeck = pin(deck.shard.deck, "deck");
      let changed = nextDeck !== undefined;
      const cards = deck.shard.cards.map((card) => {
        const nextCard = pin(card, "card");
        let cardChanged = nextCard !== undefined;
        const outcomes = card.outcomes.map((o) => {
          const next = pin(o, "outcome");
          if (next) cardChanged = true;
          return next ?? o;
        });
        if (!cardChanged) return card;
        changed = true;
        return { ...(nextCard ?? card), outcomes };
      });
      if (changed) {
        plan.writes.push({
          path: join(loaded.dir, deck.path),
          content: canonicalStringify({ ...deck.shard, deck: nextDeck ?? deck.shard.deck, cards }),
        });
      }
    }

    // Hand templates and hands share a shard.
    let handsChanged = false;
    const templates = box.hands.templates.map((t) => { const n = pin(t, "template"); if (n) handsChanged = true; return n ?? t; });
    const hands = box.hands.hands.map((h) => { const n = pin(h, "hand"); if (n) handsChanged = true; return n ?? h; });
    if (handsChanged) {
      plan.writes.push({ path: join(loaded.dir, box.path, `hands${SHARD_EXTENSIONS.hands}`), content: canonicalStringify({ ...box.hands, templates, hands }) });
    }
  }
  return plan;
}
