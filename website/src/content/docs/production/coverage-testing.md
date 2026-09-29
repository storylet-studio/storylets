---
title: Coverage testing
description: Run seeded playthroughs that report what your content can actually reach, card by card, in Storyletter and from the command line.
sidebar:
  label: Coverage testing
---

Playing your project walks *one* route. Coverage testing walks hundreds. It plays the
project many times with seeded random runs and reports what actually came up, so you catch
content a player can never reach before a player does.

It's the same machinery in the editor and on the command line, so what you see in Storyletter
is what a CI gate sees.

## In Storyletter

**Review ▸ Coverage** (`Shift+Cmd+C`) opens the **Coverage** window.

Three fields, **runs**, **max turns**, and **seed**, and a **Run coverage** button. The same
seed always reproduces the same run.

While a sweep is running, a strip across the top shows how far along it is, how long it has
taken and roughly how long is left, with a **Cancel** button. The editor stays usable
throughout, so you can keep working and stop it whenever you like.

Cancelling doesn't throw the work away. It finishes the run it's in the middle of, then
reports what it measured, marked **stopped early** beside the headline. The run count is what
it actually got through. A partial answer to "does my content get dealt?" is usually still
the answer.

The previous results stay on screen, dimmed, while a new sweep runs, so you can read the last
answer without mistaking it for the live one.

Coverage is a tool window like the Board and Find. It stays open while you edit and sits over
the editor by default, which the **Pin** button releases. The last report stays put, so closing
and reopening the window shows you what you last measured. Opening a different project clears
it.

Under the bar, one line says whether you've told it how your game's own state moves: either
*"3 coverage drivers feeding `@world`"* or *"No coverage drivers: content gated on `@world`
will read as never dealt."* Beside it, **Coverage drivers…** takes you straight to where
they're edited.

<figure class="doc-shot">
  <img src="/doc-images/Coverage.png" alt="The Coverage window after a run on the Hamlet example: runs 200, max turns 100 and seed 0 across the top, then '2 coverage drivers feeding @world'. The headline reads 17 of 17 cards, 100% of cards dealt over 200 runs, with 0 never dealt, 1 rarely dealt, and 0 dealt but never played. Under it, 4 runs saw everything and 196 ran to the turn cap. The card table, captioned 'How often each card came up, over 200 runs' and set to Least reached first, has columns for card, deck, runs dealt, times dealt, and times played. Its first row is Gareth's Gratitude from Gareth's Debt, tagged Rare, dealt in 4.5% of runs, followed by cards dealt in half the runs or more and a long run of cards dealt in every run." />
  <figcaption>The Coverage window after a run on the Hamlet: every card was dealt, and the one that came up in fewer than 5% of runs leads the table, tagged Rare.</figcaption>
</figure>

## Reading the results

**The numbers at the top.** The big count is cards dealt out of all your cards, with the share
beside it, then the run count and the seed. Under it, three counts say how many cards want a
look. **Never dealt** counts the cards no run dealt. **Rarely dealt** counts the cards that were
dealt, but in fewer than 5% of runs. **Dealt, never played** counts the cards that reached a hand
and never had an outcome played.

**How the runs ended.** Under the numbers, one line gives the turns and plays, and the next says
how the playthroughs ended. A run that **saw everything** dealt every card and played every card
that plays only once, so it stopped early. A run that **ran to the turn cap** went the full number
of turns. That's normal for a story with branches, because one run takes one path and the other
runs see the rest. A **stuck** run went 20 turns with nothing dealt. Runs that mostly go stuck
mean the content jams rather than that it was measured. Hover the line for a reminder.

**The table.** Each row is one card: its title, its deck (with its box beneath, when the project
has more than one), and three numbers:

- **Runs dealt** is the share of runs that dealt the card at least once.
- **Times dealt** is how many times it was dealt across all the runs together. A card that stays
  in a hand counts again each turn it's there, so this is usually far more than the number of
  runs.
- **Times played** is how many times an outcome of it was played across all the runs. It can
  also be more than the number of runs, when a card comes round again.

