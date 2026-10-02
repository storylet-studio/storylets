---
title: The Board
description: Deal the hands, play a card, watch the state change, and read the journal in Storyletter's live play window.
sidebar:
  label: The Board
---

Play ▸ The Board (`Cmd+T`), or the ▶ Play button in the top bar, opens the Board, a
separate window running the real runtime over your project, compiled in memory.

This isn't a preview. It's the same engine your game ships with, so if a card is dealt
here it's dealt in your build.

<figure class="doc-shot">
  <img src="/doc-images/Board.png" alt="The Board window on the Port Meridian example in Map view: the box navigator on the left with Everything selected, the five box clocks at turn 2 each with a +1, and the project map's three zones, docks, strip and oldgrid, with hands from Contracts, Encounters, Items and News standing as pins in their boxes' colours, each wearing its card count. A district filter sits top right, and the journal of the session runs down the right." />
  <figcaption>The Board on Port Meridian after two turns: Everything on the map, every box's hands on it in its own colour, the clocks above, and the journal recording each deal and turn.</figcaption>
</figure>

The Board puts you in the player's seat. The diagnostics are all there, but they wait
behind the rail's **State** tab, so the default view is the game.

## The main view

**The hands.** Every declared hand is a labelled group, tagged with its chosen tags as
colour chips, holding its dealt cards as buttons. An empty hand says "nothing here right
now", and a board with no hands at all tells you to add one in the editor.

