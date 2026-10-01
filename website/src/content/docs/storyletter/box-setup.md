---
title: Setting up a box
description: Set up a box through its page and tabs, from the card template and hand templates to tags, hands, and starting from a box kit.
sidebar:
  label: Setting up a box
---

A box is a self-contained set of decks, hands, and tags (one region, one chapter, one
cast). All of its setup lives on one page, so the navigator stays a tree of content.

## The box page

A box has six tabs, plus **Map** when the box uses the [project map](/storyletter/maps/).

- **Map** comes first on a box that uses the project map, and the box opens on it. It lists
  where this box's hands stand on the map, and **Open map** goes to the map itself. A box
  that isn't on the map has no Map tab, only a quiet line under its purpose: **Use the
  project map** when the project has one, **Make a map** when it hasn't.
- **Contents** lists the box's Decks and Hands, each with a count and a one-line
  description, then every card in the box, which you can sort into headings with
  [Group by](/storyletter/cards/#group-by).
- **Dealing** is how the box puts cards in order. There's one setting, **Rank by
  specificity**, which decides whether a card that asks for more beats a card that asks
  for less. It's on by default, and while it's on, a card's priority is the tie-break.
- **Card template** declares what every card in this box carries. A card's fields are its
  game data, and there's no other mechanism for attaching any. Each field has a name, a
  type (`boolean`, `number`, `string`, `enum`, `flags`, or `quality`, and
  [Property types](/format/property-types/) says which to use), a default, and optional
  values.
  Change a field's name or type and you reshape every card in the box, so in a team this
  is usually lead-owned.
  The same tab declares the box's **Outcome fields** below its card fields, which is what
  an outcome in this box may carry, shaped exactly the same way and filled in each
  outcome's own editor. The tab's count is both lists together.
- **Hand templates** lists the kinds of hand the box declares, each row showing its
  bindings, its slot count and how many hands use it. Click one to open it.
- **Tags** lists the tag groups, each row showing its name and its tags as colour chips.
  Click one to open it. A group can declare properties every one of its tags carries. In a
  box on the map, the map's zone group is listed here too, marked **map**.
- **Properties** declares the box's own `@box` state.

## Hand templates

A **hand template** is a kind of hand. Give it a title in your own words, such as "Places in
the village" or "People you can talk to", and that title is shown under the name of every
hand made from it, and offered when you add a hand on the map. Its document has three tabs.

- **Dealing** holds the template's **bindings** (tag groups pinned to one tag for every
  hand made from it), the groups each hand fills in for itself, and the shared **When**
  condition. That condition is written once and checked for each hand against that hand's
  own tags, so one condition covers every hand it governs.
- **Bindings** shows what's pinned and what's left for each hand to choose, with a count.
- **Properties** declares the `@hand` state every hand made from this template carries.

Edit a template's condition and every hand that uses it follows straight away. A hand can
override only its slot count. Everything else comes from the template.

Your game never names a hand template. Only hands can be dealt.

## Hands

A **hand** is what your game deals: `deal("tavern-encounters")`. The box's Hands page
lists them, each row showing which template it uses (or that it has its own rule) and its
slots.

A hand's document has four tabs, and opens on **Cards**.

- **Cards** is what can come up at this hand (below).
- **Dealing** starts with a **Template** picker, where you choose a template or
  "(standalone, its own rule)". Pick a template and you get one **Chosen tags** row per
  group the template leaves open, each a picker of that group's declared tags. In a box on
  the map, that's where the hand's zone is chosen. Choose its own rule instead and you get
  the bindings and the condition inline.
- **Slots** is how many cards the hand holds. A hand with its own rule switches between
  `unbounded` and a bounded count. A hand made from a template has a single override
  field; leave it blank and the template's value applies.
- **Properties** is the hand's own `@hand` state. A hand made from a template inherits the
  template's properties, and the tab tells you to edit them on the template so every hand
  follows.

You create each hand yourself. They aren't generated from the tags. Not every `npc` value
is someone you can talk to, so you declare the ones that are. In a box on the map, **+ Hand**
on the map makes one and stands it where you click.

### What can come up at a hand

<figure class="doc-shot">
  <img src="/doc-images/HandCards.png" alt="A hand's Cards tab in Storyletter: The Inn from the Village example, with Places in the village, its template's title, under the hand's name. The tabs read Cards 16, Dealing, Slots and Properties. Under Only here 10, each card is a row with its title, its deck, and its condition as an if line; one row also says also at Market." />
  <figcaption>A hand's Cards tab: what could be dealt here, in tiers, with the cards that could come up anywhere counted rather than listed.</figcaption>
</figure>

The **Cards** tab lists every card in the box that could be dealt to this hand, by its tags
alone. Each row is the card's title, its deck, and its condition as an `if` line,
plus **also at** for a card that names other hands too. Clicking a row opens the card. The lists are:

- **Only here**: the cards that name this hand, so they come up here and nowhere else.
- **Anywhere in** a zone, such as **Anywhere in village**: the cards filed to the zone this
  hand is in, which can come up here and at every other hand in that zone.
- **Wherever** a group **is** a tag, such as **Wherever npc is gareth**: for any other group
  the hand binds, the cards tagged with its tag, which also come up at any other hand bound
  the same way.
