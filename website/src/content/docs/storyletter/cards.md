---
title: Designing cards
description: Design cards in Storyletter, from the deck's three views to a card's condition, priority, redraw, copies, sharing, tags, fields, and outcomes.
sidebar:
  label: Designing cards
---

A card is one thing that could happen, whether a beat, an encounter, a topic, or a bark.
Cards live in decks, and a deck lives in a box. This page is the everyday loop of designing
them.

## The deck

Open a deck and its **Cards** tab shows every card in it. A switch at the top right of the
page offers three views of the same cards.

**Card view** shows each card as a face, with its **title**, its condition as an `if`
preview beneath, its **purpose** as body text, and its **tag chips**. Each tag keeps its own
colour, so you learn your zones and your cast by colour and can scan a deck fast.

**Table view** puts title, gameId, When, Where, and Tags down columns, for scanning a long
deck. Where is where the card can come up (the hands it names, and its zones or other tags
that decide where), and Tags is everything else, the same split the card's own Dealing tab
draws.

**Node view** shows the cards as nodes, with the arrows between them worked out for you.
This is a deck's default view, and it has [its own page](/storyletter/node-canvas/).

The switch is remembered, so a deck opens the way you left it.

### Group by

<figure class="doc-shot">
  <img src="/doc-images/GroupBy.png" alt="The Village box's Contents in Storyletter with Group by set to Hand: the Group by control offering Deck, Hand, thread and zone, and the cards under one heading per hand, such as Miners Camp in cave with 4 cards and Market in village with 6, each card face showing its title, its condition and its tags." />
  <figcaption>The Village's cards grouped by Hand: a heading per hand, with the zone it stands in and its count.</figcaption>
</figure>

**Group by**, above the cards in Card and Table view, sorts the same cards under headings.
It's on a deck's Cards tab and on a box's Contents tab, which shows every card in the box.

- **Deck** is the default. On a deck that's the deck as you arranged it, and on a box's
  Contents it's a heading per deck.
- **Hand** gives a heading per hand, with the zone the hand is in beside it, holding the
  cards that name that hand. After those come **Anywhere in** a zone for cards filed to a
  zone, and **Anywhere** last. It's offered when the box has hands and something places cards
  at them: a card that names a hand, or the project map.
- **Any of the box's tag groups**, by name, such as `npc` or `act`, gives a heading per tag
  and **Untagged** last. In a box on the map the zone group is one of them, and a card that
  names a hand is filed under the zone that hand is in.

A card that belongs under more than one heading is shown under each, and says what else it's
under. A heading that names a deck or a hand opens it when clicked. You can only drag cards
into a new order when they're grouped by Deck, because that order is the deck's.

Group by works the same in a box with no map at all: a box of conversation topics grouped by
`npc` reads as one heading per character. Your choice is remembered per box and per page, and
is yours, not the project's.

A card carries no player-facing text. Its purpose is its story as far as your team is
concerned, and reading a deck top to bottom reads the story's beats. Priority, redraw, and
copies aren't on the face; they're one click away, inside the card.

Getting around and editing works like this.

- Click a card to open its document. The deck stays highlighted in the navigator.
- Add a card with **+ New card** at the end of the deck, or **File ▸ New Card**
  (`Shift+Cmd+N`). On the node canvas, right-click for **New card here**.
- Drag to reorder. The order is only how the editor lists the cards; it has no effect on
  which card comes up. (Outcomes are the one place where the order you choose does reach
  the game. Right-click one for **Move up** and **Move down**.)
- Right-click a card for **Duplicate** and **Delete**. `Cmd+D` duplicates the selection.
- Inside a card, `Esc` goes back to the deck, and the stepper beside the trail (`↑` / `↓`)
  moves to the previous or next card without going back.

