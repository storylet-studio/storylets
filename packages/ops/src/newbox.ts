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
  BOX_SCHEMA, DECK_SCHEMA, HANDS_SCHEMA, SPATIAL, TAGS_SCHEMA, effectiveGameId, freeGameId, freeTitle, gameIdify, isSpatial,
} from "@storylet-studio/model";
import type { BoxShard, Card, DeckShard, HandsShard, HandTemplate, TagGroup, TagsShard } from "@storylet-studio/model";
import type { SourceProject } from "@storylet-studio/compiler";
import { newId } from "./ids.js";
import type { LoadedProject } from "./load.js";
import type { PlannedWrite } from "./write.js";
import { boxFolderWrites } from "./box-folder.js";
import { planProjectMapGroup } from "./map.js";

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
export const BOX_KITS = ["blank", "rpg", "dialogue", "jobs", "stash", "codex", "news", "acts"] as const;

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
  // places are an abstract list teaches half the idea: the map is where an
  // author sees where a card can be dealt, and a kit that leaves the map empty
  // is a kit whose first lesson is "this feature does nothing". It becomes the
  // PROJECT map when the project has none (`onProjectMap` below says how).
  //
  // Two touching rectangles, in the same coordinate space the map editor uses.
  // Deliberately plain: the author is meant to redraw them, and a hand-drawn
  // coastline here would read as content rather than as scaffold.
  const zone: TagGroup = {
    id: newId("d"), gameId: "area",
    purpose: "Where the player is, drawn on the project map. Cards tagged with an area deal there.",
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

// ---------------------------------------------------------------------------
// The four kits cut from Port Meridian as it stands (the kit gallery brief,
// storylet-studio/design/kit-gallery.md, step 6; the author's go-ahead
// 2026-09-27). Each is one of that demo's boxes made self-contained: a kit
// writes only its own folder, so the state Port Meridian keeps in @story lives
// in @box here, and every flag a condition reads is written by something in
// the same box, or the problems bar would open with a dead-state warning.
// Codex and News are boxes the game only READS; their unlocks come from the
// rest of a real game, so each carries a small deck standing in for it.
// ---------------------------------------------------------------------------

/** A spatial district group with two zones drawn side by side, as the rpg kit
 *  draws its areas: plain rectangles, meant to be redrawn. */
function districts(purpose: string, a: string, b: string): { group: TagGroup; first: string; second: string } {
  const first = newId("v"), second = newId("v");
  return {
    first, second,
    group: {
      id: newId("d"), gameId: "district", purpose,
      tags: [
        { id: first, gameId: a, templates: { [SPATIAL]: { polygon: rect(0, 0, 320, 240) } } },
        { id: second, gameId: b, templates: { [SPATIAL]: { polygon: rect(320, 0, 320, 240) } } },
      ],
      templates: { [SPATIAL]: { map: true } },
    },
  };
}

/** Job board: work on offer at boards around town. A job is taken, then its
 *  follow-up turns up, then it is done; how it went leaves heat behind. */
function jobsKit(boxShard: BoxShard, tags: TagsShard, hands: HandsShard): DeckShard {
  boxShard.box.purpose = "Jobs offered at boards around town: the player chooses one to take, and a taken job has a next step.";
  boxShard.box.properties = [
    {
      name: "jobs", type: "flags", values: ["delivery_taken", "delivery_done"], default: [],
      purpose: "Where each job stands. Taking one sets its first flag; finishing it sets the second, which retires its follow-up.",
    },
    {
      name: "heat", type: "number", default: 0,
      purpose: "How much attention the player has drawn. A job that goes loud raises it; lying low brings it down.",
    },
  ];
  const d = districts("Where the boards are, drawn on the project map. A job tagged with a district is posted there.", "docks", "old-town");
  tags.groups.push(d.group);
  const template: HandTemplate<string> = {
    id: newId("t"), gameId: "job-board",
    purpose: "A board jobs are posted on: what work is on offer here, now. One per district.",
    chooses: [d.group.id], slots: 2, properties: [],
  };
  hands.templates.push(template);
  hands.hands.push(
    { id: newId("h"), title: "Dockside board", purpose: "The board at the docks: deal it when the player reads it.", template: template.id, chosen: { [d.group.id]: d.first } },
    { id: newId("h"), title: "Old town board", purpose: "Where follow-ups and quieter work turn up.", template: template.id, chosen: { [d.group.id]: d.second } },
  );
  return {
    schema: DECK_SCHEMA,
    deck: { id: newId("k"), title: "Jobs", purpose: "Every job, and every next step of one. Conditions decide which step is on offer.", properties: [] },
    cards: [
      {
        id: newId("c"), title: "Cold delivery", priority: 1, redraw: "never",
        purpose: "The offer. Taking it is the whole act: the job moves on to its handoff, which appears on the old town board.",
        tags: { [d.group.id]: [d.first] },
        condition: "!check_flags(@box.jobs, +delivery_taken)",
        outcomes: [{ id: newId("o"), gameId: "take-the-job", title: "Take the job", changes: { "@box.jobs": "set_flags(@box.jobs, +delivery_taken)" } }],
      },
      {
        id: newId("c"), title: "Cold delivery: the handoff", priority: 2, redraw: "never",
        purpose: "The follow-up: only on offer between taking the job and finishing it. Two ways it can end, and one of them costs heat.",
        tags: { [d.group.id]: [d.second] },
        condition: "check_flags(@box.jobs, +delivery_taken) && !check_flags(@box.jobs, +delivery_done)",
        outcomes: [
          { id: newId("o"), gameId: "delivered-clean", title: "Delivered clean", changes: { "@box.jobs": "set_flags(@box.jobs, +delivery_done)" } },
          { id: newId("o"), gameId: "it-went-loud", title: "It went loud", changes: { "@box.jobs": "set_flags(@box.jobs, +delivery_done)", "@box.heat": "@box.heat + 1" } },
        ],
      },
      {
        id: newId("c"), title: "Lie low for a night", priority: 0, redraw: "always",
        purpose: "Only offered once there is heat to shed. Comes back whenever it is needed.",
        tags: { [d.group.id]: [d.first, d.second] },
        condition: "@box.heat > 0",
        outcomes: [{ id: newId("o"), gameId: "lie-low", title: "Stay off the streets", changes: { "@box.heat": "@box.heat - 1" } }],
      },
    ],
  };
}

/** Stash: what exploring turns up. The value field is data for the game's own
 *  economy; one find only turns up once another has pointed the way. */
function stashKit(boxShard: BoxShard, tags: TagsShard, hands: HandsShard): DeckShard {
  boxShard.box.purpose = "What exploring turns up, one find per hiding place. The game decides what a find is worth; the value field tells it.";
  boxShard.box.fields = [{
    name: "value", type: "number", default: 0,
    purpose: "What the find is worth to the game's economy. The engine never reads it: fields are data for the game.",
  }];
  boxShard.box.properties = [{
    name: "found", type: "flags", values: ["burner"], default: [],
    purpose: "Finds that lead somewhere. The burner phone's contacts are what make the decryptor turn up in the back room.",
  }];
  const backRoom = newId("v"), container = newId("v");
  const place: TagGroup = {
    id: newId("d"), gameId: "hiding-place",
    purpose: "Places the level marks as worth searching. A find tagged with one is what is tucked away there.",
    tags: [{ id: backRoom, gameId: "back-room" }, { id: container, gameId: "container-7" }],
  };
  tags.groups.push(place);
  const template: HandTemplate<string> = {
    id: newId("t"), gameId: "stash",
    purpose: "A hiding place: deal it when the player searches. One slot, so the best find there wins.",
    chooses: [place.id], slots: 1, properties: [],
  };
  hands.templates.push(template);
  hands.hands.push(
    { id: newId("h"), title: "The back room", purpose: "A room behind a bar. Search it again once the burner phone is found: something else turns up.", template: template.id, chosen: { [place.id]: backRoom } },
    { id: newId("h"), title: "Container 7", purpose: "A shipping container at the docks.", template: template.id, chosen: { [place.id]: container } },
  );
  return {
    schema: DECK_SCHEMA,
    deck: { id: newId("k"), title: "Finds", purpose: "Everything there is to find, and where.", properties: [] },
    cards: [
      {
        id: newId("c"), title: "A clean burner phone", priority: 1, redraw: "never", fields: { value: 0 },
        purpose: "Worth nothing to sell, and the contacts in it lead to something that is.",
        tags: { [place.id]: [backRoom] },
        outcomes: [{ id: newId("o"), gameId: "pocket-it", title: "Pocket it", changes: { "@box.found": "set_flags(@box.found, +burner)" } }],
      },
      {
        id: newId("c"), title: "A dockside cache", priority: 1, redraw: "never", fields: { value: 40 },
        purpose: "Somebody's rainy-day tin, taped under the container floor.",
        tags: { [place.id]: [container] },
        outcomes: [{ id: newId("o"), gameId: "crack-it-open", title: "Crack it open", changes: {} }],
      },
      {
        id: newId("c"), title: "A military decryptor", priority: 2, redraw: "never", fields: { value: 120 },
        purpose: "Only here once the burner phone has been found and taken: the back room's one slot is free again, and this is what fills it.",
        tags: { [place.id]: [backRoom] },
        condition: "check_flags(@box.found, +burner)",
        outcomes: [{ id: newId("o"), gameId: "take-it", title: "Take it", changes: {} }],
      },
    ],
  };
}

/** Codex: entries the game only reads. They unlock and accumulate, and are
 *  never played; priority is the listing order. */
function codexKit(boxShard: BoxShard, tags: TagsShard, hands: HandsShard): DeckShard[] {
  boxShard.box.purpose = "The box the game only reads: entries unlock, accumulate and are never played. Priority is the listing order.";
  boxShard.box.ranking = { specificity: false };
  boxShard.box.fields = [{
    name: "body", type: "string", default: "",
    purpose: "The entry's text, for the game to show on its codex page.",
  }];
  boxShard.box.properties = [{
    name: "learned", type: "flags", values: ["harbour", "collective"], default: [],
    purpose: "What the player has found out. In a real game the rest of the game writes this; here the Leads deck stands in for it. Once your other boxes write it, move it to @story.",
  }];
  // A hand that chooses nothing deals from the whole box, so the page would list
  // the leads too. One small group keeps the two kinds apart.
  const entryTag = newId("v"), leadTag = newId("v");
  const kind: TagGroup = {
    id: newId("d"), gameId: "kind",
    purpose: "Entries go on the codex page; leads are the stand-in for the rest of the game.",
    tags: [{ id: entryTag, gameId: "entry" }, { id: leadTag, gameId: "lead" }],
  };
  tags.groups.push(kind);
  const archive: HandTemplate<string> = {
    id: newId("t"), gameId: "archive",
    purpose: "The codex page: every unlocked entry, in priority order. Slots is the page size; grow it with the content.",
    chooses: [], bindings: { [kind.id]: entryTag }, slots: 12, properties: [],
  };
  const leadsTemplate: HandTemplate<string> = {
    id: newId("t"), gameId: "leads",
    purpose: "Stand-in for the rest of the game: things the player can follow up, each of which teaches them something.",
    chooses: [], bindings: { [kind.id]: leadTag }, slots: 2, properties: [],
  };
  hands.templates.push(archive, leadsTemplate);
  hands.hands.push(
    { id: newId("h"), title: "Codex", purpose: "The page itself. Never played from: the game reads it and lists what it holds.", template: archive.id, chosen: {} },
    { id: newId("h"), title: "Leads", purpose: "Play one to learn something, and watch the codex grow.", template: leadsTemplate.id, chosen: {} },
  );
  const asEntry = { [kind.id]: [entryTag] }, asLead = { [kind.id]: [leadTag] };
  const entries: DeckShard = {
    schema: DECK_SCHEMA,
    deck: { id: newId("k"), title: "Entries", purpose: "The codex's contents. Never played: an entry is on the page while its condition holds.", properties: [] },
    cards: [
      {
        id: newId("c"), title: "Port Meridian", priority: 10, redraw: "never", outcomes: [], tags: asEntry,
        fields: { body: "A freeport built on stilts and waivers. Three districts, one harbour, no questions at the waterline." },
        purpose: "Known from the start: no condition, highest priority, so it heads the page.",
      },
      {
        id: newId("c"), title: "The harbour", priority: 8, redraw: "never", outcomes: [], tags: asEntry, condition: "check_flags(@box.learned, +harbour)",
        fields: { body: "Deep water, shallow paperwork. Anything can come ashore here if it arrives after midnight." },
        purpose: "Unlocked by studying the harbour charts.",
      },
      {
        id: newId("c"), title: "The Grid Collective", priority: 6, redraw: "never", outcomes: [], tags: asEntry, condition: "check_flags(@box.learned, +collective)",
        fields: { body: "Nobody joins the Collective; you just notice you've been helping them for a while." },
        purpose: "Unlocked by listening in on the Collective.",
      },
    ],
  };
  const leads: DeckShard = {
    schema: DECK_SCHEMA,
    deck: { id: newId("k"), title: "Leads", purpose: "Stand-in for the rest of your game, which is where unlocks really come from.", properties: [] },
    cards: [
      {
        id: newId("c"), title: "Study the harbour charts", priority: 0, redraw: "never", fields: { body: "" }, tags: asLead,
        purpose: "Playing it unlocks the harbour entry.",
        outcomes: [{ id: newId("o"), gameId: "study-them", title: "Study them", changes: { "@box.learned": "set_flags(@box.learned, +harbour)" } }],
      },
      {
        id: newId("c"), title: "Listen in on the Collective", priority: 0, redraw: "never", fields: { body: "" }, tags: asLead,
        purpose: "Playing it unlocks the Collective's entry.",
        outcomes: [{ id: newId("o"), gameId: "listen", title: "Listen", changes: { "@box.learned": "set_flags(@box.learned, +collective)" } }],
      },
    ],
  };
  return [entries, leads];
}

/** News: the city talking about what happened. Headlines are never played; a
 *  screen shows its top story over background chatter, and stories whose
 *  condition stops holding drop off at the next deal. */
function newsKit(boxShard: BoxShard, tags: TagsShard, hands: HandsShard): DeckShard[] {
  boxShard.box.purpose = "The city talking about what happened. Never played: a screen shows its top story over the background chatter.";
  boxShard.box.ranking = { specificity: false };
  boxShard.box.properties = [{
    name: "wire", type: "flags", values: ["blackout", "raid"], default: [],
    purpose: "What is in the news. In a real game the rest of the game writes this; here the Happenings deck stands in for it. Once your other boxes write it, move it to @story.",
  }];
  const d = districts("Where the screens are, drawn on the project map. A headline tagged with a district runs there.", "docks", "old-town");
  tags.groups.push(d.group);
  // A card with no district runs everywhere, so the happenings would reach the
  // screens. One small group keeps the news apart from what it reports.
  const headlineTag = newId("v"), happeningTag = newId("v");
  const feed: TagGroup = {
    id: newId("d"), gameId: "feed",
    purpose: "Headlines run on the screens; happenings are the stand-in for the rest of the game.",
    tags: [{ id: headlineTag, gameId: "headline" }, { id: happeningTag, gameId: "happening" }],
  };
  tags.groups.push(feed);
  const screen: HandTemplate<string> = {
    id: newId("t"), gameId: "screen",
    purpose: "A public screen: its top-priority story, with the background chatter underneath.",
    chooses: [d.group.id], bindings: { [feed.id]: headlineTag }, slots: 2, properties: [],
  };
  const happenings: HandTemplate<string> = {
    id: newId("t"), gameId: "happenings",
    purpose: "Stand-in for the rest of the game: things that happen, which the news then reports.",
    chooses: [], bindings: { [feed.id]: happeningTag }, slots: 2, properties: [],
  };
  hands.templates.push(screen, happenings);
  hands.hands.push(
    { id: newId("h"), title: "Dock screen", purpose: "The screen at the docks. Deal it again to refresh the news.", template: screen.id, chosen: { [d.group.id]: d.first } },
    { id: newId("h"), title: "Old town screen", purpose: "The screen in the old town.", template: screen.id, chosen: { [d.group.id]: d.second } },
    { id: newId("h"), title: "What happens", purpose: "Play one, then deal the screens again.", template: happenings.id, chosen: {} },
  );
  const both = { [d.group.id]: [d.first, d.second], [feed.id]: [headlineTag] };
  const headlines: DeckShard = {
    schema: DECK_SCHEMA,
    deck: { id: newId("k"), title: "Headlines", purpose: "Every story the screens can run. Never played.", properties: [] },
    cards: [
      {
        id: newId("c"), title: "Acid drizzle advisory", priority: 0, redraw: "never", copies: 2, outcomes: [], tags: both,
        purpose: "Background chatter: no condition, lowest priority, two copies so both screens can run it at once.",
      },
      {
        id: newId("c"), title: "Rolling blackouts hit the old town", priority: 3, redraw: "never", outcomes: [],
        tags: { [d.group.id]: [d.second], [feed.id]: [headlineTag] }, condition: "check_flags(@box.wire, +blackout)",
        purpose: "Runs once the blackout has happened, and outranks the chatter.",
      },
      {
        id: newId("c"), title: "Port Authority raids the docks", priority: 3, redraw: "never", outcomes: [],
        tags: { [d.group.id]: [d.first], [feed.id]: [headlineTag] }, condition: "check_flags(@box.wire, +raid)",
        purpose: "Runs once the raid has happened.",
      },
    ],
  };
  const events: DeckShard = {
    schema: DECK_SCHEMA,
    deck: { id: newId("k"), title: "Happenings", purpose: "Stand-in for the rest of your game, which is where the news really comes from.", properties: [] },
    cards: [
      {
        id: newId("c"), title: "The lights go out", priority: 0, redraw: "never", tags: { [feed.id]: [happeningTag] },
        purpose: "Playing it puts the blackout on the wire.",
        outcomes: [{ id: newId("o"), gameId: "black-out", title: "Kill the grid", changes: { "@box.wire": "set_flags(@box.wire, +blackout)" } }],
      },
      {
        id: newId("c"), title: "Patrol boats at the docks", priority: 0, redraw: "never", tags: { [feed.id]: [happeningTag] },
        purpose: "Playing it puts the raid on the wire.",
        outcomes: [{ id: newId("o"), gameId: "raid", title: "Watch the raid", changes: { "@box.wire": "set_flags(@box.wire, +raid)" } }],
      },
    ],
  };
  return [headlines, events];
}

/** Story acts: a story told in three acts. Each act's beats wait for it, one
 *  beat in each moves the story on, and the finale waits for the last. The act
 *  is a QUALITY, an ordered ladder, so a beat asks for "rising or later"
 *  rather than naming every act it may happen in. */
function actsKit(boxShard: BoxShard, tags: TagsShard, hands: HandsShard): DeckShard {
  void tags;
  boxShard.box.purpose = "A story told in acts: beats wait for their act, and one beat in each act moves the story on.";
  boxShard.box.properties = [{
    name: "act", type: "quality", stages: ["opening", "rising", "finale"], default: "opening",
    purpose: "How far the story has come. An ordered ladder: a beat asks for an act or later, and one beat in each act advances it.",
  }];
  hands.hands.push({
    id: newId("h"), title: "What happens next",
    purpose: "The story so far: deal it to see which beats the current act allows.",
    rule: { bindings: {}, slots: 3 },
  });
  const beat = (order: number, title: string, purpose: string, condition: string, outcomes: Card<string>["outcomes"], redraw: Card<string>["redraw"] = "never"): Card<string> =>
    ({ id: newId("c"), order, title, purpose, condition, priority: 1, redraw, outcomes });
  const moveOn = (gameId: string, title: string) => [{ id: newId("o"), gameId, title, changes: { "@box.act": "advance(@box.act)" } }];
  return {
    schema: DECK_SCHEMA,
    deck: { id: newId("k"), title: "Beats", purpose: "The story's beats, each waiting for its act.", properties: [] },
    cards: [
      beat(0, "A letter arrives", "The opening's turning point: reading it moves the story into its rising act.",
        '@box.act == "opening"', moveOn("read-it", "Read it")),
      beat(1, "Quiet days", "Filler for the opening: offered until the letter is read, and again whenever it comes round.",
        '@box.act == "opening"', [{ id: newId("o"), gameId: "wait", title: "Let the days pass", changes: {} }], "always"),
      beat(2, "A stranger's warning", "Only once the story is rising. Heeding it moves the story to its finale.",
        '@box.act == "rising"', moveOn("heed-it", "Heed the warning")),
      beat(3, "The road north", "Rising or later: a beat that stays available into the finale, since it asks for an act or later.",
        '@box.act >= "rising"', [{ id: newId("o"), gameId: "take-the-road", title: "Take the road", changes: {} }]),
      beat(4, "The reckoning", "The finale, waiting for the last act.",
        '@box.act >= "finale"', [{ id: newId("o"), gameId: "face-it", title: "Face it", changes: {} }]),
    ],
  };
}

const KITS: Record<Exclude<BoxKit, "blank">, (b: BoxShard, t: TagsShard, h: HandsShard) => DeckShard | DeckShard[]> = {
  rpg: rpgKit, dialogue: dialogueKit, jobs: jobsKit, stash: stashKit, codex: codexKit, news: newsKit, acts: actsKit,
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
  const made = kit === "blank" ? [] : KITS[kit](boxShard, tags, hands);
  const decks = Array.isArray(made) ? made : [made];

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
  for (const card of decks.flatMap((k) => k.cards)) {
    const name = freeGameId(effectiveGameId(card), cardNames);
    if (name !== effectiveGameId(card)) card.gameId = name;
    cardNames.add(name);
  }

  const map = onProjectMap(source, boxShard, tags, hands, decks);
  const writes = [
    ...boxFolderWrites(opts.loaded.dir, { box: boxShard, tags, hands, decks }),
    ...(map !== undefined ? [planProjectMapGroup(opts.loaded.dir, source, map)] : []),
  ];
  return { writes, boxId, folder };
}

/**
 * A place-based kit on the PROJECT map (design/project-map-contract.md 8, D10).
 *
 * A kit draws its zones as a box group, the shape every kit is written in, and
 * this lifts that group out of the box, because a map belongs to the project
 * now. The box opts in either way. When the project has no map yet the kit's
 * zones BECOME the project map, named clear of every group and tag the project
 * already has (a zone's name is reserved project-wide); this is the one place a
 * kit writes outside its own folder, and deliberately. When the project already
 * has a map, the kit adds nothing to it and leaves the tagging to the author:
 * the kit's references to its own zones are taken off its cards and hands, so
 * the box deals from everything until somebody tags it.
 *
 * Returns the zone group to write as the project map, or undefined.
 */
function onProjectMap(
  source: SourceProject, boxShard: BoxShard, tags: TagsShard, hands: HandsShard, decks: DeckShard[],
): TagGroup | undefined {
  const zones = tags.groups.find(isSpatial);
  if (zones === undefined) return undefined;
  tags.groups = tags.groups.filter((g) => g !== zones);
  boxShard.box.usesMap = true;
  if (source.map === undefined) {
    const groupNames = new Set(source.boxes.flatMap((b) => b.tags.groups.map((g) => effectiveGameId(g))));
    const tagNames = new Set(source.boxes.flatMap((b) => b.tags.groups.flatMap((g) => g.tags.map((t) => effectiveGameId(t)))));
    const name = freeGameId(effectiveGameId(zones), groupNames);
    if (name !== effectiveGameId(zones)) zones.gameId = name;
    for (const tag of zones.tags) {
      const zone = freeGameId(effectiveGameId(tag), tagNames);
      if (zone !== effectiveGameId(tag)) tag.gameId = zone;
      tagNames.add(zone);
    }
    return zones;
  }
  const id = zones.id;
  for (const card of decks.flatMap((k) => k.cards)) {
    if (card.tags?.[id] === undefined) continue;
    delete card.tags[id];
    if (Object.keys(card.tags).length === 0) delete card.tags;
  }
  for (const template of hands.templates) {
    if (template.chooses !== undefined) template.chooses = template.chooses.filter((g) => g !== id);
    if (template.bindings?.[id] !== undefined) delete template.bindings[id];
  }
  for (const hand of hands.hands) {
    if (hand.chosen?.[id] !== undefined) delete hand.chosen[id];
    if (hand.rule?.bindings?.[id] !== undefined) delete hand.rule.bindings[id];
  }
  return undefined;
}
