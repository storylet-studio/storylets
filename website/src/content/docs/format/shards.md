---
title: The shards
description: What each file in a .storylets project holds - the project shard, the box shard, tags, hands, decks and the view - with real examples.
sidebar:
  label: The shards
---

A project is made of seven kinds of file, one extension each. Every one is JSON5 with trailing
commas, and every expression is stored as plain source text, never as a syntax tree. Six of
them are yours; the seventh, the installation contract, is written by a venue's server.

| File | Extension | Holds |
|---|---|---|
| project | `<name>.storyletproj` | settings, `@world` and `@story` declarations, coverage drivers, export config |
| box | `box.storyletbox` | the card template, `@box` properties, the ranking toggle, whether the box is timed |
| tags | `tags.storylettags` | tag groups: their tags and each tag's properties |
| hands | `hands.storylethands` | hand templates and hands |
| deck | `<name>.storyletdeck` | the cards, and the deck's own gate and `@deck` properties |
| view | `view.storyletview` | the arrangement layer: where things sit on a canvas or a map, and nothing about what they are |
| contract | `contracts/<installation>.storyletcontract` | what a venue this project is installed at depends on. Not yours: the server writes it |

### How they sit on disk

<svg viewBox="0 0 620 268" role="img" aria-labelledby="sy-tree-title" style="width:100%;height:auto;font-family:var(--sl-font-mono,monospace)">
  <title id="sy-tree-title">A project folder: the .storyletproj file at the root, then one folder per box containing box.storyletbox, tags.storylettags, hands.storylethands, an optional view.storyletview, and a decks folder holding one .storyletdeck file per deck. A dist folder holds the compiled .storyletsc bundle.</title>
  <g font-size="12.5" fill="var(--sl-color-white)">
    <rect x="8" y="10" width="252" height="26" rx="6" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 14%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <text x="20" y="28">the-hamlet.storylets/</text>
    <text x="290" y="28" fill="var(--sl-color-gray-3)" font-size="11.5">the project: a folder, opened as one document</text>
    <text x="40" y="60">the-hamlet.storyletproj</text>
    <text x="290" y="60" fill="var(--sl-color-gray-3)" font-size="11.5">settings, @world and @story, export config</text>
    <rect x="30" y="72" width="230" height="26" rx="6" fill="color-mix(in oklab, var(--sy-plum-tint,#9a89b5) 16%, var(--sl-color-bg-sidebar))" stroke="var(--sy-plum-tint,#9a89b5)"/>
    <text x="42" y="90">village/</text>
    <text x="290" y="90" fill="var(--sl-color-gray-3)" font-size="11.5">one folder per box</text>
    <text x="62" y="118">box.storyletbox</text>
    <text x="290" y="118" fill="var(--sl-color-gray-3)" font-size="11.5">card template, @box properties, ranking</text>
    <text x="62" y="140">tags.storylettags</text>
    <text x="290" y="140" fill="var(--sl-color-gray-3)" font-size="11.5">tag groups, and their outlines if it's a map</text>
    <text x="62" y="162">hands.storylethands</text>
    <text x="290" y="162" fill="var(--sl-color-gray-3)" font-size="11.5">hand templates and hands</text>
    <text x="62" y="184">view.storyletview</text>
    <text x="290" y="184" fill="var(--sl-color-gray-3)" font-size="11.5">positions only, and safe to lose</text>
    <text x="62" y="206">decks/</text>
    <text x="84" y="228">arrival.storyletdeck</text>
    <text x="290" y="228" fill="var(--sl-color-gray-3)" font-size="11.5">one file per deck: the cards live inside</text>
    <text x="40" y="256" fill="var(--sl-color-gray-2)">dist/the-hamlet.storyletsc</text>
    <text x="290" y="256" fill="var(--sl-color-gray-3)" font-size="11.5">the compiled bundle your game loads</text>
  </g>
  <g stroke="var(--sl-color-gray-4)" fill="none">
    <path d="M22 42 V 252 M22 54 H 36 M22 84 H 26 M22 250 H 36"/>
    <path d="M44 102 V 222 M44 114 H 58 M44 136 H 58 M44 158 H 58 M44 180 H 58 M44 202 H 58"/>
    <path d="M66 212 V 224 H 80"/>
  </g>
</svg>

A deck is one file and a box is one folder, so two people adding decks to the same box add
different files and never meet. That's most of why everyday edits merge on their own; see
[Version control](/setup/version-control/) for the rest.

### The arrangement layer

`view.storyletview` is the one shard you can ignore. It holds positions (where a card sits
on a deck's canvas, where a hand's site sits on a map) and nothing else. Which zone a site
belongs to isn't recorded here: that's the hand's own tag binding, in `hands.storylethands`.
Delete the file and you lose a layout, never content.

Because of that split, two people arranging the same canvas can only produce a position
conflict, never a content conflict.

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
it: whether the storylet engine holds `@world` itself (when it plays on its own) or your host does. **`story`**
declares the story's own globals.

