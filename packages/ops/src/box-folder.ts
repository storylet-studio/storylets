// Where a box's shards live on disk.
//
// One box is four files in a folder - `box`, `tags`, `hands`, and a `decks/`
// subfolder - and until 2026-08-29 two places knew that: `runNewBox` here, and
// the editor's `duplicateBox`. They had already drifted on the folder NAME
// (one derived it from the title, the other from the box's gameId), which is
// how this kind of duplication announces itself before it does damage.
//
// One rule now, and it is the second one: the folder follows the box's
// ADDRESS. At creation the two agree, because a new box shard carries a title
// and no gameId, so `effectiveGameId` derives one from the title - but a box
// that is later renamed keeps its address, and the folder should keep it too.
import { join } from "node:path";
import { canonicalStringify } from "@storylet-studio/compiler";
import { SHARD_EXTENSIONS, effectiveGameId, gameIdify } from "@storylet-studio/model";
import type { BoxShard, DeckShard, HandsShard, TagsShard } from "@storylet-studio/model";
import type { PlannedWrite } from "./write.js";

/** The folder name a box's shards belong in, under the project directory. */
export const boxFolderName = (box: BoxShard): string => gameIdify(effectiveGameId(box.box));

/**
 * Every file one box is, as planned writes, rooted at `projectDir`.
 *
 * `PlannedWrite` is `{ path, content }`, which the editor's own `FileState`
 * accepts (its `content` is additionally nullable, for a delete), so both
 * callers take these unchanged.
 */
export function boxFolderWrites(
  projectDir: string,
  shards: { box: BoxShard; tags: TagsShard; hands: HandsShard; decks: DeckShard[] },
): PlannedWrite[] {
  const dir = join(projectDir, boxFolderName(shards.box));
  return [
    { path: join(dir, `box${SHARD_EXTENSIONS.box}`), content: canonicalStringify(shards.box) },
    { path: join(dir, `tags${SHARD_EXTENSIONS.tags}`), content: canonicalStringify(shards.tags) },
    { path: join(dir, `hands${SHARD_EXTENSIONS.hands}`), content: canonicalStringify(shards.hands) },
    ...shards.decks.map((deck) => ({
      path: join(dir, "decks", `${effectiveGameId(deck.deck)}${SHARD_EXTENSIONS.deck}`),
      content: canonicalStringify(deck),
    })),
  ];
}
