// ---------------------------------------------------------------------------
// The init op: scaffold a new `.storylets` project - the project shard, a
// starter box with a playable two-card loop, and the hygiene files the
// extension ruling promised (source doc section 2): editor associations
// registering the shard extensions as JSON5, `.editorconfig`, and git
// config (`.gitattributes` + `.gitignore`). Pure planned writes: nothing is
// written here; the caller commits them through the VC layer.
// ---------------------------------------------------------------------------

import { basename, join, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { BUNDLE_EXTENSION, MAP_SCHEMA, PLACE_GROUP, PROJECTMAP_SCHEMA, PROJECT_FOLDER_EXTENSION, SHARD_EXTENSIONS, SPATIAL } from "@storylet-studio/model";
import type { BoxShard, DeckShard, HandsShard, MapShard, ProjectMapShard, ProjectShard, PropertyDecl, TagGroup, TagsShard } from "@storylet-studio/model";
import { canonicalStringify } from "@storylet-studio/compiler";
import { newId, slug } from "./ids.js";
import type { PlannedWrite } from "./write.js";

/** The game kits `init` can start a project from, in picker order. The ONE list,
 *  as BOX_KITS is for boxes: the CLI validates `--kit` from it. Storyletter's
 *  New Project adds its own "with Patter" pairing on top of the starter. */
export const GAME_KITS = ["starter", "map-story", "action-game"] as const;
export type GameKit = typeof GAME_KITS[number];

export interface InitOptions {
  /** Directory to scaffold into; `.storylets` is appended when absent. */
  dir: string;
  /** Project name; defaults to the directory's basename. */
  name?: string;
  /** The game kit to start from; the starter when absent. */
  kit?: GameKit;
}

export interface InitResult {
  writes: PlannedWrite[];
  /** The project folder that will be created. */
  dir: string;
  /** Path of the project shard the scaffold creates. */
  projectFile: string;
  name: string;
}

/** Scaffold a new project as planned writes. Throws if `dir` already holds
 *  a project or the scaffold would overwrite anything. */
/** The folder name a project of this name lands in. One rule, beside the code
 *  that enforces it: the editor's New Project dialog TELLS the author what it
 *  is about to create, and a second derivation of it would be a promise that
 *  can drift from the act (the box-folder lesson, `box-folder.ts`). */
export const projectFolderName = (name: string): string =>
  (name.endsWith(PROJECT_FOLDER_EXTENSION) ? name : `${name}${PROJECT_FOLDER_EXTENSION}`);

export function runInit(opts: InitOptions): InitResult {
  const given = resolve(opts.dir);
  const dir = projectFolderName(given);
  const name = opts.name?.trim() || basename(dir, PROJECT_FOLDER_EXTENSION);
  const stem = slug(name);
  const kit = opts.kit ?? "starter";

  let existing: string[] = [];
  try {
    existing = readdirSync(dir).filter((f) => f.endsWith(SHARD_EXTENSIONS.project));
  } catch {
    // dir does not exist yet - fine, the write layer creates it.
  }
  if (existing.length > 0) throw new Error(`a project already exists here: ${existing[0]}`);

  const project: ProjectShard = {
    schema: "storylets/project@0",
    project: { id: newId("proj"), name, version: "0.1.0" },
    // The play ladder's rung (design/engine-server.md 4.10). The kit sets it,
    // and the starter kit is a single-player game, so it lands on "solo": the
    // editor then shows nothing about sharing, durability or a venue until an
    // author says the project is one of those. Written rather than left absent
    // (which would mean the same) because it is a three-way choice and a shard
    // that names its rung is one an author can read.
    settings: { play: "solo", playAdvancesTurns: 1 },
    world: { properties: [], registry: {} },
    story: {
      properties: kit === "map-story" ? MAP_STORY_PROPERTIES
        : kit === "action-game" ? ACTION_GAME_PROPERTIES
        : [{ name: "started", type: "boolean", default: false }],
    },
    templates: {},
    // Published BESIDE the project, never inside it: a `.storylets` folder is
    // the document (on macOS a package), and a build output has no place in
    // it. Patterpad's own default, `../patter-dist/<name>.patterc`, name for name.
    export: { bundle: `../storylet-dist/${stem}${BUNDLE_EXTENSION}`, metadata: "full" },
  };
  const parts: KitParts = kit === "map-story" ? mapStoryParts() : kit === "action-game" ? actionGameParts() : { boxes: [starterParts()] };
  const projectFile = join(dir, `${stem}${SHARD_EXTENSIONS.project}`);
  const writes: PlannedWrite[] = [
    { path: projectFile, content: canonicalStringify(project) },
    // The project map, for a kit that draws one: at the root, above the boxes
    // (design/project-map-contract.md 1.1), which opt in on their own shards.
    ...(parts.map !== undefined ? [{ path: join(dir, `map${SHARD_EXTENSIONS.map}`), content: canonicalStringify(parts.map) }] : []),
    ...parts.boxes.flatMap((box) => [
      { path: join(dir, box.folder, `box${SHARD_EXTENSIONS.box}`), content: canonicalStringify(box.box) },
      { path: join(dir, box.folder, `tags${SHARD_EXTENSIONS.tags}`), content: canonicalStringify(box.tags) },
      { path: join(dir, box.folder, `hands${SHARD_EXTENSIONS.hands}`), content: canonicalStringify(box.hands) },
      { path: join(dir, box.folder, "decks", `${box.deckFile}${SHARD_EXTENSIONS.deck}`), content: canonicalStringify(box.deck) },
      ...(box.sites !== undefined ? [{ path: join(dir, box.folder, `map${SHARD_EXTENSIONS.map}`), content: canonicalStringify(box.sites) }] : []),
    ]),
    { path: join(dir, ".editorconfig"), content: EDITORCONFIG },
    { path: join(dir, ".gitattributes"), content: GITATTRIBUTES },
    { path: join(dir, ".gitignore"), content: GITIGNORE },
    { path: join(dir, ".vscode", "settings.json"), content: VSCODE_SETTINGS },
    { path: join(dir, "vcs-setup.md"), content: VCS_SETUP },
  ];

  const collisions = writes.map((w) => w.path).filter((p) => existsSync(p));
  if (collisions.length > 0) {
    throw new Error(`refusing to overwrite existing file(s): ${collisions.join(", ")}`);
  }
  return { writes, dir, projectFile, name };
}

interface BoxParts {
  folder: string; deckFile: string; box: BoxShard; tags: TagsShard; hands: HandsShard; deck: DeckShard;
  /** Where the box's hands stand on the project map, when the kit places them. */
  sites?: MapShard;
}

/** A kit's whole project: its boxes and, for a kit that draws one, the map. */
interface KitParts { boxes: BoxParts[]; map?: ProjectMapShard }

/** A project map shard holding one zone group. */
const projectMapOf = (group: TagGroup): ProjectMapShard => ({ schema: PROJECTMAP_SCHEMA, group });

/** The starter: one box, one hand, and two cards that already work together. */
function starterParts(): BoxParts {
  const box: BoxShard = {
    schema: "storylets/box@0",
    box: {
      id: newId("b"), gameId: "main",
      title: "Main", purpose: "Your first box of cards.",
      ranking: { specificity: true },
      fields: [],
      properties: [],
    },
  };
  const tags: TagsShard = { schema: "storylets/tags@0", groups: [] };
  const hands: HandsShard = {
    schema: "storylets/hands@0",
    templates: [],
    hands: [{
      id: newId("h"), gameId: "whats-next",
      title: "What's next?",
      purpose: "The starter hand: deal it to see what could happen now.",
      rule: { bindings: {}, slots: "unbounded" },
    }],
  };
  const deck: DeckShard = {
    schema: "storylets/deck@0",
    deck: {
      id: newId("k"), gameId: "starter",
      title: "Starter", purpose: "Two cards that show the loop: draw, play, draw again.",
      properties: [],
    },
    cards: [
      {
        id: newId("c"), gameId: "welcome",
        title: "Welcome",
        purpose: "Dealt first; playing it flips @story.started.",
        priority: 1, redraw: "never",
        outcomes: [{
          id: newId("o"), gameId: "onwards", title: "Onwards",
          changes: { "@story.started": "true" },
        }],
      },
      {
        id: newId("c"), gameId: "what-now",
        title: "What now?",
        purpose: "Only eligible once the story has started.",
        condition: "@story.started",
        priority: 0, redraw: "always",
        outcomes: [{ id: newId("o"), gameId: "carry-on", title: "Carry on", changes: {} }],
      },
    ],
  };

  return { folder: "main", deckFile: "starter", box, tags, hands, deck };
}

// ---------------------------------------------------------------------------
// Map-based Story: the Village's shape, small (the author's specification,
// 2026-08-29; built as step 6 of the kit gallery brief; re-cut on the project
// map, 2026-10-01). A PLACE is a hand, standing on the map where it is; a
// REGION is a zone of the project map, which the places sit in. A scene that
// happens at one place is tagged with that place; a scene that could happen
// anywhere in a region is tagged with the region. ONE starting place whose
// first scene opens the story's second act, and every other place gated on
// that act by its hand template, as the Village gates its wilds. The leads one
// conversation turns up are what the next place's scenes wait on.
// ---------------------------------------------------------------------------

const MAP_STORY_PROPERTIES: PropertyDecl[] = [
  {
    name: "act", type: "quality", stages: ["arrival", "exploring"], default: "arrival",
    purpose: "How far the story has come. Arriving opens the rest of the map: every place beyond the well waits for exploring.",
  },
  {
    name: "leads", type: "flags", values: ["mill_rumour", "wheel_freed"], default: [],
    purpose: "What the player has found out and done. One place's scenes turn up what another's wait on.",
  },
];

/** A rectangle as the four points a zone polygon wants, clockwise from the top left. */
const rect = (x: number, y: number, w: number, h: number): { x: number; y: number }[] =>
  [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

function mapStoryParts(): KitParts {
  const village = newId("v"), woods = newId("v");
  const region: TagGroup = {
    id: newId("d"), gameId: "region",
    purpose: "The regions of the map. A place stands in one; a scene tagged with a region can happen at any place in it.",
    tags: [
      { id: village, gameId: "village", order: 0, templates: { [SPATIAL]: { polygon: rect(0, 0, 640, 240) } } },
      { id: woods, gameId: "woods", order: 1, templates: { [SPATIAL]: { polygon: rect(0, 240, 640, 200) } } },
    ],
    templates: { [SPATIAL]: { map: true } },
  };
  const box: BoxShard = {
    schema: "storylets/box@0",
    box: {
      id: newId("b"), gameId: "riverside",
      title: "Riverside", purpose: "A village on a map. The story starts at the well, and the rest of the map opens once it gets going.",
      ranking: { specificity: true },
      fields: [],
      properties: [],
      usesMap: true,
    },
  };
  const first = newId("t"), beyond = newId("t");
  const well = newId("h"), mill = newId("h"), hut = newId("h");
  const hands: HandsShard = {
    schema: "storylets/hands@0",
    templates: [
      {
        id: first, gameId: "starting-place", title: "Where the story starts",
        purpose: "The place the story starts, open from the start.",
        chooses: [region.id], slots: 3, properties: [],
      },
      {
        id: beyond, gameId: "place-beyond-the-well", title: "Places beyond the well",
        purpose: "A place beyond the well. Closed until the story reaches exploring, so every one of these waits for the arrival scene.",
        chooses: [region.id], condition: '@story.act >= "exploring"', slots: 3, properties: [],
      },
    ],
    hands: [
      { id: well, order: 0, title: "The well", purpose: "The starting place: deal it first.", template: first, chosen: { [region.id]: village } },
      { id: mill, order: 1, title: "The mill race", purpose: "Opens once the story reaches exploring.", template: beyond, chosen: { [region.id]: village } },
      { id: hut, order: 2, title: "The woodcutter's hut", purpose: "Opens once the story reaches exploring.", template: beyond, chosen: { [region.id]: woods } },
    ],
  };
  // Where each place stands: inside the region its hand chooses.
  const sites: MapShard = {
    schema: MAP_SCHEMA,
    map: { sites: { [well]: { x: 160, y: 120 }, [mill]: { x: 480, y: 120 }, [hut]: { x: 320, y: 340 } } },
  };
  const at = (place: string): Record<string, string[]> => ({ [PLACE_GROUP]: [place] });
  const deck: DeckShard = {
    schema: "storylets/deck@0",
    deck: {
      id: newId("k"), gameId: "scenes",
      title: "Scenes", purpose: "Every scene and conversation, filed by the place it happens at, or the region it could happen anywhere in.",
      properties: [],
    },
    cards: [
      {
        id: newId("c"), order: 0, title: "Arrival at the well", priority: 2, redraw: "never", tags: at(well),
        purpose: "The first scene, and the one that opens the map: playing it moves the story on to exploring.",
        outcomes: [{ id: newId("o"), gameId: "look-around", title: "Look around", changes: { "@story.act": "advance(@story.act)" } }],
      },
      {
        id: newId("c"), order: 1, title: "Old Nell at the well", priority: 1, redraw: "never", tags: at(well),
        condition: '@story.act >= "exploring"',
        purpose: "A conversation. Asking about the mill turns up the rumour its scenes wait on; chatting changes nothing.",
        outcomes: [
          { id: newId("o"), gameId: "ask-about-the-mill", title: "Ask about the mill", changes: { "@story.leads": "set_flags(@story.leads, +mill_rumour)" } },
          { id: newId("o"), gameId: "just-chat", title: "Just chat", changes: {} },
        ],
      },
      {
        id: newId("c"), order: 2, title: "The wheel has stopped", priority: 1, redraw: "never", tags: at(mill),
        condition: "check_flags(@story.leads, +mill_rumour)",
        purpose: "A scene at the mill, waiting on Nell's rumour.",
        outcomes: [{ id: newId("o"), gameId: "free-the-wheel", title: "Free the wheel", changes: { "@story.leads": "set_flags(@story.leads, +wheel_freed)" } }],
      },
      {
        id: newId("c"), order: 3, title: "The miller's thanks", priority: 1, redraw: "never", tags: at(mill),
        condition: "check_flags(@story.leads, +wheel_freed)",
        purpose: "A conversation that only happens once the wheel turns again.",
        outcomes: [{ id: newId("o"), gameId: "accept", title: "Accept a sack of flour", changes: {} }],
      },
      {
        id: newId("c"), order: 4, title: "Lights in the woods", priority: 0, redraw: "never", tags: { [region.id]: [woods] },
        purpose: "Anywhere in the woods: a region, not a place, so any place that stands there can deal it. Write where the lights lead.",
        outcomes: [
          { id: newId("o"), gameId: "follow-them", title: "Follow them", changes: {} },
          { id: newId("o"), gameId: "turn-back", title: "Turn back", changes: {} },
        ],
      },
    ],
  };
  return {
    map: projectMapOf(region),
    boxes: [{ folder: "riverside", deckFile: "scenes", box, tags: { schema: "storylets/tags@0", groups: [] }, hands, deck, sites }],
  };
}

// ---------------------------------------------------------------------------
// Action game: Port Meridian trimmed to a beginning (the author's
// specification, 2026-08-29, released 2026-09-27; the kit gallery brief,
// step 6). The storylet engine driving an action game's SUPPORTING systems,
// five boxes on one shared district map, each answering "what belongs here,
// now?" with a different verb: jobs are offered, street trouble is forced,
// finds are hidden, the codex is unlocked, the news is broadcast. The boxes
// talk ONLY through @story, which is the point of the shape: what one box's
// outcome writes, another box's condition reads. The two Port Meridian
// patterns come with it: the WIRE (what just happened, written by outcomes and
// cleared by the game each news cycle) and MOVED ON (the outcome the game
// plays when the player walks away from an encounter).
// ---------------------------------------------------------------------------

const ACTION_GAME_PROPERTIES: PropertyDecl[] = [
  {
    name: "heat", type: "quality", stages: ["unnoticed", "watched"], default: "unnoticed",
    purpose: "How much attention the player has drawn. A job that goes loud raises it; the streets turn meaner once it does.",
  },
  {
    name: "jobs", type: "flags", values: ["delivery_taken", "delivery_done"], default: [],
    purpose: "Where each job stands. The contracts board writes it; the codex reads what it means.",
  },
  {
    name: "found", type: "flags", values: ["burner"], default: [],
    purpose: "Finds that matter beyond their value. The stash writes it; the codex reads it.",
  },
  {
    name: "wire", type: "flags", values: ["raid"], default: [],
    purpose: "What JUST happened, as the screens report it. Outcomes write it beside their permanent record; the GAME clears it each news cycle, then re-deals the screens.",
  },
];

/** The district map: the project's, which every box but the codex is on. One
 *  group, so one set of districts and one value of each district property,
 *  whichever box's hand is standing in it. */
function cityDistricts(): { group: TagGroup; docks: string; oldTown: string } {
  const docks = newId("v"), oldTown = newId("v");
  return {
    docks, oldTown,
    group: {
      id: newId("d"), gameId: "district",
      purpose: "Where it is in the city, drawn on the project map. Every box on the map shares the same districts.",
      tags: [
        { id: docks, gameId: "docks", order: 0, templates: { [SPATIAL]: { polygon: rect(0, 0, 320, 240) } } },
        { id: oldTown, gameId: "old-town", order: 1, templates: { [SPATIAL]: { polygon: rect(320, 0, 320, 240) } } },
      ],
      templates: { [SPATIAL]: { map: true } },
    },
  };
}

function actionBox(
  order: number, gameId: string, title: string, purpose: string, specificity: boolean,
  fields: BoxShard["box"]["fields"] = [], onMap = true,
): BoxShard {
  return {
    schema: "storylets/box@0",
    box: { id: newId("b"), gameId, order, title, purpose, ranking: { specificity }, fields, properties: [], ...(onMap ? { usesMap: true as const } : {}) },
  };
}

function actionGameParts(): KitParts {
  const d = cityDistricts();
  // Contracts: OFFERED. The player chooses to take a job; a taken job has a next step.
  const board = newId("t");
  const contracts: BoxParts = {
    folder: "contracts", deckFile: "jobs",
    box: actionBox(0, "contracts", "Contracts", "Jobs on offer at boards around the city: the player chooses one to take.", true),
    tags: { schema: "storylets/tags@0", groups: [] },
    hands: {
      schema: "storylets/hands@0",
      templates: [{ id: board, gameId: "job-board", title: "Job boards", purpose: "A board jobs are posted on: what work is on offer here, now.", chooses: [d.group.id], slots: 2, properties: [] }],
      hands: [
        { id: newId("h"), order: 0, title: "Dockside board", template: board, chosen: { [d.group.id]: d.docks } },
        { id: newId("h"), order: 1, title: "Old town board", template: board, chosen: { [d.group.id]: d.oldTown } },
      ],
    },
    deck: {
      schema: "storylets/deck@0",
      deck: { id: newId("k"), gameId: "jobs", title: "Jobs", purpose: "Every job and every next step of one.", properties: [] },
      cards: [
        {
          id: newId("c"), order: 0, title: "Cold delivery", priority: 1, redraw: "never", tags: { [d.group.id]: [d.docks] },
          condition: "!check_flags(@story.jobs, +delivery_taken)",
          purpose: "The offer. Taking it moves the job on to its handoff in the old town.",
          outcomes: [{ id: newId("o"), gameId: "take-the-job", title: "Take the job", changes: { "@story.jobs": "set_flags(@story.jobs, +delivery_taken)" } }],
        },
        {
          id: newId("c"), order: 1, title: "Cold delivery: the handoff", priority: 2, redraw: "never", tags: { [d.group.id]: [d.oldTown] },
          condition: "check_flags(@story.jobs, +delivery_taken) && !check_flags(@story.jobs, +delivery_done)",
          purpose: "The follow-up. Going loud raises heat and puts a raid on the wire, which the news then reports.",
          outcomes: [
            { id: newId("o"), gameId: "delivered-clean", title: "Delivered clean", changes: { "@story.jobs": "set_flags(@story.jobs, +delivery_done)" } },
            {
              id: newId("o"), gameId: "it-went-loud", title: "It went loud",
              changes: { "@story.jobs": "set_flags(@story.jobs, +delivery_done)", "@story.heat": "advance(@story.heat)", "@story.wire": "set_flags(@story.wire, +raid)" },
            },
          ],
        },
      ],
    },
  };

  // Encounters: FORCED. The game imposes them as the player moves; Moved on is
  // the outcome the game plays when the player walks away.
  const street = newId("t");
  const movedOn = () => ({ id: newId("o"), gameId: "moved-on", title: "Moved on", purpose: "Played by the game, not the player, when they walk away.", changes: {} });
  const encounters: BoxParts = {
    folder: "encounters", deckFile: "street",
    box: actionBox(1, "encounters", "Encounters", "Trouble the game imposes as the player moves through the city.", true),
    tags: { schema: "storylets/tags@0", groups: [] },
    hands: {
      schema: "storylets/hands@0",
      templates: [{ id: street, gameId: "street", title: "Streets", purpose: "The street the player is on: what trouble finds them here, now.", chooses: [d.group.id], slots: 1, properties: [] }],
      hands: [
        { id: newId("h"), order: 0, title: "Dockside streets", template: street, chosen: { [d.group.id]: d.docks } },
        { id: newId("h"), order: 1, title: "Old town streets", template: street, chosen: { [d.group.id]: d.oldTown } },
      ],
    },
    deck: {
      schema: "storylets/deck@0",
      deck: { id: newId("k"), gameId: "street", title: "Street", purpose: "What the city throws at the player.", properties: [] },
      cards: [
        {
          id: newId("c"), order: 0, title: "Pickpocket", priority: 1, redraw: "always", tags: { [d.group.id]: [d.docks, d.oldTown] },
          purpose: "Anywhere, any time: the filler the streets fall back on.",
          outcomes: [{ id: newId("o"), gameId: "caught-their-wrist", title: "Caught their wrist", changes: {} }, movedOn()],
        },
        {
          id: newId("c"), order: 1, title: "Checkpoint", priority: 2, redraw: "always", tags: { [d.group.id]: [d.docks, d.oldTown] },
          condition: '@story.heat >= "watched"',
          purpose: "Only once the player is watched: heat from a job gone loud is what brings it.",
          outcomes: [{ id: newId("o"), gameId: "talk-through-it", title: "Talk through it", changes: {} }, movedOn()],
        },
      ],
    },
  };

  // Items: HIDDEN. Found by exploring; the value field is for the game's economy.
  const stash = newId("t");
  const items: BoxParts = {
    folder: "items", deckFile: "finds",
    box: actionBox(2, "items", "Items", "What exploring turns up. The value field is for the game's economy; the engine never reads it.", true,
      [{ name: "value", type: "number", default: 0, purpose: "What the find is worth to the game's economy." }]),
    tags: { schema: "storylets/tags@0", groups: [] },
    hands: {
      schema: "storylets/hands@0",
      templates: [{ id: stash, gameId: "stash", title: "Hiding places", purpose: "A hiding place the level marks: what is tucked away there, if anything.", chooses: [d.group.id], slots: 1, properties: [] }],
      hands: [
        { id: newId("h"), order: 0, title: "Container 7", template: stash, chosen: { [d.group.id]: d.docks } },
        { id: newId("h"), order: 1, title: "The back room", template: stash, chosen: { [d.group.id]: d.oldTown } },
      ],
    },
    deck: {
      schema: "storylets/deck@0",
      deck: { id: newId("k"), gameId: "finds", title: "Finds", purpose: "Everything there is to find, and where.", properties: [] },
      cards: [
        {
          id: newId("c"), order: 0, title: "A dockside cache", priority: 1, redraw: "never", fields: { value: 40 }, tags: { [d.group.id]: [d.docks] },
          purpose: "Somebody's rainy-day tin, taped under the container floor.",
          outcomes: [{ id: newId("o"), gameId: "crack-it-open", title: "Crack it open", changes: {} }],
        },
        {
          id: newId("c"), order: 1, title: "A clean burner phone", priority: 1, redraw: "never", fields: { value: 0 }, tags: { [d.group.id]: [d.oldTown] },
          purpose: "Worth nothing to sell, and the codex has something to say about it once it is found.",
          outcomes: [{ id: newId("o"), gameId: "pocket-it", title: "Pocket it", changes: { "@story.found": "set_flags(@story.found, +burner)" } }],
        },
      ],
    },
  };

  // Codex: UNLOCKED. Never played: the game reads the page. Its entries unlock
  // from what the OTHER boxes wrote, which is the cross-box causality.
  const archive = newId("t");
  const codex: BoxParts = {
    folder: "codex", deckFile: "entries",
    // Not on the map: an entry is about the city as a whole, not a district.
    box: actionBox(3, "codex", "Codex", "The box the game only reads: entries unlock from what the rest of the game did, and are never played.", false,
      [{ name: "body", type: "string", default: "", purpose: "The entry's text, for the game's codex page." }], false),
    tags: { schema: "storylets/tags@0", groups: [] },
    hands: {
      schema: "storylets/hands@0",
      templates: [{ id: archive, gameId: "archive", title: "The codex page", purpose: "The codex page: every unlocked entry. Slots is the page size.", chooses: [], slots: 12, properties: [] }],
      hands: [{ id: newId("h"), title: "Codex", template: archive, chosen: {} }],
    },
    deck: {
      schema: "storylets/deck@0",
      deck: { id: newId("k"), gameId: "entries", title: "Entries", purpose: "The codex's contents. Never played.", properties: [] },
      cards: [
        {
          id: newId("c"), order: 0, title: "The city", priority: 10, redraw: "never", outcomes: [],
          fields: { body: "A freeport built on stilts and waivers. Two districts, one harbour, no questions at the waterline." },
          purpose: "Known from the start.",
        },
        {
          id: newId("c"), order: 1, title: "The syndicate", priority: 8, redraw: "never", outcomes: [],
          condition: "check_flags(@story.jobs, +delivery_done)",
          fields: { body: "They pay on time and they never ask twice. Nobody knows who they are; everybody has worked for them." },
          purpose: "Unlocked by finishing the delivery on the contracts board.",
        },
        {
          id: newId("c"), order: 2, title: "Burner networks", priority: 6, redraw: "never", outcomes: [],
          condition: "check_flags(@story.found, +burner)",
          fields: { body: "Clean phones change hands in back rooms. Each one is a door to somebody who would rather not be found." },
          purpose: "Unlocked by finding the burner phone in the old town.",
        },
      ],
    },
  };

  // News: BROADCAST. Never played; a screen shows the wire's story over the
  // background chatter, and the game clears the wire each news cycle.
  const screen = newId("t");
  const news: BoxParts = {
    folder: "news", deckFile: "headlines",
    box: actionBox(4, "news", "News", "The city talking about what just happened. Never played: the game clears the wire each news cycle and re-deals the screens.", false),
    tags: { schema: "storylets/tags@0", groups: [] },
    hands: {
      schema: "storylets/hands@0",
      templates: [{ id: screen, gameId: "screen", title: "Public screens", purpose: "A public screen: the story of the moment, over the background chatter.", chooses: [d.group.id], slots: 2, properties: [] }],
      hands: [
        { id: newId("h"), order: 0, title: "Dock screen", template: screen, chosen: { [d.group.id]: d.docks } },
        { id: newId("h"), order: 1, title: "Old town screen", template: screen, chosen: { [d.group.id]: d.oldTown } },
      ],
    },
    deck: {
      schema: "storylets/deck@0",
      deck: { id: newId("k"), gameId: "headlines", title: "Headlines", purpose: "Every story the screens can run.", properties: [] },
      cards: [
        {
          id: newId("c"), order: 0, title: "Acid drizzle advisory", priority: 0, redraw: "never", copies: 2, outcomes: [],
          tags: { [d.group.id]: [d.docks, d.oldTown] },
          purpose: "Background chatter: always there, two copies so both screens can run it.",
        },
        {
          id: newId("c"), order: 1, title: "Container yard raided", priority: 3, redraw: "never", outcomes: [],
          tags: { [d.group.id]: [d.docks, d.oldTown] }, condition: "check_flags(@story.wire, +raid)",
          purpose: "Wire-driven: runs for the one news cycle after a job goes loud, then the game clears the wire.",
        },
      ],
    },
  };
  return { map: projectMapOf(d.group), boxes: [contracts, encounters, items, codex, news] };
}

// --- emitted file bodies (the extension ruling + merge hygiene) --------------

const SHARD_GLOB = "storyletproj,storyletbox,storylettags,storylethands,storyletdeck,storyletview,storyletmap";

const EDITORCONFIG = `# Storylet Studio source is UTF-8 + LF, always (the validator enforces this).
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true

[*.{${SHARD_GLOB}}]
indent_style = space
indent_size = 2
`;

const GITATTRIBUTES = `# Storylet Studio source is UTF-8 + LF text (pinned; never let autocrlf touch it).
*.storyletproj    text eol=lf
*.storyletbox     text eol=lf
*.storylettags    text eol=lf
*.storylethands   text eol=lf
*.storyletdeck    text eol=lf
*.storyletview    text eol=lf
*.storyletmap     text eol=lf

# Id-keyed structured merge for storylets source (the 'storyletengine merge'
# driver; see vcs-setup.md). Until it is registered, git falls back to a
# normal text merge for these - the format carries the everyday cases anyway
# (Tier 1 of the merge design).
*.storyletproj    merge=storylets
*.storyletbox     merge=storylets
*.storylettags    merge=storylets
*.storylethands   merge=storylets
*.storyletdeck    merge=storylets
# The two arrangement shards merge MOST: positions churn, and two designers
# tidying different corners of a canvas, or of the map, must not conflict.
*.storyletview    merge=storylets
*.storyletmap     merge=storylets

# The compiled bundle is committed but REGENERATED, never hand-merged - keep
# ours on conflict and rebuild ('storyletengine validate' catches a stale
# one via the content hash). Needs a one-time
# 'git config merge.ours.driver true' (see vcs-setup.md).
*.storyletsc      text eol=lf merge=ours

# Background images (an orientation aid on a map): bytes, so nothing should ever
# try to diff, merge or normalise line endings in one. Plain git is fine for a
# few MB of floor plan; if yours grow, git-lfs is the escape hatch and nothing
# here depends on it.
assets/**         binary
`;

const GITIGNORE = `# Storylet Studio generated artifacts that are never source:
# Unresolved merge sidecar (a lingering one is a validate error):
*.storyletconflict
`;

const VSCODE_SETTINGS = `{
  // Storylet Studio shards are JSON5 (trailing commas, comments) under per-type
  // extensions - register them so highlighting and validation survive.
  "files.associations": {
    "*.storyletproj": "json5",
    "*.storyletbox": "json5",
    "*.storylettags": "json5",
    "*.storylethands": "json5",
    "*.storyletdeck": "json5",
    "*.storyletview": "json5",
    "*.storyletmap": "json5"
  }
}
`;

const VCS_SETUP = `# VCS setup

\`.gitattributes\` (already emitted) pins storylets shards to UTF-8 + LF text
and marks the compiled \`.storyletsc\` bundle \`merge=ours\` (regenerated, never
hand-merged; \`storyletengine validate\` catches a stale one via the content
hash).

Register the merge drivers once per clone (git config is not repo-tracked):

    git config merge.storylets.name "Storylet Studio structured merge"
    git config merge.storylets.driver "storyletengine merge %O %A %B -o %A --path %P"
    git config merge.ours.driver true

(\`%P\` tells the driver the file's real path, so a conflicted merge can put
its \`.storyletconflict\` sidecar next to the actual shard rather than git's
temp file.)

Wherever the driver is not registered, git falls back to a normal text merge
for the shards - safe, because the format carries the everyday cases:
different decks, different cards in one deck, different fields of one card
all merge cleanly as text (Tier 1 of the merge design); concurrent adds to
one deck are the case the driver exists for.

Recommended pre-commit hook (\`.git/hooks/pre-commit\`, executable):

    #!/bin/sh
    storyletengine validate || exit 1
`;
