---
title: Running it with Patter
description: Run the Storylet Engine and Patter in one game, joined by a naming convention, one shared world, and one save.
sidebar:
  label: With Patter
---

If your cards lead into conversations, [Patter](https://patterkit.dev) can perform them. The
Storylet Engine decides which beat happens next, Patter plays the dialogue for it, and your game
owns the world both of them read. Nothing in either project knows about the other. The join is a
naming convention your game follows, and a build-time check keeps it honest.

**The Hamlet** is the worked example (seventeen cards, seventeen scenes, one save). It is playable
in your browser and ships as source for JavaScript, Godot, Unity, and Unreal, all from the
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

Your host resolves it in four steps, and the last word wins:

1. A `gameEvent` with `outcome` in its Game Data, wherever one fires, beats anything before
   it. This is the scene deciding late, having played the dialogue.
2. Otherwise it's the outcome named on the option the player took.
3. Otherwise it's the card's only outcome, when it declares exactly one.
4. Otherwise there's no outcome, when the card declares none, and you play it with `""`.

Most scenes never reach step one. A card with a single outcome needs no Game Data anywhere, so a
scene of pure narration says nothing at all. A card with several is answered by labelling its
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
open a new flow per card. A fresh flow starts Patter's random sequence over and forgets its
visit counts, so a scene that shuffles its lines would show the same one every time. A `goto`
moves the cursor and resets nothing, and a flow whose last scene ended resumes at the new
address. A bigger project keeps one flow per box it performs. After a choice, call
`flow.choose(optionId)` and run the loop again, remembering the outcome that option named
before you do, because by the end of the branch it's gone.

### Two gates on one option

An option can be shut by either engine, on state the other cannot see, so check both and let
each own its own. Patter's `eligible` is its own condition on the option. The Storylet Engine's
`available`, from `outcomes(cardId, handId)`, is on the outcome that option leads to, and a
condition on `@story` or `@deck` is invisible to Patter.

Offer an option only when both agree. Show the rest greyed rather than hidden, as Patter's own
runtime does with an ineligible option: a player who can see the door they cannot open is being
told something, and a player who sees nothing is being told nothing. The Hamlet's Moneylenders'
Men is the worked case, where paying the debt off needs a reputation you may not have yet.

## One registry

Both engines keep their properties in one **registry**, a `ScopeRegistry` from
[`@wildwinter/scoperegistry`](https://www.npmjs.com/package/@wildwinter/scoperegistry). Your game
makes it, registers `@world` in it, and hands it to both engines:

```ts
import { ScopeRegistry } from "@wildwinter/scoperegistry";

const registry = new ScopeRegistry()
  .defineOwned("world", worldDeclarations, { owner: "Game" });   // stored and saved with the rest
const story = new StoryletEngine(storyBundle, { seed, registry });
const patter = new PatterEngine(patterBundle, { seed, registry });
```

The Storylet Engine registers `@story` and its per-flow bags; Patter registers `@patter` and its
per-flow and per-scene bags. A scene that sets `@world.knows_road` moves the value the cards'
conditions read on the next deal, and a card whose outcome sets it moves what the next scene sees.
Each engine can name the other's game-wide scope directly, with no setting in either project:
a Patter line can read and write `@story.act`, and a card can gate on `@patter.visits` or change
`@patter.gold` in an outcome. On its own, each compiler lets the other engine's token through without
checking its names, because that engine owns them; a name that doesn't exist fails when the
card is first evaluated. [Sharing scopes](#sharing-scopes-between-the-editors) lets each editor
check them instead. Only the other engine's shared values are visible this way: Patter's
per-flow globals and scene properties belong to its flows, not to the game. Content that names
the other engine runs only where that engine is on the same registry: without it, opening a flow
or loading a save is refused, naming the token, before anything changes. A tool that runs one
engine alone, such as a preview or a coverage run, refuses that content for the same reason,
unless the game shares its scopes, when it stands the other engine in.

Declare the same `@world` properties in both projects, with the same names and types, or share
your scopes and declare them once. If your game keeps `@world`
in its own state instead, register it as a foreign scope with your resolver
(`registry.defineForeign("world", resolver, worldDeclarations)`), and neither the registry nor
either engine saves it.

There are two ways to make a value read-only, and they mean different things. `writable: false`
on the declaration is the story's own promise. Both compilers refuse a write in that project,
and both engines refuse one at run time. A resolver of your own can keep a read-only list as your
policy, and refuse a story's write to a name on it with an error naming it. Your own writes always
land.

A token is taken once. Building a second engine that wants a token the first holds fails at once,
naming the engine that holds it.

Patter's side of the same points is on its
[world properties](https://patterkit.dev/play/world-properties/) page.

## Sharing scopes between the editors

At run time the registry knows every engine's properties, because each engine registers what
it owns. While you write, Storyletter and Patterpad don't know each other's. So a game keeps
one **`game-scopes/`** folder, usually at the root of its repository, and each tool writes its
own file there and reads the others:

```
my-game/
  game-scopes/
    patter.scopes.json      written by Patterpad and the patter CLI
    storylets.scopes.json   written by Storyletter and storyletengine
    game.scopes.json        the game's own scopes: @world, and any others such as @player
  story/the-hamlet.patter/...
  cards/the-hamlet.storylets/...
```

Make it with **File ▸ Share Scopes with Other Tools…** in either editor. That's the only way it
appears: no tool creates the folder by itself. Commit it beside the projects, so a pull brings
each tool's file and its project together.

Each tool finds the folder by looking in its project folder and then each folder above,
stopping at the root of your repository. A project whose folder is somewhere else names it
with `gameScopes` in its project file (see [the format](/format/shards/#the-project-shard)).

**What each file holds.** `storylets.scopes.json` is your `@story` declarations: name, type,
values or stages, default, read-only, and purpose. It's written whenever you save the project
in Storyletter or run `storyletengine export`, and only when it changed, always in the same
canonical form, so a diff shows real changes. `game.scopes.json` belongs to the game rather
than to either tool. Any tool's World settings edit its `@world`, re-reading it before each
write and leaving its other scopes alone.

**`@world` has one home.** Where `game.scopes.json` declares it, that is `@world` for every
project in the game. The compiler checks against it and copies it into the bundle, so a
standalone engine still backs it from the right defaults. Each project keeps a synced copy of
its own, rewritten on every save, so it still compiles when it's packed or checked out alone.
If the two ever differ (someone edited one by hand), `validate` warns and the shared file wins.

**Checking is warnings.** With `patter.scopes.json` in the folder, `@patter.vists` is a
warning naming the file that should declare it, and so are a type mismatch
(`@patter.visits == "lots"`) and an outcome writing a property Patter marks read-only. Never
errors, because the other project may be a save behind on someone's branch. A token nobody's
file declares is still accepted and unchecked, as before. The game's own scopes work the same
way: once `game.scopes.json` declares `@player`, a card can read `@player.hp`, and the bundle
lists `player` among the scopes it needs someone else to provide.

**The editors offer them.** The condition and outcome editors list the other tools'
properties in the picker, with each one's purpose and owner in the pill's tip.

**Previews stand the other engine in.** The Board, and `peek`, `deal` and `coverage`, build
their engine on a registry holding every scope in the folder except `@story`, each property at
its declared default, so a card gated on `@patter.visits` plays in Storyletter alone. This is
for previews only. Bundles never carry another tool's declarations, and your game still
refuses such content when no engine registered the scope.

**Packs carry a copy.** A [`.storyletpack`](/format/overview/#the-send-envelope-storyletpack)
holds one project folder, and `game-scopes/` sits outside it, so a pack also carries a
read-only copy of the folder's files. Unpacking puts the copy in `game-scopes/` inside the
project, where the tools look first, so the person you send it to gets the checks, the picker,
and the Board's stand-ins too. Merging their pack back never writes their copy over your
folder. If they changed the World properties, though, the merge writes the merged list to your
`game.scopes.json` and says so, since your next save would otherwise copy the old list back
into the project.

## Saving

The registry holds every property from both engines, `@world` included, so your game saves it
once, with each engine's own save beside it. Neither engine's save holds a property value when
the game passed the registry:

```ts
const save = {
  registry: registry.save(),          // every property, once
  storylets: story.saveGame(),        // boards, clocks, cooldowns, the play log
  patter: patter.saveGame(),          // positions, visit counts, selectors
  at: currentHand,
  performing: onScreen,               // the transcript so far, and the card being performed
};
```

On load, build the registry and both engines as before, then load the registry and each engine
from its part, in either order: a value for a flow that hasn't reopened yet waits in the registry
until it does. Then pick the flows back up with `getFlow` rather than opening them again, so a
conversation paused at a choice is still paused with its options ready. Patter restores the
flow's position; the lines already spoken are yours to have kept, which is what `performing` is
for.

The save is the same on every host, so a game saved in the browser loads in the Godot, Unity,
or Unreal version, mid-conversation.

## The check

Because nothing declares the link, the build checks it, on the two published bundles. The
Hamlet's `scripts/pairing.mjs` runs before every build and fails it in any of these cases:

- A card in a performed box has no scene of its name, or a scene belongs to no card.
- A scene names an outcome its card doesn't declare.
- A card with several outcomes has an option that names none and fires no `gameEvent`, so
  taking that branch would leave the host guessing.
- A card with several outcomes declares one that no option and no event can ever name.
- A `@world` property is declared in one project and not the other, or with a different type,
  values, default, or `writable` flag, or an outcome writes a property Patter's project declares
  read-only. Sharing scopes makes this one hard to get wrong while you edit, since both projects
  take `@world` from `game.scopes.json`, and the check still holds the bundles to it.

Run it whenever you rename a card or an outcome. A `gameId` derived from a card's title
changes when the title does until the card is first published, and Publish Bundle pins it then,
so the scene name stays put after that.

### Pairing the projects in Storyletter

Pair the two projects in Storyletter and it runs most of this check as you work, puts what it
finds in the problems bar, and shows on each outcome how its scene reaches it. It can't tell you
a card is missing its scene, since only your game knows which boxes Patter performs, so keep
that part in your build. See [Working with Patter](/storyletter/patter/).

## The Hamlet on each engine

The same game four times, each a project you open and read.

The JavaScript version is `packages/hamlet-client`, plain JavaScript with no build step: a
page, two script tags for the runtimes' browser files, three plain scripts. Read `src/world.js`
(the shared world) then `src/performance.js` (the handoff).

For Godot 4.7+, open `ports/godot/HamletDemo` and press Play. `hamlet_game.gd` is the whole
integration.

Unity 6000.4+ has `ports/unity/HamletDemo`. Press Play. `HamletGame.cs` and `HamletWorld.cs`
hold it, with Patterplay embedded in `Packages/`.

On Unreal 5.7+, open the `.uproject` in `ports/unreal/HamletDemo`, let it build, and press
Play. `HamletGame.cpp` makes two `Create` calls with one world,
`UStoryletEngine::Create(Bundle, Seed, false, World)` and `UPatterEngine::Create(Bundle, World)`.

Each ships with Patter's plugin from its pinned release, so the zip runs as downloaded. All
four read the same two published bundles, `storylet-dist/the-hamlet.storyletsc` from
Storyletter and `patter-dist/the_hamlet.patterc` from Patterpad, each editor's default place
beside its project, and committed. A game reads published bundles, and so does the demo.

## Next

- Your engine's page is [JavaScript](/play/javascript/), [Unity](/play/unity/),
  [Unreal](/play/unreal/), or [Godot](/play/godot/).
- [Your game's state](/play/world-state/) has the `@world` rules on their own.
- Patter's side is its [save and Game Data reference](https://patterkit.dev/play/integration/).
