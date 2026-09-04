---
title: Godot
description: Play a .storyletsc bundle in Godot with the pure GDScript Storylet Engine addon. Download the zip, drop it into addons/, load a bundle, build an engine, open a flow, deal, play, save, and watch live state with the in-game state panel.
sidebar:
  label: Godot
---

<div class="sy-badge">
  <img src="/plugin-godot.svg" alt="" width="56" height="56" />
  <p>The pure GDScript runtime. No native extension to compile, no web view: it loads a <code>.storyletsc</code> bundle and deals from it directly, held to the same <a href="/compatibility/">shared test suite</a> as every other engine.</p>
</div>

> Needs Godot 4.7 or newer, which is the version the addon declares and the one every
> release is tested against. The runtime uses only plain GDScript, so it also runs headless.

## Install

Download the Godot zip from the [download page](/download/), drop the **`storyletengine/`**
folder into your project's `addons/` directory and enable the plugin in **Project ▸ Project
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

The engine is the world; every play call lives on a **flow** - one playthrough - opened by
name. A single-player game opens `"main"` and never thinks about it again; several flows run
parallel playthroughs over the same shared state ([the sharing rules](/play/world-state/)).

The same seed always deals the same cards. `"log": true` keeps the event logs: `flow.log()`
is that flow's own and `engine.log()` is the RUN's, every flow's events in one order with
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

Card views and outcome views are Dictionaries: `id`, `gameId`, `title`, `purpose` and
`fields` on a card; `available` on an outcome. `play()` returns an error String, empty on
success, and changes nothing if the outcome is gated shut or the card isn't in that hand.

## Your game's state

```gdscript
flow.set_property("world.time_of_day", "night")   # write before you deal
flow.get_property("story.reputation")
flow.list_properties()                            # every declared property

flow.advance_turns("village", 1.0)
var turn := flow.turn("village")
var boxes := flow.list_boxes()
```

The paths, and when to write them: [Your game's state](/play/world-state/).

## Save and load

```gdscript
var envelope := engine.save_game()
var load_err := engine.load_game(envelope)   # rebuilds every flow...
flow = engine.get_flow("main")               # ...so re-take your handles
```

`StoryletSave.serialize_state(engine, world_values)` and
`StoryletSave.deserialize_state(engine, text)` (which hands back the file's `@world` values
for your game to apply - [why the engine never saves them](/play/world-state/#saving-it)) are
the `.storyletsave` string boundary. A foreign, malformed or wrong-project blob is refused, so
a bad file can't corrupt a run.

## Errors

GDScript has no exceptions, so the addon reports errors as values:

- `play()`, `load()` and `set_property()` return an error String, empty on success.
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
then a section per open flow: that flow's declared properties (with a filter, editable), its
per-box turns, its board and its own retained log, each log behind per-kind filters with
Autoscroll, Copy and Clear. It reads the flows off the engine, so one
registration covers every flow, however many you open later.

To watch the game from Storyletter instead, and to have saves reach the run without a
restart, add a `StoryletLiveLink` node and attach your ENGINE (the link finds your flows
itself); it opens only in a debug
build. Wiring and the protocol: [Live Link](/play/live-link/).

## The bundle inspector

Select an imported bundle in the FileSystem dock and the Inspector shows what the bundle offers
your code: hands, boxes, tags, declared properties. Nothing running needed. See
[the bundle inspector](/play/dev-tools/#the-bundle-inspector).

## Exporting your game

With the plugin enabled there's nothing to configure: the addon's export hook puts the raw
`.storyletsc` into the exported build at its original path, so
`FileAccess.get_file_as_string("res://story.storyletsc")` reads the same bytes in the editor
and in the export, on every platform.

If you run with the plugin disabled, Godot treats a `.storyletsc` as a non-resource file and
leaves it out of the export. In that case add `*.storyletsc` to your export preset's
**Resources ▸ "Filters to export non-resource files/folders"**.

## The demo

`addons/storyletengine/demo/board_demo.tscn` is the **Board demo**: the Hamlet bundle dealt
onto a board you can play, with the same hands, control labels and transcript as the other
three runtimes. Open the scene and press Play. The smallest part to read first in
`board_demo.gd` is building the engine, opening a flow, dealing and reading `board()`; the rest
is UI. Delete
the folder freely; nothing depends on it.

**The Hamlet on Godot** is the second demo: the same project with [Patter](https://patterkit.dev)
performing each card's dialogue, two engines in one game. It ships as a project zip on the
[download page](/download/#the-hamlet-two-engines-in-one-game); `hamlet_game.gd` is the whole
integration, and [Running it with Patter](/play/with-patter/) explains the handoff.

## Next

- What every runtime shares: [Dev tools](/play/dev-tools/).
- Why it matches the other engines exactly:
  [Compatibility & conformance](/compatibility/).
