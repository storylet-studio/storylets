---
title: Godot
description: Play a .storyletsc bundle in Godot with the pure GDScript addon, from install and load to deal, play, save, and the in-game state panel.
sidebar:
  label: Godot
---

<p><img class="sy-engine" src="/plugin-godot.svg" alt="" width="48" height="48" />The pure GDScript runtime. No native extension to compile, no web view. It loads a <code>.storyletsc</code> bundle and deals from it directly, held to the same <a href="/compatibility/">shared test suite</a> as every other engine.</p>

> Needs Godot 4.7 or newer, which is the version the addon declares and the one every
> release is tested against. The runtime uses only plain GDScript, so it also runs headless.

## Install

Download the Godot zip from the [download page](/download/), drop the **`storyletengine/`**
folder into your project's `addons/` directory, and enable the plugin in **Project ▸ Project
Settings ▸ Plugins**.

The runtime works with or without the plugin enabled. Enabling it registers the `.storyletsc`
importer (so bundles become assets you can `load()`), the bundle inspector, and the export
hook that keeps your bundle in an exported build (see [Exporting your game](#exporting-your-game)).

## Load a bundle

Either read the file yourself:

```gdscript
var text := FileAccess.get_file_as_string("res://story.storyletsc")
var loaded := StoryletBundle.load_from_string(text)
if not loaded["ok"]:
    push_error(loaded["error"])
    return
var bundle = loaded["bundle"]
```

Or, with the plugin enabled, `load("res://story.storyletsc")` gives you a
`StoryletBundleResource` carrying `json_text` and `get_bundle()`.

## Build an engine, open a flow

```gdscript
var engine := StoryletEngine.create(bundle, {"seed": 7, "log": true})
var flow := engine.open_flow("main")
StoryletDebug.register(engine, "main")     # optional: lets the state panel find it
```

The engine is the world. Every play call lives on a **flow** (one playthrough) opened by
name. A single-player game opens `"main"` and never thinks about it again. Several flows run
parallel playthroughs over the same shared state ([the sharing rules](/play/world-state/)).

The same seed always deals the same cards. `"log": true` keeps the event logs. `flow.log()`
is that flow's own, and `engine.log()` is the RUN's, every flow's events in one order with
each entry naming its `flow`. That last one is the only place a story action in another flow
moving shared state is visible, and the state panel shows both (capped at 1000; `{"cap": n}`
sets your own). An unknown key in the options Dictionary is an error, so a typo tells you
instead of doing nothing.

## Deal, peek, outcomes, play

```gdscript
flow.deal_many()                       # refresh every hand
var board := flow.board()              # hand gameId -> Array of card views
for hand in board:
    for card in board[hand]:
        print("%s holds %s" % [hand, card["gameId"]])

var looks := flow.peek("village", {"area": "forest"}, 3)   # look, don't deal

for outcome in flow.outcomes(card_id, hand_id):            # ask when you show them
    if outcome["available"]:
        var err := flow.play(card_id, outcome["gameId"], hand_id)
```

Card views and outcome views are Dictionaries. A card carries `id`, `gameId`, `title`,
`purpose`, and `fields`. An outcome carries `available`, and `fields` too when the box
declares outcome fields. `play()` returns an error String, empty on
success, and changes nothing if the outcome is gated shut or the card isn't in that hand. A
card with no outcomes is played with `""` as the outcome.

## Your game's state

```gdscript
flow.set_property("world.time_of_day", "night")   # write before you deal
flow.get_property("story.reputation")
flow.list_properties()                            # every declared property

flow.advance_turns("village", 1.0)
var turn := flow.turn("village")
var boxes := flow.list_boxes()
```

[Your game's state](/play/world-state/) has the paths, and when to write them.

## Save and load

```gdscript
var envelope := engine.save_game()
var report := engine.load_game(envelope)     # rebuilds every flow...
flow = engine.get_flow("main")               # ...so re-take your handles
```

An engine built on its own carries every property value in its envelope, a self-backed
`@world` included, so those two calls are the whole run. The envelope is `storylets/save@2`,
and a `storylets/save@1` envelope or file from an earlier release still loads. A game that
hands the engine its own registry saves that registry once, beside the envelope
([below](#one-registry-for-the-game)).

A load is forgiving. A card your edit deleted drops off the board, a property you added takes
its default, and a save from an older build goes in without a word. `preview_load(envelope)`
says what that would cost before you spend it and changes nothing. `load_game` returns the
same report Dictionary once it has, with `"exact"` true when the save goes back exactly as it
was and `"evicted"`, `"droppedProperties"`, `"defaultedProperties"`, `"retypedProperties"`, and
the `"version"` / `"hash"` pairs naming what moved. A save for another project is refused, with
an empty Dictionary and a `push_error`.

`save_flow(id)` takes ONE flow's state, for a playthrough stepping away, and
`open_flow(id, {"restore": saved})` puts it back. Closing the flow in between is what releases
the cards it was holding. On the way back, a shared card another flow now holds is dropped and
reported (`preview_flow_restore(id, saved)` asks in advance, and
`{"on_restore_report": Callable}` hands you what the restore actually did).

`StoryletSave.serialize_state(engine, world_values)` and
`StoryletSave.deserialize_state(engine, text)` are the `.storyletsave` string boundary. The
second hands back the file's `@world` values for your game to apply, which matters when your
game binds `@world` to a resolver of its own: those values are your game's, and the engine
never saves them ([why](/play/world-state/#saving-it)). A foreign, malformed, or
wrong-project blob is refused, so a bad file can't corrupt a run.

### One registry for the game

Every property value lives in a registry, a `StoryletScopeRegistry`. Without the `"registry"`
option the engine makes its own and acts as its own game, which is all a game with one engine
needs. A game running Patterplay beside the Storylet Engine makes one registry, registers
`@world` in it, and hands it to both:

```gdscript
var registry := StoryletScopeRegistry.new()
registry.define_owned("world", world_declarations, {"owner": "Game"})   # stored and saved
var engine := StoryletEngine.create(bundle, {"seed": 7, "registry": registry})
```

The engine registers `@story` under `story` and every other bag under a key starting
`storylets/`, each carrying the owner label "Storylet Engine". Either addon's registry class
will do, since both wrap the same shared source. Every scope in the registry reaches your
cards' conditions, and `get_property("patter.gold")` or `set_property("patter.gold", 5)` reads
or writes another engine's value by its path.

Given your registry, the engine leaves every property value out of `save_game()`, and your
game saves the registry once:

```gdscript
var save := {"registry": registry.save(), "storylets": engine.save_game()}
# ...and later, in either order:
registry.load(save["registry"])
engine.load_game(save["storylets"])
```

`@world` is then your game's to register. `define_owned` keeps it in the registry, saved with
the rest; `define_foreign("world", {"get": getter, "set": setter}, world_declarations)` leaves
it in your game's own state, and nothing saves it but you. Pass the engine a `"world"`
resolver instead and it registers that foreign scope for you. A token is taken once: a second
engine that wants a token another already holds is refused, `create` returns null, the error
names the holder, and the registry is left as it was.

A card can name Patter's game-wide scope directly, with no setting in either project: gate on
`@patter.visits`, or change `@patter.gold` in an outcome, which writes it through the registry
under Patter's rules. The bundle records the tokens it names in `externalScopes`
(`StoryletBundle.external_scopes(bundle)` reads it). That content runs only where Patter is on
the same registry. If it is not, `open_flow` and `load_game` refuse before anything changes: each
`push_error`s `this content names @patter, which no engine on this registry registered: give
every engine the game's one registry`, then `open_flow` returns null and `load_game` returns an
empty Dictionary. If Patter takes its scope away mid-game, an outcome writing it fails with an
error String naming the scope.

`engine.hot_swap(edited_bundle)` rebuilds the engine on an edited bundle with the run carried
over, and works on your registry too. It returns `{"ok": true, "engine", "report"}`: the
replacement, on the same registry, and the load report, which names the properties the edit
dropped or defaulted. The old engine hands its own values over and is spent, its flows closed,
so re-take every handle from the new one; nothing belonging to Patter or your game is touched.
A bundle for another project comes back as `{"ok": false, "error"}` before anything moves, and a
rebuild that fails part way puts the old engine and the registry back exactly as they were.

## Errors

GDScript has no exceptions, so the addon reports errors as values:

- `play()`, `load()`, and `set_property()` return an error String, empty on success.
- Bad references and bad option Dictionaries `push_error`.
- An unknown box on `board(box_ref)` is refused with `push_error` and an empty Dictionary.
- An evaluation error inside a deal or peek makes that card or deck unavailable and puts a
  diagnostic in the trace, exactly as the reference runtime does. Never a silent pass, never
  a crash.

The other small differences from the other runtimes are listed on
[Compatibility](/compatibility/#per-engine-differences).

## The state panel

Add a `StoryletStatePanel` to your scene. It's an in-game overlay, `debug_only` by default, so
it builds nothing in a release export and is safe to leave in a scene that ships. With an
engine registered through `StoryletDebug`, it saves and loads `.storyletsave` files with
**Save State… / Load State…** and shows the **run log** (every flow's events in one order),
then a section per open flow, with that flow's declared properties (with a filter, editable),
its per-box turns, its board, and its own retained log, each log behind per-kind filters with
Autoscroll, Copy, and Clear. It reads the flows off the engine, so one
registration covers every flow, however many you open later.

To watch the game from Storyletter instead, and to have saves reach the run without a
restart, add a `StoryletLiveLink` node and attach your ENGINE (the link finds your flows
itself). It opens only in a debug
build. A pushed bundle goes in through `StoryletLiveLink.apply_live_bundle(engine, data)`,
which calls `hot_swap`, so a refresh works whether the engine made its own registry or shares
yours with Patterplay. [Live Link](/play/live-link/) has the wiring and the protocol.

## The bundle inspector

Select an imported bundle in the FileSystem dock and the Inspector shows what the bundle offers
your code: hands, boxes, tags, declared properties. Nothing running needed. See
[the bundle inspector](/play/dev-tools/#the-bundle-inspector).

## Exporting your game

With the plugin enabled there's nothing to configure, because the addon's export hook puts the raw
`.storyletsc` into the exported build at its original path, so
`FileAccess.get_file_as_string("res://story.storyletsc")` reads the same bytes in the editor
and in the export, on every platform.

If you run with the plugin disabled, Godot treats a `.storyletsc` as a non-resource file and
leaves it out of the export. In that case add `*.storyletsc` to your export preset's
**Resources ▸ "Filters to export non-resource files/folders"**.

## The demo

`addons/storyletengine/demo/board_demo.tscn` is the **Board demo**, the Hamlet bundle dealt
onto a board you can play, with the same hands, control labels, and transcript as the other
three runtimes. Open the scene and press Play. The smallest part to read first in
`board_demo.gd` is building the engine, opening a flow, dealing, and reading `board()`. The
rest is UI. Delete
the folder freely, since nothing depends on it.

**The Hamlet on Godot** is the second demo, the same project with [Patter](https://patterkit.dev)
performing each card's dialogue, two engines in one game. It ships as a project zip on the
[download page](/download/#the-hamlet-two-engines-in-one-game); `hamlet_game.gd` is the whole
integration, and [Running it with Patter](/play/with-patter/) explains the handoff.

## Next

- [Dev tools](/play/dev-tools/) covers what every runtime shares.
- [Compatibility & conformance](/compatibility/) explains why it matches the other engines
  exactly.
