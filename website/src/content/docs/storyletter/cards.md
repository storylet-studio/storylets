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
deck. Where is the card's placement (its home hands and regions), and Tags is everything
else, the same split the card's own Dealing tab draws.

**Node view** shows the cards as nodes, with the arrows between them worked out for you.
This is a deck's default view, and it has [its own page](/storyletter/node-canvas/).

The switch is remembered, so a deck opens the way you left it.

A card carries no player-facing text. Its purpose is its story as far as your team is
concerned, and reading a deck top to bottom reads the story's beats. Priority, redraw, and
copies aren't on the face; they're one click away, inside the card.

Getting around and editing works like this.

- Click a card to open its document. The deck stays highlighted in the navigator.
- **+ New card** sits at the end of the deck (and on **File ▸ New Card**, `Shift+Cmd+N`).
  On the node canvas, right-click for **New card here**.
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
  <img src="/doc-images/Card.png" alt="A card document in Storyletter: The Moneylender's Men from the Hamlet example, on its Dealing tab. The When section shows the condition as pills (deck.debt is troubled), then Priority 5, Redraw set to never, Copies 1, and a Where row reading 'anywhere in village' with a Change button." />
  <figcaption>A card's Dealing tab: the condition (labelled <strong>When</strong>), then Priority, Redraw and Copies, then the Where row saying where the card can come up.</figcaption>
</figure>

### Dealing

Everything about how this card gets dealt is on one page.

- **When** is the condition to be dealt, in the expression editor. It knows your project's
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
- **In the world** is how many copies exist across every playthrough, when the card is
  effectively shared. It's offered only then, because on an unshared card it does
  nothing. It defaults to **Copies**, so the common "one in the world, one to a customer"
  needs nothing set.
- **Durable** appears on a project whose Play setting reads Venue, beside Shared and in the
  same three settings. The value survives the run boundary the server it came from draws.
- **Where** is the one you reach for most. It answers "where does this card come up?" in a
  sentence, such as **Anywhere**, or **The Inn**, or **anywhere in the forest**, or a
  combination. **Change** opens a picker with two sections, **Places** (the box's hands,
  each showing the region it sits in) and the region groups. Choosing a place pins the card
  to exactly that place; choosing a region lets it come up anywhere inside one. Choosing
  both means BOTH must match, which is usually a mistake, so the row says so when the place
  you picked isn't in the region you picked.
- **Tags** is one row per remaining tag group, each a strip of chips you toggle. Place and
  region groups aren't here, because the Where row above owns them. When a card has no
  tags the section collapses to one line reading "untagged", with a `+` to open it.

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