**The filter bar.** Under **Showing**, one picker per tag group ("area: all", "area:
forest"), so you can say "show me every hand in the forest" and the rest of the board
gets out of the way.

**The clocks.** Each box keeps its own clock, and in a multi-box project the header
shows them all, each with a **+1** to advance that one box alone. **Next turn**
advances every clock together and the hands refresh. Plays advance only the played
card's box. A single-box project shows the one number that is then the whole truth.
Clocks only run forward.

**The box navigator.** Down the left, every box in the project (whatever the main
area shows), with a count of the cards its hands hold and, after each action, a quiet
badge counting what changed there. Visiting a box and moving on clears its badge.
**Everything** at the top shows the whole board as one list. Picking a box scopes the
view to it, and the Board reopens on the box you were watching, remembered per project.
This is how you notice a box you weren't watching react: play a contract in one box
and another box's badge lights.

**List and Map.** In a project with a [map](/storyletter/maps/), a box on the map
offers itself as a **List** of hands or as the **Map**, seen from above, and the
project opens on the map. Your choice is remembered per project, so preferring the list
in one project doesn't decide another's first impression. Pick a hand's pin and its
cards pop up over the bottom of the map, where you're already looking.

**Every box on one map.** When more than one box is on the map, **Everything** draws it
once with every box's hands on it, each pin in its box's colour, and the project opens
there. Play a contract loud and the news screens ring on the same picture, which is the
whole cross-box story in one glance. Pick a box in the navigator to see only its hands.

**Playing a card.** Click a card and it opens: its title, its purpose, and its outcomes,
one full-width button per option. The open card floats over the bottom of the view
(list or map alike), so it stays in front of you wherever the board has scrolled. An
outcome whose condition isn't met is still shown, disabled and labelled `(locked)`,
with a tooltip saying why. A card with no outcomes has one **Done** button instead, which
plays it in one press. Nothing is written, but it leaves its hand, its cooldown starts, and
the clock advances, so a box of notices plays the way a screen would.

Playing takes two steps. Pick an outcome, read what it'll change, then press **Continue**
(focused for you, so Enter commits) or **Back** to change your mind. The card then leaves
its hand, the changes are written, its redraw cooldown starts, and the clock advances.
Escape unwinds the same way, innermost first (the choice, then the open card, then the
window).

## The journal

The rail's **Journal** tab is the story of the session so far, newest last. One line per
event, and in a multi-box project each line is stamped with its box's own clock, so two
lines a stamp apart never read as time travel:

```
the-inn 0   dealt    "Arrive at the Village Gate" -> the-inn
village 1   played   "Arrive at the Village Gate" -> step-through
            wrote    @story.act "arrival" -> "act-1"
village 2   left     "Market Bustle" (cooldown)
T2          turn     every box -> 2
```

A play carries its own story. Its writes sit indented beneath it, and under those the
**and so** lines name its consequences, every card that dealt or left somewhere
*because* of what the play wrote (its condition reads the changed state), plus a card
that took the slot the played card freed. In a project with several boxes this is where
the cross-box story shows itself: play a contract's outcome and read the headlines it
caused appearing on the screens, three sections away. The hands that changed also pulse
briefly, the map marks their pins with a pulsing ring, and each box's header carries a
quiet "changed" count until the next action. A full every-box turn collapses to one
line, and advancing one box alone keeps its own.

Editing state from the State tab is on the record too. It journals as **meddled**, so
the journal shows that you, not the game, wrote it.

Filter chips at the top hide kinds of event: `dealt`, `played`, `wrote` (meddled rides
with it), `left`, `turns`, and a warning chip that carries a count when there is
anything to count. **Copy** takes exactly what you can see, filters included, so you can
paste a session into a bug report.

## Snapshots, save, and restore

**Save state…** gives the current moment a name and keeps it for this sitting.
**Restore…** lists what you've kept and puts one back. From the same panel, **Export…**
writes the current run to a `.storyletsave` file and **Import…** reads one back in (it
joins the snapshot list too).

That's the same `.storyletsave` format a game writes, so a save from your game opens on
the Board and a Board snapshot loads in your game.

## Cards that play Patter scenes

When the project is [paired with a Patter project](/storyletter/patter/) and a box is marked
**Performed by Patter**, opening one of its cards plays the card's scene here: its lines, its
choices, then the outcome it reached, with Continue. Patter runs on the Board beside the Storylet
Engine, on the same properties, and with Patterpad's Live Link on, each save in Patterpad reaches
the Board as you play. See [Playing scenes on the Board](/storyletter/patter/#playing-scenes-on-the-board).

## Cards that name another engine

Where the Board isn't playing Patter's scenes itself, it runs the Storylet Engine on its own, so a card that reads `@patter.visits` or
changes `@patter.gold` needs Patter's values from somewhere. Where the game
[shares its scopes](/play/with-patter/#sharing-scopes-between-the-editors), the Board stands
Patter in: every property its file declares starts at its declared default, and the State tab
lists them beside your own, so you can set `visits` to see what a card gated on it does. A game's own scopes (`@player`) are stood in the same
way. A save made then carries those values too, in the file beside the engine's own part.

Without the folder, or where no file in it declares the scope, the Board can't play the
project. It says so where the table would be, naming the scope and the file that would
declare it.

## Seed, restart, and staleness

The top bar carries the session **seed** as an editable field. Change it and the session
rebuilds. A run is reproducible, because the same seed always deals the same cards.

**Restart** discards the session and its journal and starts again.

The Board pins itself above the editor by default, and the pin is remembered. Turn on
**Follow in the editor** and the editor opens each card as you play it, without taking
focus from the Board.

When you edit the project underneath, the Board notices and shows a banner: "The project
changed in the editor. Restart to play the new version." It won't swap the content under a
run in progress.

## Watching your game

If you've turned on [Live Link](/play/live-link/) and a running game is connected, the
Board can show **its** run instead of its own. A banner offers it: "A game is connected.
Watch it?" Click **Watch it**, or use the **Live** / **Local** switch in the session strip.

In **Live** mode the Board is a mirror. The hands, the cards on them, the journal, and
**Why not?** all come from the game, live, and the clocks read the game's own.
It's observe-only, so the game stays in control. The seed, Next turn, playing a card, the
State tab, Save state, Restore and Restart all step aside, and so do the box navigator and
the List/Map switch: Live mode shows the game's run as a list. **Why not?** follows the
game's latest deals: select a hand, as locally.

**If the game is running several playthroughs at once**, a picker appears beside the switch
naming each one, and the Board follows whichever you choose. The Board shows one
playthrough at a time. Switching is
instant, because the editor keeps each playthrough's last table as it arrives rather than
waiting for that participant to move. An ordinary single-player game never sees the picker.

The rest keeps working. The filter bar still narrows the board, the journal still copies,
and **Follow in the editor** still opens each card the game deals or plays, without taking
focus from the game. The game deals a card, and the card opens in your editor.

Switch back to **Local**, or disconnect the game, and your own session comes back exactly
as you left it.

## The State tab

Beside the Journal on the rail, in List and Map alike, the **State** tab holds the raw
state, which is every declared property with its current value,
editable in place. Changing a value simulates your game writing it. The hands re-deal
straight away, the changed ones pulse, and the edit joins the journal as a **meddled** line,
so you can ask "what would happen at night?" without writing a line of game code, and the
journal records that you made the change.

## Why not?

The third tab answers "why isn't my card showing up here?" for one hand. Select the hand
first: click its name, click its pin on the map, or open one of its cards. The selected hand
is outlined. With nothing selected, the tab says so.

It reads that hand's latest deal, and says when it was and how many cards came up. Under
**Could have come up here** is every card whose tags fit the hand but which still didn't
come up, each with the reason: the hand was full (it lost on priority to the cards that
did), its condition wasn't met, it's on cooldown, its deck's condition wasn't met, a copy is
held elsewhere on the board, and for shared piles "another playthrough is holding it" or
"taken out of the world by another playthrough". A full hand comes first, since those cards
were the nearest miss. **Not for this hand**, folded away underneath, lists the box's other
cards, whose tags never fit it.

Because it's the hand's own deal, everything that decided it counts: conditions that read
the hand, how many cards it holds, and the copies already on the board. It explains what is
on the table now. Play a card or change the state, and the next deal is the one to read.
This is the trace the runtime emits for exactly this purpose.
