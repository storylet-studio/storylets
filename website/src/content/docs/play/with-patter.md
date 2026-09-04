---
title: Running it with Patter
description: One game, two engines. The Storylet Engine chooses which beat happens and Patter performs its dialogue, joined by a naming convention, one shared world and one save.
sidebar:
  label: With Patter
---

If your cards lead into conversations, [Patter](https://patterkit.dev) can perform them. The
Storylet Engine decides which beat happens next; Patter plays the dialogue for it; your game owns
the world both of them read. Nothing in either project knows about the other. The join is a
naming convention your game follows, and a build-time check keeps it honest.

**The Hamlet** is the worked example: seventeen cards, seventeen scenes, one save. It is playable
in your browser and ships as source for JavaScript, Godot, Unity and Unreal, all from the
[download page](/download/#the-hamlet-two-engines-in-one-game) once its first release is out.

## The convention

Two names, both of which you already write:

- **A card's `gameId` is the name of its Patter scene.** `gameId` is the stable id the engine
  reports a card by, shown as the chip beside the card's title in Storyletter. Give the scene
  the same name.
- **An outcome's `gameId` is what the scene names.** Put it in the Game Data on a choice
  option, and taking that option means reaching that outcome.

Which boxes get performed by Patter is your game's decision, not the project's. A box of ambient
cards can stay text-only beside a box whose every card opens a conversation.

In `the-hamlet.storylets`, the village card `settle-at-the-inn` has outcomes `ask-about-history`
and `ask-about-the-road-north`. In `the-hamlet.patter`, the scene `settle-at-the-inn` offers two
options, one carrying each of those names. That is the whole link.

### Which outcome a scene reached

Your host resolves it in three steps, and the last word wins:

1. **A `gameEvent`** with `outcome` in its Game Data, wherever one fires, beats anything before
   it. This is the scene deciding late, having played the dialogue.
2. **Otherwise the outcome named on the option the player took.**
3. **Otherwise the card's only outcome**, when it declares exactly one.

Most scenes never reach step one. A card with a single outcome needs no Game Data anywhere, so a
scene of pure narration says nothing at all; a card with several is answered by labelling its
options. Reserve the `gameEvent` for a branch that cannot know its outcome until it has played,
and note that it overrules whatever the option promised.

If a scene reaches its end having said nothing, and its card declares more than one outcome, your
host cannot know what happened. Throw. Do not guess, because the wrong outcome moves the world
the wrong way, and the build catches this shape long before a player can.

## The loop

Every host that plays Patter has a step loop. Yours differs in what it does with a choice and
with a `gameEvent`:

```ts
// Once, when the game starts: ONE Patter flow for the box you perform, named after it.
const flow = patter.openFlow("village");

// The player picked a card: enter its scene by name, on that flow.
flow.goto(card.gameId);

// Which outcomes the Storylet Engine will accept right now. Read it again at every
// stop: a scene can write @world mid-performance and change what is open under itself.
const open = new Set(storyFlow.outcomes(card.id, handId).filter((o) => o.available).map((o) => o.gameId));

for (;;) {
  const step = flow.advance();
  if (step.type === "line" || step.type === "text") show(step);
  if (step.type === "choice") { offer(step.options, open); return; }   // wait for the player
  if (step.type === "gameEvent") outcome = step.gameData?.outcome;     // the last word
  if (step.type === "end") break;
}

// Which outcome, by the three steps above, then play it through the Storylet Engine.
storyFlow.play(card.id, outcome ?? labelled ?? onlyOutcome, handId);
storyFlow.dealMany();   // refresh every hand; a card still eligible keeps its place
```

Keep that one flow for the whole run, and find it again with `getFlow` after a load. Do not
open a new flow per card: a fresh flow starts Patter's random sequence over and forgets its
visit counts, so a scene that shuffles its lines would show the same one every time. A `goto`
moves the cursor and resets nothing, and a flow whose last scene ended resumes at the new
address. A bigger project keeps one flow per box it performs. After a choice, call
`flow.choose(optionId)` and run the loop again, remembering the outcome that option named
before you do: by the end of the branch it is gone.

### Two gates on one option

An option can be shut by either engine, on state the other cannot see, so check both and let
each own its own:

- **Patter's `eligible`**, its own condition on the option.
- **The Storylet Engine's `available`**, from `outcomes(cardId, handId)`, on the outcome that
  option leads to. A condition on `@story` or `@deck` is invisible to Patter.

Offer an option only when both agree. Show the rest greyed rather than hidden, as Patter's own
runtime does with an ineligible option: a player who can see the door they cannot open is being
told something, and a player who sees nothing is being told nothing. The Hamlet's Moneylenders'
Men is the worked case, where paying the debt off needs a reputation you may not have yet.

## The world

Both engines read `@world` through a resolver your game provides. Hand the **same object** to
both and there is one picture of the world and nothing to keep in step:

```ts
const world = new World({ time_of_day: "day", knows_road: false }, [/* names only you may set */]);
const story = new StoryletEngine(storyBundle, { seed, world: world.resolver });
const patter = new PatterEngine(patterBundle, { seed, world: world.resolver });
```

Declare the same properties in both projects, with the same names and types. A scene that sets
`@world.knows_road` moves the value the cards' conditions read on the next deal; a card whose
outcome sets it moves what the next scene sees.

Two ways to make a value read-only, and they mean different things:

- **`writable: false` on the declaration** is the story's own promise. Both compilers refuse a
  write in that project, and both engines refuse one at run time.
- **Your game's read-only list** (the second argument above) is your policy. A story that tries
  to set such a value is refused with an error naming it. Your own writes always land. The
  Hamlet leaves the list empty: a scene or a card may move time in it.

Patter's side of the same four points is on its
[world properties](https://patterkit.dev/play/world-properties/) page.

## Saving

Each engine saves only what it owns, and neither puts `@world` in its file. Your game saves it
once, with both engines' saves beside it:

```ts
const envelope = {
  storylets: serializeState(story),   // .storyletsave text
  patter: patterSerialize(patter),    // Patter's save text
  world: world.save(),
  at: currentHand,
  performing: onScreen,               // the transcript so far, and the card being performed
};
```

On load, restore the world first, then each engine from its own text, then pick the flows back up
with `getFlow` rather than opening them again, so a conversation paused at a choice is still
paused with its options ready. Patter restores the flow's position; the lines already spoken are
yours to have kept, which is what `performing` is for.

The envelope is the same on every host, so a game saved in the browser loads in the Godot, Unity
or Unreal version of the Hamlet, mid-conversation, and the tests for each say so.

## The check

Because nothing declares the link, the build checks it, on the two published bundles. The
Hamlet's `scripts/pairing.mjs` runs before every build and fails it when:

- a card in a performed box has no scene of its name, or a scene belongs to no card;
- a scene names an outcome its card does not declare;
- a card with several outcomes has an option that names none and fires no `gameEvent`, so
  taking that branch would leave the host guessing;
- a card with several outcomes declares one that no option and no event can ever name;
- a `@world` property is declared in one project and not the other, or with a different type,
  values, default or `writable` flag, or an outcome writes a property Patter's project declares
  read-only.

Run it whenever you rename a card or an outcome. A `gameId` derived from a card's title
changes when the title does; pin it on the card to keep the scene name stable.

## The Hamlet on each engine

The same game four times, each a project you open and read:

- **JavaScript**: `packages/hamlet-client`, plain JavaScript with no build step: a page, two
  script tags for the runtimes' browser files, three plain scripts. Read `src/world.js` (the
  shared world) then `src/performance.js` (the handoff).
- **Godot 4.7+**: `ports/godot/HamletDemo`. Open the project and press Play; `hamlet_game.gd`
  is the whole integration.
- **Unity 6000.4+**: `ports/unity/HamletDemo`. Press Play; `HamletGame.cs` and `HamletWorld.cs`
  hold it, with Patterplay embedded in `Packages/`.
- **Unreal 5.7+**: `ports/unreal/HamletDemo`. Open the `.uproject`, let it build, press Play.
  `HamletGame.cpp` makes two `Create` calls with one world:
  `UStoryletEngine::Create(Bundle, Seed, false, World)` and `UPatterEngine::Create(Bundle, World)`.

Each ships with Patter's plugin from its pinned release, so the zip runs as downloaded. All
four read the same two published bundles, `storylet-dist/the-hamlet.storyletsc` from
Storyletter and `patter-dist/the_hamlet.patterc` from Patterpad, each editor's default place
beside its project, and committed: a game reads published bundles, and so does the demo.

## Next

- Your engine: [JavaScript](/play/javascript/), [Unity](/play/unity/),
  [Unreal](/play/unreal/), [Godot](/play/godot/).
- [Your game's state](/play/world-state/) for the `@world` rules on their own.
- Patter's [save and Game Data reference](https://patterkit.dev/play/integration/).