The deck's other tabs are **Dealing** (the condition for any card in this deck, plus
**Shared across playthroughs**, which makes the whole pile scarce in the world rather than
one each per playthrough) and **Properties** (the deck's own `@deck` state).

Whether you're shown **Shared across playthroughs** depends on the project's
[Play setting](/storyletter/workspace/#play-how-much-of-the-app-you-see). A solo project
hasn't got it. A project whose Play setting reads Venue (set by the server it came from)
also gets **Durable** beside it.

## The card document

The identity heading holds the title, the gameId chip, and the purpose. Below it are three
tabs.

<figure class="doc-shot">
  <img src="/doc-images/Card.png" alt="A card document in Storyletter: The Moneylender's Men from the Hamlet example, on its Dealing tab. It opens with the sentence Comes up anywhere in village when deck.debt is troubled, the zone as a chip, with In Gareth's Debt, Village beneath and a Change button; then the When section with the condition as pills, then Priority 5, Redraw set to never, and Copies." />
  <figcaption>A card's Dealing tab in a box on the map: where and when the card comes up, in one sentence, above the condition (labelled <strong>When</strong>), Priority, Redraw and Copies.</figcaption>
</figure>

### Dealing

Everything about how this card gets dealt is on one page.

In a box where something decides where a card comes up, the tab opens with one sentence
saying where and when: **Comes up at** *The Inn* **when** *the condition*, or **Comes up
anywhere in** *village*, or **Comes up anywhere, always.** That's any box on the project
map, and any box with a hand that binds one of its tag groups, such as a box of conversations
whose hands each bind an `npc`. The hand in the sentence is a chip that opens the hand, and
**Change** opens the picker described below. The condition part follows the When row as you
edit it.

**anywhere** is shown in amber, because in such a box it's usually the answer nobody chose.
A card you make in a deck names no hand, so it comes up at every hand in the box until you
say otherwise. Open a card you've just made in a deck and the tab says so, with **Choose
where** and **Anywhere is right**.

- The When row is the condition to be dealt, written in the expression editor. It knows your project's
  declared properties, so it offers the names that exist. A property pill answers for
  itself. Hover it for the property's purpose (and, for a quality, its ladder of stages),
  and right-click it for **Go to definition**, which opens the property where it's
  declared and lands on it, opened and lit for a moment, and **Find usages**, which opens
  [Find](/storyletter/workspace/#find) on everything that reads or writes it. The same
  works on the pills in an outcome's changes.
- **Priority** is what cards are ordered on, and **higher goes first**. The hint under it
  changes with your box. If the box has **Rank by specificity** on, priority only breaks
  ties between cards that ask for the same amount; if it's off, priority decides the order
  outright.
- **Redraw** is whether a played card can be dealt again. It's a three-way switch,
  `always` / `never` / `turns`, with a number field that wakes up when you pick turns. The
  number is counted in this box's own turns.
- **Copies** is how many hands may hold this card at once. One copy is the rule; more is
  for interchangeable filler.
- **Shared across playthroughs** is whether this card is scarce in the WORLD rather than
  one each per playthrough, which is the difference between "everyone can find the goblin"
  and "only the first player to find it gets it". There are three settings, not two.
  **deck (shared)** or **deck (not shared)** takes whatever the deck says, and the label
  tells you which so you can see why a card in a shared pile is scarce without opening the
  deck. **shared** and **not shared** override it for this card alone.
- The In the world field is how many copies exist across every playthrough, when the card is
  effectively shared. It's offered only then, because on an unshared card it does
  nothing. It defaults to **Copies**, so the common "one in the world, one to a customer"
  needs nothing set.
- **Durable** appears on a project whose Play setting reads Venue, beside Shared and in the
  same three settings. The value survives the run boundary the server it came from draws.
- **Where**, in a box where nothing decides where a card comes up, is a row at the foot of
  the tab instead of the opening sentence. It reads **Anywhere** until you choose otherwise.
- **Change**, on the sentence or the row, opens the picker. Its first section, **Hands**,
  lists the box's hands, each showing the zone it's in; choosing one means the card comes up
  at exactly that hand. Below it is a section for each group that decides where, such as the
  map's zones or `npc`; choosing a zone lets the card come up at any hand in it. Choosing a
  hand and a zone means both must match, which is usually a mistake, so the tab says so when
  the hand you picked isn't in the zone you picked.
- The Tags section is one row per remaining tag group, each a strip of chips you toggle.
  The groups the Where picker owns aren't here. When a card has no tags the section
  collapses to one line reading "untagged", with a `+` to open it.

To see every card that can come up at one hand, open the hand. It opens on its
[Cards tab](/storyletter/box-setup/#what-can-come-up-at-a-hand).

### Outcomes

An outcome is what the player (or your game) can do with the card once it's dealt, and one
card can offer several. The tab is an accordion. Closed outcomes are single rows, and the
open one expands into its full editor, with a title, a purpose, its own condition, and its
**changes**, each a property and an expression. Right-click any row for **Move up**,
**Move down**, **Duplicate**, and **Remove**; the open editor also ends with a
**Remove outcome** button.

If the box declares **outcome fields**, the open outcome also has a **Fields** block,
between its purpose and its condition, with one row per declared field and the same
controls as the card's own Fields tab. They're what this outcome hands your game once the
press lands, the line to show after it, say, and they cost no card. A box that declares
none shows no block.

### Fields

The box's card template, as label-and-control rows, one row per declared field. The
control follows the field's type, so boolean and enum fields offer their values in a
picker, while string, number, and flags fields are text.

If the box declares no fields, the tab says so and points you at the box's **Card
template** tab.

## Saving

There's nothing to remember to save. Your edits are written to the project files as you
make them, in the same fixed layout every time, and the top bar shows where that has got
to (**Saved**, **Saving…**, **Unsaved**). **File ▸ Save** (`Cmd+S`) is there for the
reflex, and flushes anything still pending. Validation re-runs each time it saves.
