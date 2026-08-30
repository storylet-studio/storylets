// ---------------------------------------------------------------------------
// The new-box op: add a box (folder + shards) to an existing project,
// scaffolded from a KIT (RebootAmendments A10). A kit is a copied starting
// point, yours the moment it lands - fully editable, no kit reference in
// the schema. Blank is the empty box; RPG is the encounters starter whose
// purpose notes narrate the model (tags file cards, a hand template with a
// hole, one hand instancing it, a sample deck). Pure planned writes, like
// runInit: the caller commits them through its own write layer.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import {
  BOX_SCHEMA, DECK_SCHEMA, HANDS_SCHEMA, SHARD_EXTENSIONS, SPATIAL, TAGS_SCHEMA, effectiveGameId, freeGameId, freeTitle, gameIdify,
} from "@storylet-studio/model";
import type { BoxShard, Card, DeckShard, HandsShard, HandTemplate, TagGroup, TagsShard } from "@storylet-studio/model";
import { canonicalStringify } from "@storylet-studio/compiler";
import { newId } from "./ids.js";
import type { LoadedProject } from "./load.js";
import type { PlannedWrite } from "./write.js";
import { boxFolderWrites } from "./box-folder.js";

/** A box kit: the scaffold a new box copies. Blank is always present; the
 *  narrated starters each teach a chapter of the model (A10): RPG teaches
 *  boxes, tags and a drawn map, dialogue teaches hands, exclusivity and
 *  copies. (A `barks` kit taught the look/use rule and redraw until
 *  2026-08-29, when it was withdrawn: barks are Patter's domain and a kit
 *  here encouraged the wrong tool. No kit teaches the card template now.) */
/** Every kit, in picker order. The ONE list: `BoxKit` is derived from it, the
 *  CLI validates and prints its usage from it, and the editor's picker reads
 *  it. It was written out separately in all three until 2026-08-29, which is
 *  why withdrawing `barks` was a four-file edit and why the CLI's usage line
 *  still offered two of the three afterwards. */
export const BOX_KITS = ["blank", "rpg", "dialogue"] as const;

export type BoxKit = typeof BOX_KITS[number];

export interface NewBoxOptions {
  loaded: LoadedProject;
  kit?: BoxKit;
}

export interface NewBoxResult {
  writes: PlannedWrite[];
  boxId: string;
  /** The new box's folder name (its derived gameId). */
  folder: string;
}

/** The RPG kit's contents, freshly-idd per creation. */
/** A rectangle as the four points a zone polygon wants, clockwise from the top
 *  left. The map's y runs down the screen, as the canvas does. */
