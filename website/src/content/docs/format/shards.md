---
title: The shards
description: Read what each file in a .storylets project holds, from the project and box shards to tags, hands, decks, the view, and the map, with real examples.
sidebar:
  label: The shards
---

A project is made of nine kinds of file. Every one is JSON5 with trailing commas, and every
expression is stored as plain source text, never as a syntax tree. Eight of them are yours.
The ninth, the installation contract, is written by a venue's server.

| File | Name | Holds |
|---|---|---|
| project | `<name>.storyletproj` | settings, `@world` and `@story` declarations, coverage drivers, export config |
| project map | `map.storyletmap`, at the root | the project map: its zone group, each zone's outline, the zone properties, the pictures and the frames |
| box | `box.storyletbox` | the card template, `@box` properties, the ranking toggle, whether the box is timed, and whether it uses the project map |
| tags | `tags.storylettags` | the box's own tag groups: their tags and each tag's properties |
| hands | `hands.storylethands` | hand templates and hands |
| deck | `<name>.storyletdeck` | the cards, and the deck's own gate and `@deck` properties |
| view | `view.storyletview` | the canvases: where cards sit on a deck's node canvas, and the box's colour on the map |
| map | `map.storyletmap`, in a box | where the box's hands stand on the project map, and nothing else |
| notes | `notes.storyletnotes` | comment threads: one per box, and one at the root for the project, its map and its zones |
| contract | `contracts/<installation>.storyletcontract` | what a venue this project is installed at depends on. Not yours: the server writes it |

The two `map.storyletmap` files are told apart by their `schema` tag:
`storylets/projectmap@0` at the root, `storylets/map@0` in a box. The map's pictures live in
an `assets/` folder at the root of the project.

### How they sit on disk

<svg viewBox="0 0 620 356" role="img" aria-labelledby="sy-tree-title" style="width:100%;height:auto;font-family:var(--sl-font-mono,monospace)">
  <title id="sy-tree-title">A project folder: the .storyletproj file at the root, beside the project map's map.storyletmap, the project's notes.storyletnotes and an assets folder for the map's pictures; then one folder per box containing box.storyletbox, tags.storylettags, hands.storylethands, an optional view.storyletview and map.storyletmap, and a decks folder holding one .storyletdeck file per deck. A dist folder holds the compiled .storyletsc bundle.</title>
  <g font-size="12.5" fill="var(--sl-color-white)">
    <rect x="8" y="10" width="252" height="26" rx="6" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 14%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <text x="20" y="28">the-village.storylets/</text>
    <text x="290" y="28" fill="var(--sl-color-gray-3)" font-size="11.5">the project: a folder, opened as one document</text>
    <text x="40" y="60">the-village.storyletproj</text>
    <text x="290" y="60" fill="var(--sl-color-gray-3)" font-size="11.5">settings, @world and @story, export config</text>
    <text x="40" y="82">map.storyletmap</text>
    <text x="290" y="82" fill="var(--sl-color-gray-3)" font-size="11.5">the project map: zones, outlines, pictures</text>
    <text x="40" y="104">notes.storyletnotes</text>
    <text x="290" y="104" fill="var(--sl-color-gray-3)" font-size="11.5">comments on the project and its map</text>
    <text x="40" y="126">assets/</text>
    <text x="290" y="126" fill="var(--sl-color-gray-3)" font-size="11.5">the map's pictures</text>
    <rect x="30" y="138" width="230" height="26" rx="6" fill="color-mix(in oklab, var(--sy-plum-tint,#9a89b5) 16%, var(--sl-color-bg-sidebar))" stroke="var(--sy-plum-tint,#9a89b5)"/>
    <text x="42" y="156">village/</text>
    <text x="290" y="156" fill="var(--sl-color-gray-3)" font-size="11.5">one folder per box</text>
    <text x="62" y="184">box.storyletbox</text>
    <text x="290" y="184" fill="var(--sl-color-gray-3)" font-size="11.5">card template, @box, ranking, uses the map</text>
    <text x="62" y="206">tags.storylettags</text>
    <text x="290" y="206" fill="var(--sl-color-gray-3)" font-size="11.5">the box's own tag groups</text>
    <text x="62" y="228">hands.storylethands</text>
    <text x="290" y="228" fill="var(--sl-color-gray-3)" font-size="11.5">hand templates and hands</text>
    <text x="62" y="250">view.storyletview</text>
    <text x="290" y="250" fill="var(--sl-color-gray-3)" font-size="11.5">card positions and the box's colour</text>
    <text x="62" y="272">map.storyletmap</text>
    <text x="290" y="272" fill="var(--sl-color-gray-3)" font-size="11.5">where this box's hands stand on the map</text>
    <text x="62" y="294">decks/</text>
    <text x="84" y="316">arrival.storyletdeck</text>
    <text x="290" y="316" fill="var(--sl-color-gray-3)" font-size="11.5">one file per deck: the cards live inside</text>
    <text x="40" y="344" fill="var(--sl-color-gray-2)">dist/the-village.storyletsc</text>
    <text x="290" y="344" fill="var(--sl-color-gray-3)" font-size="11.5">the compiled bundle your game loads</text>
  </g>
  <g stroke="var(--sl-color-gray-4)" fill="none">
    <path d="M22 42 V 340 M22 54 H 36 M22 76 H 36 M22 98 H 36 M22 120 H 36 M22 150 H 26 M22 338 H 36"/>
    <path d="M44 168 V 290 M44 180 H 58 M44 202 H 58 M44 224 H 58 M44 246 H 58 M44 268 H 58 M44 290 H 58"/>
    <path d="M66 300 V 312 H 80"/>
  </g>
