// ---------------------------------------------------------------------------
// The kit catalogues: what New Box and New Project offer, and the shipped
// examples beside them. Data, mostly, and the two galleries that show it.
//
// The ids are held to ops' lists by main/box-kits.test.ts, which reads this
// file: the renderer cannot import ops to read them itself.
// ---------------------------------------------------------------------------

import { openKitGallery } from "@wildwinter/app-shell";
import type { KitGalleryItem } from "@wildwinter/app-shell";
import { EXAMPLES } from "../../shared/examples.js";
import type { BoxKit, ProjectKit } from "../../shared/api.js";

// The two kit SCALES have their own names (the author's ruling, 2026-08-29):
// a BOX KIT scaffolds one box, a GAME KIT scaffolds a whole project. "Kit"
// alone said the same sentence at both scales, which read as deliberate but
// left an author unable to say which one they meant. Reboot's glossary called
// the project-scale thing a "template of play"; that phrase stays for the
// LAYERING idea it also names (the spatial map, story acts), and the pickable
// thing is a game kit.
//
// Both are the shell's kit gallery (app-shell kit-gallery.ts): tiles on the
// left, the chosen kit said in full on the right, one screen. It grew here as
// kit-picker.ts and moved into the shell on 2026-09-27 (the kit gallery brief,
// storylet-studio/design/kit-gallery.md), so Patterpad's New Project and New
// Scene draw the same moment.
//
// Every line is written from what the ops actually write (`newBox`, `runInit`),
// not from another description of them: use case first, then what Play shows,
// then its features as pills (the brief, section 3; pills in place of pictures,
// the author's ruling of 2026-09-27). A pill names what the GAME has, as a
// player would meet it ("Rising tension"), never a part of the model
// ("Hand template"): the author's correction the same day, since nearly every
// project has hands and naming them teaches rather than describes.
/** New box: no name field, since a box is named after the fact. */
export function openBoxKitPicker(onPick: (kit: BoxKit) => void): void {
  openKitGallery<BoxKit>({
    title: "New box",
    what: "A box holds one self-contained set of cards, places, and tags, such as one region, one chapter, or one cast. A box kit is a starting point you own, fully editable the moment it lands.",
    sections: [{ items: [
      { id: "blank", name: "Blank", blurb: "An empty box, for when you already know the shape you want." },
      { id: "rpg", name: "Encounters on a map",
        blurb: "Things that can happen in each part of a place. A tavern and a market, drawn on the box's map, and a tension that rises when the player takes a risk.",
        tile: "Things that can happen in each part of a place, drawn on a map.",
        play: "Press Play: deal the tavern's hand, and a stranger offers you a wager.",
        features: ["Places on a map", "Random events", "Rising tension"],
        lands: ["An area tag group, drawn as two zones on the map", "An encounters-at hand template, and the tavern's hand", "An Encounters deck: one card, two outcomes", "A tension property on the box"] },
      { id: "dialogue", name: "Conversation topics",
        blurb: "What each character can bring up. Gareth and Mira each keep their own topics, and a rumour only one of them gets to tell you.",
        tile: "What each character can bring up, and a rumour only one can tell.",
        play: "Press Play: open a conversation with either of them and see what they offer.",
        features: ["Character conversations", "Rumours", "Topics that run out"],
        lands: ["An npc tag group: Gareth and Mira", "A topics-for hand template, and a hand for each of them", "A Topics deck of four, one shared rumour among them"] },
      // The four cut from Port Meridian as it stands (the brief, step 6). Each is
      // one of that demo's boxes made self-contained; what each writes is
      // ops/src/newbox.ts, and ops/test/newbox.test.ts plays every promise below.
      { id: "jobs", name: "Job board",
        blurb: "Work on offer at boards around town. Take a job and its next step turns up; how it ends decides how much attention you draw.",
        tile: "Work on offer at boards around town, with follow-ups.",
        play: "Press Play: take the delivery at the docks, then find its handoff on the old town board.",
        features: ["Jobs to take", "Follow-up missions", "Heat"],
        lands: ["Two job boards, drawn on the map", "A delivery job and its handoff", "A job for lying low", "Job progress and heat, kept by the box"] },
      { id: "stash", name: "Stash",
        blurb: "What exploring turns up: a find in each hiding place, each with a value for your game's economy, and one that only turns up once another points the way.",
        tile: "What exploring turns up, and what it's worth.",
        play: "Press Play: search the back room, take the burner phone, then search it again.",
        features: ["Hidden finds", "Things worth money", "Finds that lead to finds"],
        lands: ["Two hiding places", "Three finds, each with a value", "What has been found, kept by the box"] },
      { id: "codex", name: "Codex",
        blurb: "A codex the game reads but never plays: entries unlock as the player learns things, and the page grows.",
        tile: "Lore entries that unlock as the player learns.",
        play: "Press Play: follow a lead, then deal the codex page and see the new entry.",
        features: ["Lore that unlocks", "A growing archive"],
        lands: ["A codex page with one entry already on it", "Two entries waiting to unlock", "Two leads standing in for the rest of your game"] },
      { id: "news", name: "News",
        blurb: "Screens around town that report what happened: background chatter until something does, then the story leads.",
        tile: "Screens around town that report what happened.",
        play: "Press Play: make something happen, then deal the screens again.",
        features: ["Screens around town", "Stories that react", "Background chatter"],
        lands: ["Two screens, drawn on the map", "Background chatter and two stories", "Two happenings standing in for the rest of your game"] },
      { id: "acts", name: "Story acts",
        blurb: "A story told in three acts. Each act's beats wait for it, one beat in each moves the story on, and the finale waits for the last.",
        tile: "A story in three acts, each beat waiting for its moment.",
        play: "Press Play: read the letter, and the story moves into its second act.",
        features: ["Story acts", "Beats that wait their turn", "A finale"],
        lands: ["The story's act, kept by the box", "Five beats across three acts", "One hand showing what can happen next"] },
    ] }],
    onPick: (kit) => onPick(kit),
  });
}