const rect = (x: number, y: number, w: number, h: number): { x: number; y: number }[] =>
  [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

function rpgKit(boxShard: BoxShard, tags: TagsShard, hands: HandsShard): DeckShard {
  boxShard.box.purpose = "Encounter beats: what could happen here now?";
  // A BOX property, not a project one: a kit writes only its own folder, so
  // reaching for @story would leave the author with a change pointing at a
  // property this kit cannot declare. @box is the scope a kit can teach.
  boxShard.box.properties = [{
    name: "tension", type: "number", default: 0,
    purpose: "How wound up this place is. Encounters raise it; conditions can read it to make the next draw meaner.",
  }];
  const tavern = newId("v");
  // A SPATIAL group, with the two areas drawn as zones. A place-based kit whose
  // places are an abstract list teaches half the idea: the Map tab is where an
  // author sees where a card can be dealt, and a kit that leaves the map empty
  // is a kit whose first lesson is "this feature does nothing".
  //
  // Two touching rectangles, in the same coordinate space the map editor uses.
  // Deliberately plain: the author is meant to redraw them, and a hand-drawn
  // coastline here would read as content rather than as scaffold.
  const zone: TagGroup = {
    id: newId("d"), gameId: "area",
    purpose: "Where the player is, drawn on the box's map. Cards tagged with an area deal there.",
    tags: [
      { id: tavern, gameId: "tavern", templates: { [SPATIAL]: { polygon: rect(0, 0, 320, 240) } } },
      { id: newId("v"), gameId: "market", templates: { [SPATIAL]: { polygon: rect(320, 0, 320, 240) } } },
    ],
    templates: { [SPATIAL]: { map: true } },
  };
  tags.groups.push(zone);
  const template: HandTemplate<string> = {
    id: newId("t"), gameId: "encounters-at",
    purpose: "What could happen in a place. One place per area, each choosing its own. "
      + "Only the tavern is seated so far: the market has no hand yet, so add one choosing market to put the second place on the board.",
    chooses: [zone.id], slots: 3, properties: [],
  };
  hands.templates.push(template);
  hands.hands.push({
    id: newId("h"), title: "Tavern encounters",
    purpose: "The tavern's seat on the board: deal it when the player walks in.",
    template: template.id, chosen: { [zone.id]: tavern },
  });
  const card: Card<string> = {
    id: newId("c"), title: "A stranger's wager", priority: 0, redraw: "always",
    purpose: "A hooded figure rattles a dice cup. Sample card: duplicate it, retag it, make it yours. "
      + "Two outcomes, and only one of them changes anything - which is the whole of what playing a card IS.",
    tags: { [zone.id]: [tavern] },
    outcomes: [
      {
        id: newId("o"), gameId: "take-the-bet", title: "Take the bet",
        purpose: "Playing a card is the act that writes state. The Board's journal shows this as a wrote beat.",
        changes: { "@box.tension": "@box.tension + 1" },
      },
      { id: newId("o"), gameId: "walk-away", title: "Walk away", purpose: "An outcome may change nothing at all.", changes: {} },
    ],
  };
  return {
    schema: DECK_SCHEMA,
    deck: { id: newId("k"), title: "Encounters", purpose: "The example deck. One deck per authoring concern.", properties: [] },
    cards: [card],
  };
}

const sampleCard = (title: string, purpose: string, tags?: Record<string, string[]>, extra: Partial<Card<string>> = {}): Card<string> => ({
  id: newId("c"), title, purpose, priority: 0, redraw: "always",
  ...(tags !== undefined ? { tags } : {}),
  outcomes: [{ id: newId("o"), title: "Continue", changes: {} }],
  ...extra,
});

/** The dialogue-topics kit: per-NPC hands - the chapter where exclusivity
 *  and copies get taught (A10: the fan in the NPC's pocket). */
function dialogueKit(boxShard: BoxShard, tags: TagsShard, hands: HandsShard): DeckShard {
  boxShard.box.purpose = "Dialogue: what can this NPC talk about right now?";
  const gareth = newId("v"), mira = newId("v");
  const npc: TagGroup = {
    id: newId("d"), gameId: "npc", purpose: "Who the player is talking to. A topic tagged with an NPC belongs to their conversations.",
    tags: [{ id: gareth, gameId: "gareth" }, { id: mira, gameId: "mira" }],
  };
  tags.groups.push(npc);
  const template: HandTemplate<string> = {
    id: newId("t"), gameId: "topics-for",
    purpose: "The fan of topics in an NPC's pocket. One hand per NPC keeps continuity: return to Gareth and his remaining topics are still his.",
    chooses: [npc.id], slots: 3, properties: [],
  };
  hands.templates.push(template);
  hands.hands.push(
    { id: newId("h"), title: "Talking to Gareth", purpose: "Deal this when the conversation opens; play a card to say it.", template: template.id, chosen: { [npc.id]: gareth } },
    { id: newId("h"), title: "Talking to Mira", purpose: "Mira's own fan of topics.", template: template.id, chosen: { [npc.id]: mira } },
  );
  return {
    schema: DECK_SCHEMA,
    deck: { id: newId("k"), title: "Topics", purpose: "Everything sayable. Tags decide whose conversations a topic joins.", properties: [] },
    cards: [
      sampleCard("The weather", "Untagged = anyone's smalltalk: a wildcard topic every NPC can offer."),
      sampleCard("A rumour about the well",
        "Both of them know it, but there is ONE copy: whoever offers it first claims it, and the other never repeats it. Exclusivity is physical.",
        { [npc.id]: [gareth, mira] }),
      sampleCard("Gareth's aching shoulder", "A personal topic: only Gareth's hand can pull it.", { [npc.id]: [gareth] }),
      sampleCard("A complaint about the roads",
        "The deliberate opt-out: TWO copies, so both of them can be holding it at once. Compare \u201cA rumour about the well\u201d, which has one copy and so belongs to whoever claims it first. Use copies for interchangeable filler, where hearing it twice costs nothing.",
        { [npc.id]: [gareth, mira] }, { copies: 2 }),
    ],
  };
}

const KITS: Record<Exclude<BoxKit, "blank">, (b: BoxShard, t: TagsShard, h: HandsShard) => DeckShard> = {
  rpg: rpgKit, dialogue: dialogueKit,
};

/** Scaffold a new box into a loaded project, as planned writes. Throws when
 *  the project did not load (no source to dedupe against). */
export function runNewBox(opts: NewBoxOptions): NewBoxResult {
  const source = opts.loaded.source;
  if (!source) throw new Error("not a loadable storylets project (fix its errors first)");
  const kit = opts.kit ?? "blank";

  const taken = new Set(source.boxes.map((b) => effectiveGameId(b.box.box)));
  const title = freeTitle("New box", taken);
  const folder = gameIdify(title);
  const boxId = newId("b");
  const boxShard: BoxShard = {
    schema: BOX_SCHEMA,
    box: { id: boxId, title, ranking: { specificity: true }, fields: [], properties: [] },
  };
  const tags: TagsShard = { schema: TAGS_SCHEMA, groups: [] };
  const hands: HandsShard = { schema: HANDS_SCHEMA, templates: [], hands: [] };
  const deck = kit === "blank" ? undefined : KITS[kit](boxShard, tags, hands);

  // Kit names are API (deal() and the play log speak them): applying the same
  // kit twice must not collide, so hand and card gameIds dedupe project-wide.
  // `freeGameId` is the shell's rule (model), the same one the editor mints
  // with, so a name born here and one born in the editor cannot disagree.
  const handNames = new Set(source.boxes.flatMap((b) => b.hands.hands.map((h) => effectiveGameId(h))));
  for (const hand of hands.hands) {
    const name = freeGameId(effectiveGameId(hand), handNames);
    if (name !== effectiveGameId(hand)) hand.gameId = name;
    handNames.add(name);
  }
  const cardNames = new Set(source.boxes.flatMap((b) => b.decks.flatMap((d) => d.shard.cards.map((c) => effectiveGameId(c)))));
  for (const card of deck?.cards ?? []) {
    const name = freeGameId(effectiveGameId(card), cardNames);
    if (name !== effectiveGameId(card)) card.gameId = name;
    cardNames.add(name);
  }

  const writes = boxFolderWrites(opts.loaded.dir, {
    box: boxShard, tags, hands, decks: deck ? [deck] : [],
  });
  return { writes, boxId, folder };
}