- A count of the cards that can come up **anywhere**, those that name no hand and have no tag
  in any group this hand binds. **Show** lists them. In a big box that's most of the box, so
  it starts folded.
- **Placed here but can never come up here**, shown only when there are any: cards that name
  this hand but have a tag that rules it out, each with the reason. This is where that
  mistake gets caught.

A card gated on a group the game sets from its state, such as the current act, carries a
badge like **when act: act-2**, because that decides when it comes up, not where.

**+ New card here** asks which deck, then makes a card that names this hand and opens it.
The lists ignore conditions, so they say what *could* be dealt here, whatever the state is
right now. To see what is dealt, use [the Board](/storyletter/board/).

A hand whose zone comes from a property moves about, and its tab has a tier for every zone
it can be in.

## Tag groups

<figure class="doc-shot">
  <img src="/doc-images/TagGroup.png" alt="The Village example's zone group in Storyletter, the project map's tag group: a Properties section declaring 'haunting' as a quality starting at quiet, with the sentence One value for every box beside it and a line pointing to Project settings, General for a value every guest shares; then the zones lair and village, each with its own Tag properties and a Starts at row noted Group default quiet." />
  <figcaption>The project map's zone group: what every zone carries at the top (here a <strong>quality</strong>), and under each zone a <strong>Starts at</strong> row for its own starting value.</figcaption>
</figure>

A tag group's document is a single page, with the group's **Properties** at the top, then
its tags. Tags are declared, not free-form, so a card can only carry a tag the box knows about.

**Properties on the group are the ones every tag has.** "Every zone has a haunting level"
is one declaration here, and each tag below gets a **Starts at** row where you set only
that zone's own value. That's usually what you want. Declare once, and a zone you add next
month arrives with the property already on it.

Whenever a hand is bound to a tag, that tag's properties are part of `@hand`, so a card
reads `@hand.haunting` and never has to know which zone it's in. Writing it back is the
same. An outcome's `@hand.haunting` lands on whichever zone the hand is in, and leaves
every other zone alone. A quality works here too, so each zone can be at its own stage of
the same ladder.

**Tag properties**, on a single tag, are still there for a group whose tags genuinely
differ. If you find yourself adding the same property to every tag by hand, that's the
group form asking to be used instead.

The project map's zones are a tag group like any other, with one page for the whole
project. Its properties are one value for every box that uses the zone, and each row says
whether players share it. See [Zone properties](/storyletter/maps/#zone-properties).

## Starting a box from a box kit

**+ New box** opens the box kit picker. A **box kit** is a starting point you own, fully
editable the moment it lands, with no reference to the kit left behind in your files.

There are two scales, and each says which it is. A box kit scaffolds one box, and a
**game kit** scaffolds a whole project (Storyletter's New Project picker offers those).

| Kit | What you get, and what it teaches |
|---|---|
| **Blank** | An empty box, for when you already know the shape you want. Add your own decks, tags, hand templates, and hands. |
| **Encounters on a map** (`rpg` in the CLI) | Things that can happen in each part of the map: the tavern and the market as zones you can redraw, a "Places things happen" template with one hand already on the board, and an encounter whose outcome raises the box's `tension`. Teaches boxes, tags, the map, and what playing a card does. |
| **Conversation topics** (`dialogue` in the CLI) | What each character can bring up: one hand of topics per NPC, including a shared rumour with a single copy, so whoever offers it first gets it. Teaches hands, copies, and how one card can be held by only one hand at a time. |
| **Job board** (`jobs`) | Work on offer at boards around town: two boards standing on the map, a delivery job whose handoff only turns up once it is taken, and heat that a job going loud raises and lying low brings down. |
| **Stash** (`stash`) | What exploring turns up: two hiding places, finds with a `value` field for your game's economy, and one find that only turns up once another points the way. |
| **Codex** (`codex`) | Entries the game reads but never plays, unlocking as the player learns things. Two leads stand in for the rest of your game; point the conditions at your own state once it writes some. |
| **News** (`news`) | Screens around town: background chatter, and stories that lead once something happens. Two happenings stand in for the rest of your game, as in the Codex kit. |
| **Story acts** (`acts`) | A story in three acts: an ordered act the box keeps, beats that wait for their act, one beat in each act that moves the story on, and a finale. |

Job board, Stash, Codex and News are cut from the Port Meridian example, each made to stand on its own.
The kits that use a map put the box on the project map. In a project with no map yet, the
kit's zones become the project map. In a project that has one, the box joins it and its
cards and hands start untagged, ready for you to file to your own zones.
Every narrated kit carries a purpose note on every piece, including the outcomes,
explaining what it's for.

Each teaches something the other doesn't, so working through both covers the model. RPG has
the outcome that writes state, Dialogue has copies and exclusivity. Where a box kit has no use
for a concept, it doesn't declare it.

There was a Barks kit, and it has been withdrawn, because **barks belong in
[Patter](https://patterkit.dev)**, which is built for lines of performed dialogue, and a kit
here would have encouraged writing them in the wrong tool.

`storyletengine new box --kit <name>` scaffolds the same box from the
[command line](/cli/#new-box).
