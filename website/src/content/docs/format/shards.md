---
title: The shards
description: What each file in a .storylets project holds - the project shard, the box shard, tags, hands, decks and the view - with real examples.
sidebar:
  label: The shards
---

A project is made of six kinds of file, one extension each. Every one is JSON5 with trailing
commas, and every expression is stored as plain source text, never as a syntax tree.

| File | Extension | Holds |
|---|---|---|
| project | `<name>.storyletproj` | settings, `@world` and `@story` declarations, coverage drivers, export config |
| box | `box.storyletbox` | the card template, `@box` properties, the ranking toggle |
| tags | `tags.storylettags` | tag groups: their tags and each tag's properties |
| hands | `hands.storylethands` | hand templates and hands |
| deck | `<name>.storyletdeck` | the cards, and the deck's own gate and `@deck` properties |
| view | `view.storyletview` | the arrangement layer: where things sit on a canvas or a map, and nothing about what they are |

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

## A deck shard

One file per deck. It carries the deck's own identity, its optional gate condition, its
`@deck` properties, and its cards. It may also carry **`shared`**, which makes every card in
the pile scarce across [flows](/play/world-state/#shared-or-per-flow) unless a card says
otherwise: one of each in the world, rather than one each per participant.

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
