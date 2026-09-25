// ---------------------------------------------------------------------------
// Pin on publish, main side (design/pin-on-publish.md in the workshop repo).
// The manual Publish Bundle writes down every address still following its
// title before it exports, through `commit`, the one mutation path, so it is
// ONE undo step and the project is re-read after. Auto Rebuild never calls
// this: it publishes seconds after every edit, and pinning there would freeze
// `new-card` before the author has named it.
//
// Under an author's key on a server-fetched project the shape shards are
// read-only (remote.ts `refuseWrite`), so only the deck shards are pinned:
// decks, cards and outcomes. The box, hand and hand-template addresses wait for
// the designer's publish, rather than the whole publish failing.
// ---------------------------------------------------------------------------

import { planPins } from "@storylet-studio/ops";
import type { PinnedName } from "@storylet-studio/ops";
import { commit } from "./mutate.js";
import { isShapeShard, readRemote } from "./remote.js";
import type { ProjectSession } from "./project.js";

let pinCounter = 0;

/** The kinds that live in a deck shard, which an author's key may write. */
const IN_DECK_SHARD = new Set<PinnedName["kind"]>(["deck", "card", "outcome"]);

/** Pin every titled, unpinned address the session may write. Returns what was
 *  pinned (empty when nothing needed it), or the commit's error. */
export function pinForPublish(session: ProjectSession): { pinned: PinnedName[] } | { error: string } {
  const plan = planPins(session.loaded);
  const author = readRemote(session.loaded.dir)?.role === "author";
  const writes = author ? plan.writes.filter((w) => !isShapeShard(w.path)) : plan.writes;
  const pinned = author ? plan.pinned.filter((p) => IN_DECK_SHARD.has(p.kind)) : plan.pinned;
  if (writes.length === 0) return { pinned: [] };
  const result = commit(session, "Pin game ids", `pin:${pinCounter++}`,
    writes.map((w) => ({ path: w.path, content: w.content })));
  return "error" in result ? result : { pinned };
}