</svg>

A deck is one file and a box is one folder, so two people adding decks to the same box add
different files and never meet. That's most of why everyday edits merge on their own, and
[Version control](/setup/version-control/) has the rest.

### The two arrangement shards

Positions live apart from content, in two shards of each box's own, and neither holds anything
about what a thing *is*.

`view.storyletview` is the one shard you can ignore. It holds where a card sits on a deck's
node canvas, the frames drawn round them, and the box's colour on the map. Delete the file and
you lose a layout and a colour choice, never content.

A box's `map.storyletmap` holds where its hands stand on the project map. That one is not safe
to lose, because the positions leave the project: they ship in the bundle when you export with
the map, and they're where a screen or a kiosk stands. Which zone a hand is in isn't recorded
here, since that's the hand's own tag binding, in `hands.storylethands`.

Because of that split, two people arranging the same canvas can only produce a position
conflict, never a content conflict.

The root `map.storyletmap` is different: the zones are content, because cards and hands use
them. See [The project map](#the-project-map) below.

Before October 2026 a map belonged to one box, held in its tags shard with the pictures in
the box's own `assets/` folder, and boxes that shared a map each kept a copy. Earlier still,
before September 2026, the positions lived inside `view.storyletview`. Such a project doesn't
compile until it's moved on: Storyletter offers the upgrade when you open it, and
`storyletengine format` does the same from the command line (see
[Projects made before the project map](/storyletter/maps/#projects-made-before-the-project-map)).

The fixed basenames (`box`, `tags`, `hands`) are kept even though the extension already
carries the type, so a box folder reads the same in a file browser and a diff.

## The project shard

One per project, at the root. It holds everything that isn't specific to a box.

```json5
{
  schema: "storylets/project@0",
  project: {
    id: "proj_village",
    name: "The Hamlet",
    version: "0.1.0",
  },
  coverage: {
    drivers: {
      "@world.time_of_day": {
        cadence: "sometimes",
        kind: "recurring",
        values: [
          "night",
        ],
      },
    },
  },
  export: {
    bundle: "../storylet-dist/the-hamlet.storyletsc",
    metadata: "full",
  },
  settings: {
    playAdvancesTurns: 1,
  },
  story: {
    properties: [
      {
        default: "arrival",
        name: "act",
        stages: [
          "arrival",
          "act-1",
          "act-2",
        ],
        type: "quality",
      },
    ],
  },
  templates: {},
  world: {
    properties: [
      {
        default: "day",
        name: "time_of_day",
        type: "enum",
        values: [
          "day",
          "night",
        ],
      },
    ],
    registry: {},
  },
}
```

**`world`** declares your game's state surface and, in `registry`, who owns each part of
it, whether the storylet engine holds `@world` itself (when it plays on its own) or your host does. **`story`**
declares the story's own globals.

A declaration anywhere except `@world` may also carry **`shared`**, the sharing axis for
projects that run [several flows](/play/world-state/#shared-or-per-flow). `true` is one value
across every flow, and `false` is a copy per flow. Absent means the scope default (`@story`
shared; box, deck, hand, and tag properties per-flow). `@world` takes no flag, because it is
the game's own state and always shared, and the compiler refuses the flag there.

Beside it, and independent of it, **`durable`** says the value
[outlives a run](/play/world-state/#durable-state-that-outlives-a-run), meaning the
installation's memory when it's also shared, and one player's pocket when it isn't. The
engine never reads it. Whoever runs the engine lifts and restores durable values at a run
boundary. `@world` takes no flag here either, and for the same reason.

**`settings.play`** is `"solo"`, `"shared"`, or `"venue"` (absent means `"solo"`). It sets the
[play ladder](/storyletter/workspace/#play-how-much-of-the-app-you-see), which decides how much
of itself Storyletter shows. It is authoring configuration and is never compiled into the
bundle. A project that contains more than its rung shows is a validation warning naming the
rung.

**`export`** names where the compiled bundle goes and whether author metadata rides along
(`full`) or is stripped for size (`stripped`).

**`settings.playAdvancesTurns`** is the default number of turns a play advances its box's
clock. A host can override it per call.

**`coverage.drivers`** configures the coverage harness, keyed by property reference. Only
`@world` is drivable, because every other scope is written by play itself. A driver's `kind`
is `initial` (rolled once per playthrough) or `recurring` (re-rolled per turn at its
`cadence`), and `values` is the pool it draws from. This block never reaches the bundle.

**`templates`** is the configuration bag for templates of play, keyed by template name. The
core validates only what it knows about.

**`gameScopes`** (optional, usually absent) names the game's
[shared scopes folder](/play/with-patter/#sharing-scopes-between-the-editors), relative to the
folder holding the project file: `gameScopes: "../../shared/game-scopes"`. You rarely need it.
Every tool finds a `game-scopes/` folder on its own by looking in the project folder and then
each folder above it, stopping at the root of your repository, so this is only for a folder
that search wouldn't reach. A path that doesn't exist is an error. Storyletter writes it for
you when you share scopes into a folder outside the search. It never reaches the bundle.

**`patter`** (optional) names the [Patter project](/storyletter/patter/#pairing-the-projects)
this one is paired with, relative to the folder holding the project file:
`patter: "../story/the-hamlet.patter"`. With it, `validate` checks each card against the scene
of the same name in that project's published bundle. A path that doesn't exist is a warning,
not an error, since a writer may have the cards without the dialogue. It never reaches the bundle.

Where the game shares its scopes and its `game.scopes.json` declares `@world`, the project's
**`world`** declarations are a synced copy of those. Storyletter rewrites the copy from the
shared file whenever it saves, so the project still compiles when it's packed or checked out
on its own. The shared file wins, and `validate` warns if the two ever differ.

## The box shard

The card shape and the ranking toggle. It's small and changes rarely. In a team this file is
usually owned by the lead, because changing a field's name or type reshapes every card in
the box.

```json5
{
  schema: "storylets/box@0",
  box: {
    fields: [
      {
        default: "",
        name: "scene",
        type: "string",
      },
    ],
    gameId: "village",
    id: "b_village",
    outcomeFields: [
      {
        default: "",
        name: "after",
        type: "string",
      },
    ],
    properties: [],
    purpose: "Every story beat in and around the village.",
    ranking: {
      specificity: true,
    },
    title: "Village",
  },
}
```

`fields` is the **card template**, what every card in this box carries. Fields are data for
your game (a scene id, an animation reference, a text key). The engine never interprets them
and expressions can't read them. `outcomeFields` is the same again for **outcomes**, what an
outcome in this box may carry, declared the same way, for the line your game shows after a
press without spending a card on it. Leave it out when you have none. `properties` is the
`@box` scope. `ranking.specificity` is the one per-box ranking toggle.

An optional `turn` makes this a **timed box**:

```json5
    turn: { seconds: 60 },   // one turn a minute of the run
```

`seconds` is a whole number of seconds, one or more. Declaring it says that a turn in this
box is a length of time, so plays in it no longer advance its clock, your game ticks it
instead, and a card's `redraw: 30` reads as thirty minutes. See
[Dealing](/play/dealing/#a-box-that-counts-in-time). Leave it out and a turn is a play, which
is the ordinary box.

**`usesMap: true`** puts the box on the [project map](#the-project-map). Its hands may then be
bound to the map's zones and its cards filed to them. Leave it out and the box can't name the
map at all; a reference to it from a box that isn't on the map is an error.

## The tags shard

A box's own tag groups and their tags. Tags are declared values, so a typo is a validation error, not a
card that never deals. A tag may carry properties of its own.

```json5
{
  schema: "storylets/tags@0",
  groups: [
    {
      gameId: "zone",
      id: "d_zone",
      purpose: "Where in the world this beat belongs.",
      tags: [
        {
          gameId: "village",
          id: "v_village",
        },
        {
          gameId: "forest",
          id: "v_forest",
          properties: [
            {
              default: 0,
              name: "peril",
              type: "number",
            },
          ],
        },
      ],
    },
  ],
}
```

A group's name is unique **within its box**, not project-wide, so two boxes can each declare
a `zone` group. Tag names are unique within their group, and unique **within their box** as
well, because a tag's properties are addressed as `value.<box>/<tag>.<name>`, which qualifies by box
and no further, so two groups in one box that both name a tag `docks` leave the second one
with no address of its own. Rename one of them, or pin a distinct `gameId` on one. Validation
warns about it in this release and refuses it in the next. Ids are unique across the whole
project.

The project map's names are reserved across the whole project. No box may have a group with
the map's group name, or a tag with a zone's name, because those names mean one thing
everywhere, and `place` can't name the map's group. A box's own group can't be a map: there's
one map, and it's in the project map shard.

## The project map

One file at the root of the project, `map.storyletmap`, holds the project map. This one is
from the Village example, shortened:

```json5
{
  schema: "storylets/projectmap@0",
  group: {
    gameId: "zone",
    id: "d_0001",
    properties: [
      {
        default: "quiet",
        name: "haunting",
        stages: [
          "quiet",
          "restless",
          "screaming",
        ],
        type: "quality",
      },
    ],
    purpose: "Where in the world a beat belongs.",
    tags: [
      {
        gameId: "lair",
        id: "v_0003",
        templates: {
          spatial: {
            polygon: [
              { x: 870, y: -1559 },
              { x: 871, y: -1069 },
              { x: 1754, y: -1067 },
              { x: 1750, y: -1554 },
            ],
          },
        },
      },
      // ... village, forest, mountain, cave
    ],
    templates: {
      spatial: {
        backgrounds: [
          { file: "lair.jpg", id: "g_bglair", x: 870, y: -1559, width: 884, height: 492 },
          // ...
        ],
        map: true,
      },
    },
  },
}
```

**`group`** is the zone group, the same shape as a group in a tags shard. Its tags are the
zones, each with its outline under `templates.spatial.polygon`. Its `properties` are declared
once for every zone, and a zone's own starting values sit in its `values`, as on any tag. A
zone property is one value for every box on the map; `shared` still decides whether it's one
value for every flow too. **`templates.spatial.backgrounds`** are the pictures behind the
map, each naming a file in the project's `assets/` folder. An optional **`frames`** list
holds the map's frames, which never reach the bundle.

A box joins the map with `usesMap: true` in its box shard. Its hands and cards then name the
zones by id, exactly as they name a box's own tags:

```json5
// a hand in hands.storylethands
chosen: { d_0001: "v_0004" },     // stands in the village zone

// a card in a deck
tags: { d_0001: ["v_0003"] },     // can come up anywhere in the lair
```

Each box keeps where its hands stand in its own `map.storyletmap`, keyed by hand id:

```json5
{
  schema: "storylets/map@0",
  map: {
    sites: {
      h_000b: { x: 446, y: -803 },
      h_000c: { x: 839, y: -25 },
    },
  },
}
```

`sites` is the format's word for those positions. A box that isn't on the map has nothing
here, and pins left in such a box are a warning, because they aren't drawn or shipped.

Comments on the map itself, or on a zone, are kept in the root `notes.storyletnotes`; a
comment on a hand stays in its box's notes.

## The hands shard

Hand templates, and the hands made from them.

```json5
{
  schema: "storylets/hands@0",
  hands: [
    {
      chosen: {
        d_zone: "v_village",
      },
      gameId: "the-inn",
      id: "h_inn",
      slots: 2,
      template: "t_whats_happening",
      title: "The Inn",
    },
  ],
  templates: [
    {
      chooses: [
        "d_zone",
      ],
      gameId: "whats-happening",
      id: "t_whats_happening",
      properties: [],
      purpose: "The main lens: which story beat happens at a location now. One hand per location.",
      slots: 3,
    },
  ],
}
```

A **template** sets `bindings` (tags fixed for every hand that uses it), `chooses` (the tag
groups each hand fills in for itself), one shared `condition`, a default `slots`, and the
`properties` every hand carries. Templates are author-side only, and your game never names one.

A **hand** is either made from a template (`template`, plus a `chosen` entry for every group
the template lists in `chooses`) or written out in full (a `rule` object with its own
`bindings`, `condition` and `slots`). It's one or the other. A hand made from a template can
override only `slots`; everything else comes from the template.

A hand's `gameId` is the name `deal` is called with from game code, so renaming one is a
breaking change beyond the project's own borders, which `validate` and the merge driver both
flag. A hand with no `gameId` of its own gets one derived from its title.

The scaffolded starter hand shows the written-out form:

```json5
{
  gameId: "whats-next",
  id: "h_w7w0n4vm",
  purpose: "The starter hand: deal it to see what could happen now.",
  rule: {
    bindings: {},
    slots: "unbounded",
  },
  title: "What's next?",
}
```

### A hole filled from a property

A `chosen` value is normally a tag id. It can instead be a **property reference**, and then
the hole moves. The engine resolves the reference each time the hand is asked and binds the
hole to the tag the value names.

```json5
{
  gameId: "the-elder",
  id: "h_elder",
  template: "t_npcs_you_can_talk_to",
  chosen: {
    d_zone: "@hand.zone",
  },
  properties: [
    {
      default: "village",
      name: "zone",
      shared: true,
      type: "enum",
      values: ["village", "forest", "mill"],
    },
  ],
}
```

Move the Elder with `setProperty("hand.the-elder.zone", "forest")` and the next deal follows,
so forest-tagged cards become available at the Elder's hand, and village-tagged ones leave it. There is
no other verb. A `shared: true` declaration like the one above makes the move a world fact, so
every flow sees the Elder in the forest; leave the flag off and each flow moves its own copy,
which is how a party gets a "what is around me" hand that follows them about.

The reference may be `@hand.<name>` (a property this hand or its template declares),
`@story.<name>`, or `@world.<name>`. It has to be a string or an enum, because the value has to
be able to name a tag. A value that names no tag in the group leaves the hole unbound, which
is a wildcard rather than an empty hand, and the deal says so on its
[trace](/play/dev-tools/). A standalone hand does the same thing with a `rule` binding.
`place` is the one group this never applies to, because it's the hand's own name.

## A deck shard

One file per deck. It carries the deck's own identity, its optional gate condition, its
`@deck` properties, and its cards. It may also carry **`shared`**, which makes every card in
the pile scarce across [flows](/play/world-state/#shared-or-per-flow) unless a card says
otherwise (one of each in the world, rather than one each per participant). It may also carry
**`durable`**, which makes every `redraw: never` card in it
[stay played past the end of the run](/play/world-state/#durable-state-that-outlives-a-run).

```json5
{
  schema: "storylets/deck@0",
  deck: {
    gameId: "arrival",
    id: "k_arrival",
    properties: [],
    purpose: "A newcomer finds their footing.",
    title: "Arrival",
  },
  cards: [
    {
      condition: "@act == \"arrival\"",
      fields: {
        scene: "scn_gate",
      },
      gameId: "arrive-at-the-gate",
      id: "c_arrive",
      outcomes: [
        {
          changes: {
            "@story.act": "\"act-1\"",
          },
          fields: {
            after: "The gate swings shut behind you.",
          },
          gameId: "step-through",
          id: "c_arrive_o",
          title: "Step through the gate",
        },
      ],
      priority: 10,
      purpose: "The road ends at a weathered gate; smoke rises from the Inn beyond.",
      redraw: "never",
      tags: {
        d_zone: [
          "v_village",
        ],
      },
      title: "Arrive at the Village Gate",
    },
  ],
}
```

Reading a card top to bottom:

- **`condition`** gates whether the card is available at all. `@act` is short for
  `@story.act`.
- **`fields`** fills in the box's card template. Here the game reads `scene` and plays it.
- **`priority`** is the first ranking key. It can be a number or an expression.
- **`redraw`** is the cooldown policy in this box's own turns: `always`, `never`, or a
  number.
- **`copies`** (absent here, so 1) is how many hands may hold the card at once, counted
  within one playthrough.
- **`shared`** makes the card scarce across [flows](/play/world-state/#shared-or-per-flow),
  one goblin in the whole world rather than one each. Absent, it takes its deck's flag, so the
  usual place to write it's on a deck whose whole pile is scarce. On the card it's the
  override for a single unique card sitting in an ordinary deck. **`sharedCopies`** is then
  how many hands may hold it anywhere, defaulting to `copies`, so `copies: 1, sharedCopies: 5`
  is five in the world, one to a customer.
- **`durable`** says this card's `redraw: never` spend
  [survives the run](/play/world-state/#durable-state-that-outlives-a-run), for whoever
  played it, or for everyone when the card is also shared. Absent, it takes its deck's flag,
  exactly as `shared` does. On any other redraw it means nothing past the run, and the
  compiler warns.
- **`tags`** maps group ids to tag ids. **An absent group is a wildcard**, so this card would
  match any binding of any other group the box declares. Exclusions are written as conditions
  over `@hand`, not as negative tags.
- **`outcomes`** are the choices. Each has a `changes` map from a fully-qualified
  `@scope.name` target to an expression, plus an optional `condition` that gates it. When the
  box declares `outcomeFields`, an outcome fills them in a `fields` map of its own, exactly
  as the card fills the card template. Here `after` is the line the game shows once the gate
  is stepped through. The engine hands it over with the outcome and never reads it.
  A card may have **no outcomes at all**, such as a notice, a headline on a screen, or a codex
  entry, whose whole job is to be shown. Your game plays one with no outcome once it has shown it, so
  it still counts as played, rests by its `redraw` and leaves its hand; nothing is written.
  Such a card may leave the `outcomes` key out altogether, which reads as an empty list.

## Property declarations

The same shape is used everywhere state is declared: `@world`, `@story`, `@box`, `@deck`,
`@hand`, and on a tag. A **tag group** can declare properties too, and then every tag in the
group has them. The group says what the property is, and each tag carries only its own
starting value in `values`. That's the shape to reach for when "every zone has a haunting
level" is what you mean, and it's what keeps a zone added later from quietly arriving
without one.

| Field | Notes |
|---|---|
| `name` | referenced as `@scope.name`; lower case, unique in its scope |
| `type` | `boolean`, `number`, `string`, `enum`, `flags` or `quality` ([which to use](/format/property-types/)) |
| `default` | required, so a declared property always has a value |
| `values` | for `enum` and `flags`. On a TAG, `values` means something else: this tag's starting values for the properties its group declares |
| `stages` | for `quality`: the ladder, in order, lowest first |
| `writable` | `@world` only. `false` makes the property read-only to the story: a condition may read it, an outcome that writes it is a compile error. The game still moves it through its resolver. Default `true` |
| `purpose` | author metadata |

Card template fields use the same shape. The difference is what they're for. A property is
state the expressions read and write, and a field is data handed to your game.

## The installation contract

A project running at a venue (a museum floor, a park, a show) depends on names that live
outside it. Stations are bound to particular hands, a scheduler ticks particular timed boxes,
a clock drives particular properties, and the crew read particular card fields. Rename one of
those and the venue breaks, quietly, after the change has shipped.

So the venue writes down what it depends on, one file per installation, in a `contracts/`
folder beside the project shard:

```json5
// contracts/the-park.storyletcontract
{
  schema: "storylets/contract@0",
  by: "Storylet Server 0.1.0",
  boxes: {
    street: { turn: 60 },              // the scheduler ticks these
  },
  fields: [
    "prompt",                          // the crew and the bridges read these
    "cue",
  ],
  hands: [
    "the-well",                        // stations are bound to these
    "the-forge",
  ],
  installation: "the-park",
  properties: [
    "world.time_phase",                // the clock drives these
    "story.visits",
  ],
  revision: 12,
}
```

Everything in it is by gameId, and a property is written the way `listProperties()` prints
it, with no `@`. A property may instead be written as `{ path: "story.visits", type: "number" }`,
and then a type change is caught as well as a rename. A tag property whose tag name two boxes
share carries the box too (`value.harbour/docks.danger`), which is the address the engine
takes for it; the short form there would provision the venue against a name its own engine
refuses. A project playing at two venues has two
of these files; two files naming the same installation is an error.

`storyletengine validate` treats a break as an **error**: a contracted hand that no longer
exists, a contracted box whose turn is no longer that many seconds, a contracted property that
has gone or changed type, a contracted field no box declares any more. Each one names the
venue, so the message says who cares. `storyletengine contract show` lists what each
installation depends on. The contract itself never reaches the compiled bundle. The server
does not need its own contract back, it needs the bundle to still honour it.

**The server that writes this does not exist yet.** Until it does, a project either has no
contract at all (which is the normal state, and nothing changes) or one written by hand.