/** What New Project offers: the game kits, then the shipped examples. */
export type ProjectStart = ProjectKit | `example:${string}`;

/** The game kits, read by New Project and by the welcome's Start group. */
// The ids are ops' GAME_KITS and "with-patter" (ProjectKit), held to that list by
// main/box-kits.test.ts: the renderer cannot import ops to read it.
export const PROJECT_KITS: KitGalleryItem<ProjectKit>[] = [
  // NOT "Empty project ... and nothing else", which was false: init lands a box,
  // a `whats-next` hand and two wired cards, so a new project plays immediately.
  { id: "starter", name: "Starter project",
    blurb: "One box, one place to deal to, and two cards that already work together. Add box kits to it as you go.",
    tile: "Two cards that already work together, ready to play.",
    features: ["A first scene", "Playable at once"],
    play: "Press Play: one card, and playing it opens the next.",
    lands: ["A main box", "A whats-next hand", "A starter deck: two cards, the first opening the second"] },
  // The two products together: dialogue written in Patterpad, dealt by storylets. Offered to
  // everyone, since it only creates files; Patterpad is needed later, to write and publish them.
  { id: "with-patter", name: "Starter project with Patter",
    blurb: "The starter project, and a Patter project beside it for its dialogue: paired, with a scene for each card ready to write in Patterpad.",
    tile: "The starter, with a Patter project beside it for the dialogue.",
    features: ["Written dialogue", "Playable at once"],
    play: "Press Play: the starter's two cards, each with a scene waiting for its lines.",
    lands: ["Everything the starter project has", "A Patter project beside it, paired, with a scene for each card"] },
  // The Village's shape, small (the author's specification, 2026-08-29): what
  // `runInit` writes for it is ops/src/init.ts, and ops/test/game-kits.test.ts
  // plays the promise below.
  { id: "map-story", name: "Map-based story",
    blurb: "A village on a map. The story starts at the well in the square, and the mill and the woods open once it gets going. Scenes and conversations unfold across all three.",
    tile: "A village on a map that opens up as the story goes.",
    play: "Press Play: arrive at the well, and the mill and the woods open to you.",
    features: ["Explorable map", "Places that open up", "Character conversations"],
    lands: ["One box on a drawn map of three zones", "A hand in each zone: the well, the mill race, the woodcutter's hut", "Five scenes and conversations, one opening the rest", "A story act and the leads the scenes wait on"] },
  // Port Meridian trimmed to a beginning (the author's specification, released
  // 2026-09-27): five boxes on one district map, talking only through story
  // state. ops/test/game-kits.test.ts plays the chain below.
  { id: "action-game", name: "Action game",
    blurb: "The story side of an action game: jobs to take, trouble in the streets, things to find, a codex and the news, all on one city map. What happens in one reaches the others: a job gone loud brings checkpoints and makes the news.",
    tile: "An action game's jobs, streets, finds, codex and news.",
    play: "Press Play: take the delivery, let it go loud, then watch the streets and the screens.",
    features: ["Jobs", "Street encounters", "Found items", "A codex", "City news"],
    lands: ["Five boxes on one shared city map", "A job with a next step, and heat when it goes loud", "Street trouble, with Moved on for walking away", "Finds, a codex that unlocks, and screens the game refreshes"] },
];