Runs dealt says how easily a card comes up. The two times say how much it was seen once it did.
A card with no outcomes (a news headline, a codex entry, content whose whole job is to be dealt
and read) shows **no outcomes** in the played column instead of a 0.

**Least reached first, or deck order.** The table opens **least reached first**. The cards no run
dealt are at the top, then the rarest, down to the ones every run deals. That puts the rows worth
a look where you see them first. Switch to **Deck order** for every card box by box and deck by
deck, as you wrote them. The window remembers which you picked.

The test plays at random, so how often a card comes up isn't how often a player will see it. Real
players choose on purpose. Read the numbers as "can this happen, and how easily", not as a
forecast.

Every row is a way back into the work. Click a card, an outcome, or a hand and the editor opens
it. Click a property named in one of the reasons below and Find opens on it, listing everywhere
in the project that reads or writes it. That's usually the quickest way to tell a mistake from a
missing driver.

## What it flags

**Never dealt.** A card no run dealt is tinted in the table, and says why where the reason is
knowable:

- *"gated on `@world.time_of_day`, which nothing writes or drives"* means the card depends on
  your game's state and nothing in the content sets it.
- *"`@story.bridge_repaired` is only written by Mend the Bridge, which never came up either"*
  means the state is set, but only by another card that was never dealt. Two silent cards turn
  out to have one cause, and you know which to look at first.

A never-dealt card with neither line simply wasn't reached in these runs.

**Dealt, never played** is a separate fault. These cards reach a hand, and no outcome of theirs
is ever taken. Usually an outcome's condition is the culprit. A card that's dealt a thousand
times and never played is invisible if you only count deals, so these rows have a tint of their
own and say so under the title. A card with no outcomes is never counted here, and doesn't block
a run from counting as exhausted. Your game may play one, with no outcome, but a coverage run
never does, so "never played" would be an accusation it can't answer.

### Rarely dealt

A card tagged **Rare** was dealt, but in fewer than 5% of runs. It can happen, just not easily.
Usually it sits behind an unlikely run of plays, or a condition that's nearly always false. That
can be exactly what you meant, like one encounter among many, or a secret. It's worth a look when
it isn't, like a card most players should see that hides behind a condition you thought was
common.

### Outcomes, warnings, and hands

**Outcomes never played** finishes the sweep at the branch level. A card can be well covered
while one of its outcomes is unreachable.

**Warnings** collects two things the counts alone would hide. Any diagnostic the runtime
actually raised during the runs (a faulting condition, an undeclared name), deduplicated and
counted by run. And the composed-name check, which needs no runs at all. A card or deck gate
reading `@hand.something` that some hand able to ask it never composes faults at evaluation,
so the content silently never deals from that hand, and a plain gap count would have called
it an ordinary miss.

**Cards seen in each hand, over 200 runs** sits at the bottom, folded away. Open it to see
coverage hand by hand, which matters because a hand is the contract between your designer and
your programmer. One row per hand, named as the navigator names it, with its game ID and its
number of deals quietly beneath. The count is out of the cards that could ever come up in that
hand, not out of every card in its box. A card pinned to another place, or tagged for a
different slice, doesn't count against it. A card's conditions aren't considered, and a tag
group chosen as the game runs counts as matching anything, so nothing a run could deal there is
left out. A full hand highlights, and a short bar means cards that could come up in that hand
never did in any run. A hand that no card's tags can reach says so instead of
showing a bar. In a project with more than one box, the hands are grouped under their box's
name.

## On the canvases

With **View ▸ Coverage Overlay** on, the node canvas and the map wear the last run. A card
face carries a band reading **never dealt** or **never played**, a map site is haloed by how
much play reached it, and hovering a card shows how often it was dealt and played. A card
that's fine shows nothing, so the overlay only ever points at a problem.

## Content gated on your game's state

`@world` belongs to your game. Coverage can't invent your game's behaviour, so content gated
on `@world` can't be reached unless you tell coverage how that state moves. Rather than
reporting such a card as dead, coverage says why it couldn't get there.