A declaration anywhere except `@world` may also carry **`shared`** - the sharing axis for
projects that run [several flows](/play/world-state/#shared-or-per-flow): `true` is one value
across every flow, `false` a copy per flow. Absent means the scope default (`@story` shared;
box, deck, hand and tag properties per-flow). `@world` takes no flag: it is the game's own
state and always shared, and the compiler refuses the flag there.

Beside it, and independent of it, **`durable`** says the value
[outlives a run](/play/world-state/#durable-state-that-outlives-a-run): the installation's
memory when it is also shared, one player's pocket when it is not. The engine never reads it;
whoever runs the engine lifts and restores durable values at a run boundary. `@world` takes no
flag here either, and for the same reason.

**`settings.play`** is `"solo"`, `"shared"` or `"venue"` (absent means `"solo"`): the
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
    properties: [],
    purpose: "Every story beat in and around the village.",
    ranking: {
      specificity: true,
    },
    title: "Village",
  },
}
```

`fields` is the **card template**: what every card in this box carries. Fields are data for
your game (a scene id, an animation reference, a text key). The engine never interprets them
and expressions can't read them. `properties` is the `@box` scope. `ranking.specificity` is
the one per-box ranking toggle.

An optional `turn` makes this a **timed box**:

```json5
    turn: { seconds: 60 },   // one turn a minute of the run
```

`seconds` is a whole number of seconds, one or more. Declaring it says that a turn in this
box is a length of time: plays in it no longer advance its clock, your game ticks it instead,
and a card's `redraw: 30` reads as thirty minutes. See
[Dealing](/play/dealing/#a-box-that-counts-in-time). Leave it out and a turn is a play, which
is the ordinary box.

## The tags shard

Tag groups and their tags. Tags are declared values, so a typo is a validation error, not a
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
a `zone` group. Tag names are unique within their group. Ids are unique across the whole
project.

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
      purpose: "The main lens: which story beat happens at a place now. One hand per place.",
      slots: 3,
    },
  ],
}
```

A **template** sets `bindings` (tags fixed for every hand that uses it), `chooses` (the tag
groups each hand fills in for itself), one shared `condition`, a default `slots`, and the
`properties` every hand carries. Templates are author-side only: your game never names one.

A **hand** is either made from a template (`template`, plus a `chosen` entry for every group
the template lists in `chooses`) or written out in full (a `rule` object with its own
`bindings`, `condition` and `slots`). It's one or the other. A hand made from a template can
override only `slots`; everything else comes from the template.

A hand's `gameId` is the name `deal` is called with from game code, so renaming one is a
breaking change beyond the project's own borders; `validate` and the merge driver both flag
it. A hand with no `gameId` of its own gets one derived from its title.

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
the hole moves: the engine resolves the reference each time the hand is asked and binds the
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

Move the Elder with `setProperty("hand.the-elder.zone", "forest")` and the next deal follows:
forest-tagged cards become available at his hand, and village-tagged ones leave it. There is
no other verb. A `shared: true` declaration like the one above makes the move a world fact, so
every flow sees the Elder in the forest; leave the flag off and each flow moves its own copy,
which is how a party gets a "what is around me" hand that follows them about.

The reference may be `@hand.<name>` (a property this hand or its template declares),
`@story.<name>` or `@world.<name>`. It has to be a string or an enum, because the value has to
be able to name a tag. A value that names no tag in the group leaves the hole unbound, which
is a wildcard rather than an empty hand, and the deal says so on its
[trace](/play/dev-tools/). A standalone hand does the same thing with a `rule` binding.
`place` is the one group this never applies to: it is the hand's own name.

## A deck shard

One file per deck. It carries the deck's own identity, its optional gate condition, its
`@deck` properties, and its cards. It may also carry **`shared`**, which makes every card in
the pile scarce across [flows](/play/world-state/#shared-or-per-flow) unless a card says
otherwise: one of each in the world, rather than one each per participant; and **`durable`**,
which makes every `redraw: never` card in it
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
- **`shared`** makes the card scarce across [flows](/play/world-state/#shared-or-per-flow):
  one goblin in the whole world, not one each. Absent, it takes its deck's flag, so the usual
  place to write it is on a deck whose whole pile is scarce; on the card it is the override
  for a single unique card sitting in an ordinary deck. **`sharedCopies`** is then how many
  hands may hold it anywhere, defaulting to `copies` - so `copies: 1, sharedCopies: 5` is
  five in the world, one to a customer.
- **`durable`** says this card's `redraw: never` spend
  [survives the run](/play/world-state/#durable-state-that-outlives-a-run) - for whoever
  played it, or for everyone when the card is also shared. Absent, it takes its deck's flag,
  exactly as `shared` does. On any other redraw it means nothing past the run, and the
  compiler warns.
- **`tags`** maps group ids to tag ids. **An absent group is a wildcard**: this card would
  match any binding of any other group the box declares. Exclusions are written as conditions
  over `@hand`, not as negative tags.
- **`outcomes`** are the choices. Each has a `changes` map from a fully-qualified
  `@scope.name` target to an expression, plus an optional `condition` that gates it.

## Property declarations

The same shape is used everywhere state is declared: `@world`, `@story`, `@box`, `@deck`,
`@hand`, and on a tag. A **tag group** can declare properties too, and then every tag in the
group has them: the group says what the property is, and each tag carries only its own
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

Card template fields use the same shape. The difference is what they're for: a property is
state the expressions read and write; a field is data handed to your game.

## The installation contract

A project running at a venue - a museum floor, a park, a show - depends on names that live
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
and then a type change is caught as well as a rename. A project playing at two venues has two
of these files; two files naming the same installation is an error.

`storyletengine validate` treats a break as an **error**: a contracted hand that no longer
exists, a contracted box whose turn is no longer that many seconds, a contracted property that
has gone or changed type, a contracted field no box declares any more. Each one names the
venue, so the message says who cares. `storyletengine contract show` lists what each
installation depends on. The contract itself never reaches the compiled bundle: the server
does not need its own contract back, it needs the bundle to still honour it.

**The server that writes this does not exist yet.** Until it does, a project either has no
contract at all - which is the normal state, and nothing changes - or one written by hand.