/** The shipped examples as gallery items, for New Project and the welcome's Learn group. */
export const EXAMPLE_KITS: KitGalleryItem<`example:${string}`>[] = EXAMPLES.map((x) => ({
  id: `example:${x.file}` as const, name: x.name, blurb: x.hint,
  ...(x.badge !== undefined ? { badge: x.badge } : {}), ...(x.tile !== undefined ? { tile: x.tile } : {}),
  ...(x.features !== undefined ? { features: [...x.features] } : {}),
}));

/**
 * New project: the same gallery, one scale up, with a name, and the worked
 * examples as its second shelf (the brief, section 5). Opening an example and
 * making a project from a kit are already the same act, "your own copy in a
 * folder you choose", so they sit side by side; each shelf says what its
 * button does.
 *
 * The game kits are the author's to specify (2026-08-29: Empty, Map-based
 * Story, Action Game), and they arrive as content is built; the brief lists
 * what is shipped and what waits. Inventing plausible ones here would be
 * putting content in front of a decision.
 */
export function openNewProject(initial: ProjectStart | undefined, start: {
  /** Open a shipped example as the author's own copy (main asks for a folder). */
  openExample: (file: string) => void;
  /** Make a project from a game kit (main asks for a folder). */
  create: (name: string, kit: ProjectKit) => void;
}): void {
  openKitGallery<ProjectStart>({
    title: "New project",
    what: "A project is one game's worth of storylets. It holds boxes of cards, the places they're dealt to, and the bundle your game loads.",
    namePlaceholder: "Harbour Town",
    nameLabel: "Project name",
    ...(initial !== undefined ? { initial } : {}),
    sections: [
      // Both buttons say a folder picker follows, with the ellipsis that
      // promises one (Patterpad's "Choose location…").
      { caption: "Start from a kit", note: "A starting point you own, fully editable the moment it lands.", action: "Choose location\u2026", items: PROJECT_KITS },
      { caption: "Learn from a finished project", note: "Each opens as your own copy, in a folder you choose.",
        action: "Open a copy\u2026", usesDetails: false, items: EXAMPLE_KITS },
    ],
    onPick: (choice, { name }) => {
      if (choice.startsWith("example:")) { start.openExample(choice.slice("example:".length)); return; }
      if (name !== undefined) start.create(name, choice as ProjectKit);
    },
  });
}