The fix is a **driver**, and when there's a driver-shaped gap the window offers one button:
**Add coverage drivers**. It works out a starting set of drivers from your conditions, writes
them into the project, and re-runs. Content that was unreachable becomes reachable, and
anything still never dealt after that is a real gap.

## Writing drivers by hand

The quick fix gets you a starting point, and **Project Settings ▸ World** is where you tune it.
The `@world` declarations and the drivers that feed them sit on one page, because they're two
halves of one statement: the game owns this value, and here's how it moves.

Each driver is a property, a pool of values, and when it fires:

| Field | What it means |
|---|---|
| Property | The `@world` property to drive. Only `@world` is drivable: `@story` is written by your outcomes, so play already covers it. |
| Values | The pool, comma separated. `true, false` drives a flag; `0, 50, 51` drives a number; anything else is text. A run picks from the pool at random. |
| When | *Once, at the start* fixes the value for a whole playthrough (a difficulty setting, a chosen class). *Each turn* re-rolls it as the run goes (weather, time of day). |
| How often | For *each turn* drivers: rarely, sometimes, or often. |

**Propose from the cards** reads your conditions and fills the list in. For `@world.danger >= 2`
it proposes the boundary and its neighbours, `1, 2, 3`, so the comparison is exercised from
both sides. It replaces the list, so propose first and tune after. Nothing is written until
you save the dialog.

A driver with no property name, or with an empty pool, can't drive anything and is dropped on
save.

Drivers live in the project file's `coverage` block, so the editor, the CLI and CI all read
one versioned spec. They never reach the compiled bundle.

## From the command line

`storyletengine coverage` is the same run with the same defaults, which is what makes it a CI
gate:

```
$ storyletengine coverage the-hamlet.storylets
coverage: 200 run(s), seed 0, max 100 turns/run, 19729 turns, 19729 plays
inputs driven: @world.knows_road, @world.time_of_day
runs ended: 4 saw everything, 196 ran to the turn cap, 0 stuck
cards dealt 17/17, played 17/17; outcomes played 25/25
never dealt 0, rarely dealt 1 (under 5% of runs), dealt but never played 0
hand the-forge: saw 9/9 cards that can come up here, over 30260 deal(s) in all runs
hand the-inn: saw 8/8 cards that can come up here, over 13874 deal(s) in all runs
hand the-mystic-tree: saw 5/5 cards that can come up here, over 19529 deal(s) in all runs

runs dealt = share of runs that dealt the card at least once; dealt, played = times across all runs; n/a = no outcomes
‼ never dealt   ? never dealt, gated on state nothing sets   ~ rarely dealt (under 5% of runs)   ! dealt, never played

least reached first
    runs dealt   dealt  played  card
  ~       4.5%      27       9  [Gareth's Debt] gareths-gratitude
           50%     431     100  [Mira's Secret] the-sealed-letter
           54%     409     108  [The Calling Tree] the-tree-blooms
```

The table is the window's, least reached first, with each card's deck in brackets. `--order deck`
lists it deck by deck instead, under a heading per deck that counts its gaps. Each hand's count
is out of the cards that could come up there, as in the window.

Never-dealt cards carry the same reasons the window shows, on the lines under them. Here is
the Saltmarsh example, which has two:

```
least reached first
    runs dealt   dealt  played  card
  ?         0%       0       0  [Docks] ambush-at-the-ford
        gated on @hand.danger, written only by ambush-at-the-ford, which never came up either
        gated on @story.reputation, written only by ambush-at-the-ford, pickpocket, which never came up either
  ‼         0%       0       0  [Market] pickpocket
          100%      51      20  [Market] mysterious-stranger
          100%    2000    1980  [Docks] rat-job
```

`--fail-on-gap` exits 1 on any never-dealt card, on any unprovided `@hand` read, and on any
runtime warning the runs raised. `--json` gives you the full report.
`--propose` prints the driver block instead of running, which is the same derivation the
editor's quick fix uses. Every flag is on [the CLI page](/cli/#coverage).

## Gating a build on it

```sh
storyletengine coverage --runs 200 --fail-on-gap
```

That's all CI needs. A never-dealt card fails the job, and because the run is seeded, a
failure reproduces exactly on the machine you debug it on.
