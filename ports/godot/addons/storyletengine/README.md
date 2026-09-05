# Storylet Engine for Godot

Play storylets natively in Godot. Storylet Engine loads a compiled
`.storyletsc` bundle (the file Storyletter's export or the `storyletengine`
CLI writes) and deals, peeks and plays it in pure GDScript: no web view, no
native extension to compile. Every Storylet Engine runtime plays the same
bundle with the same behaviour, verified against the shared conformance
corpus, so a story authored once runs identically here, on the web, in Unity
and in Unreal.

## Layout

```
addons/storyletengine/
  plugin.cfg                 # the addon manifest
  icon.svg                   # the addon icon, from the branding pack
  storyletengine_plugin.gd   # EditorPlugin: registers the .storyletsc importer
  storylet_debug.gd          # StoryletDebug - the static engine registry
  runtime/                   # the pure GDScript runtime (works with the plugin disabled)
    values.gd mulberry32.gd ast.gd expression.gd dialect.gd specificity.gd
    property_bag.gd scope_registry.gd bundle.gd engine.gd flow.gd save.gd
    live_link.gd             # StoryletLiveLink - the Storyletter Live Link client (debug builds)
  editor/                    # the .storyletsc import plugin + bundle resource
  ui/                        # StoryletStatePanel - the in-game examiner
  demo/                      # the Board demo (delete freely)
```

## Install

Drop this `storyletengine/` folder into your project's `addons/` directory
and enable the plugin in *Project > Project Settings > Plugins*. The runtime
works with or without the editor plugin enabled; enabling it registers the
`.storyletsc` importer so bundles become first-class assets. Needs Godot 4.7
or newer, the version this addon declares and every release is tested on.

## Quickstart

```gdscript
var text := FileAccess.get_file_as_string("res://story.storyletsc")
var loaded := StoryletBundle.load_from_string(text)
if not loaded["ok"]:
    push_error(loaded["error"])
    return
var engine := StoryletEngine.create(loaded["bundle"], {"seed": 42})
var flow := engine.open_flow("main")      # a flow is one playthrough

flow.deal_many()                       # refresh every hand
var board := flow.board()              # hand gameId -> Array of card views
for hand in board:
    for card in board[hand]:
        print("%s holds %s" % [hand, card["gameId"]])

var looks := flow.peek("village", {"zone": "docks"}, 3)   # look, never claim
for outcome in flow.outcomes(card_id, hand_id):           # current truth
    if outcome["available"]:
        var err := flow.play(card_id, outcome["gameId"], hand_id)
```

With the import plugin enabled you can also `load("res://story.storyletsc")`
and read a `StoryletBundleResource`'s `json_text` / `get_bundle()`.

Errors: GDScript has no exceptions, so `play()`, `load()` and
`set_property()` return an error String (`""` on success); bad references and
bad option Dictionaries `push_error` (unknown option keys are an error, never
silently ignored). Eval errors inside deals and peeks behave exactly like the
reference runtime: the card or deck is unavailable and the trace carries a
diagnostic; never a silent pass, never a crash.

## Beyond the basics

- **Flows**: the engine owns the bundle, the shared state and `@world`; each
  flow is one playthrough across it. `open_flow` / `get_flow` / `flows` /
  `close_flow` manage them, re-opening a name replaces that flow, and what a
  flow keeps to itself is settled per property when the story is authored.
  A single-player game opens one flow and forgets about it.
- **Shared scarcity**: a deck (or a single card) marked `shared` is scarce
  across flows too, not just the state it reads: one goblin in the world, held
  by whoever was dealt it first, and a shared `redraw: "never"` is spent for
  everyone the moment anyone plays it. `sharedCopies` is the world cap and
  defaults to `copies`.
- **Save / load**: `engine.save_game()` / `engine.load_game(envelope)`
  snapshot and restore the whole run, every open flow included.
  `StoryletSave.serialize_state` / `deserialize_state` are the
  `.storyletsave` string boundary: a foreign, malformed or wrong-project blob
  is refused instead of corrupting a run.
- **What a load would cost**: `load_game` returns a report of everything it
  dropped, defaulted or reset, and `preview_load(envelope)` computes the same
  report without applying anything. `save_flow(id)` and
  `open_flow(id, {"restore": blob})` do it for ONE flow, so a playthrough can
  step away (releasing its shared claims) and come back.
- **Live state**: add a `StoryletStatePanel` (an in-game overlay; `debug_only`
  by default, inert in release exports) and register your ENGINE with
  `StoryletDebug.register(engine, "label")` to watch and edit its shared
  properties and each open flow's properties, per-box turns and board while
  playing, and to save / load `.storyletsave` files from the panel. The panel
  reads the flows off the engine, so one registration covers all of them.
- **Trace + log**: `flow.subscribe_trace(handler)` streams deal / peek /
  evict / play / write / turns / diagnostic events; create the ENGINE with
  `{"log": true}` to retain them. Two logs: `flow.log()` is that flow's own,
  `engine.log()` is the RUN's - every flow's events in one order, each entry
  naming its `flow`, which is the only place a story action in ANOTHER flow
  moving shared state is visible.
- **Live Link**: a `StoryletLiveLink` node connects a running game to
  Storyletter (debug builds only; inert without an editor): attach the
  ENGINE and the editor's Board shows the run, and a save in the
  editor pushes the new bundle in (`bundle_pushed`, then
  `StoryletLiveLink.apply_live_bundle`). The link discovers your flows
  itself, so a multi-participant run needs nothing extra from the host; the
  Board follows one of them at a time. The demo is wired this way.
  See [Live Link](https://storylet.studio/play/live-link/).
- **State kernel**: `StoryletPropertyBag` and `StoryletScopeRegistry` are the
  shared properties implementer (the owned / foreign scope split for a host
  `@world`).

## Exporting your game

Godot's export silently drops non-resource files from the `.pck`, and that
includes raw `.storyletsc` bundles: add `*.storyletsc` to your export
preset's **Resources > "Filters to export non-resource files/folders"** or
any bundle you read with `FileAccess` at runtime (the demo does this, and so
does DLC-style loading) will be missing from the exported game. Bundles you
reference only through the importer (`load("res://....storyletsc")`) ship as
their imported resources, but keeping the filter is the safe habit.

Changes per release: [CHANGELOG.md](CHANGELOG.md).
