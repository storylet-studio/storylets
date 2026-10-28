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
    values.gd mulberry32.gd expression.gd dialect.gd specificity.gd
    property_bag.gd scope_registry.gd bundle.gd describe_bundle.gd
    engine.gd flow.gd save.gd state_logger.gd
    expr/                    # the expression kernel, shared with Patterplay
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

Errors: GDScript has no exceptions, so a refusal is `push_error`'d and handed
to the game too. A setter, a call with nothing else to return (`play`,
`discard`, `advance_turns`, `set_property`), returns the refusal: the
message, `""` on success. A call that already returns something (`deal`,
`deal_many`, `peek`, `outcomes`, `board`, `open_flow`, `load_game`,
`preview_load`, ...) returns its empty shape and keeps the message for
`last_error()`, on the engine for engine calls and on the flow for flow calls;
`StoryletSave`'s load calls report on the engine they load into. Every such
call sets `last_error()` when it refuses and clears it to `""` when it
succeeds:

```gdscript
var hand := flow.deal("market")
if flow.last_error() != "":
    print("not dealt: ", flow.last_error())
```

An option `create` doesn't take is reported to your `"on_error"` (`kind` `"setup"`) and ignored; an unknown option
key anywhere else is an error. Neither is silently ignored. Eval errors inside deals and peeks behave exactly like the
reference runtime: the card or deck is unavailable and the trace carries a
diagnostic; never a silent pass, never a crash.

## Beyond the basics

- **Your game's scopes**: a project can declare its own scopes beside `@world` (`@player`, say), each with
  declarations or none (an opaque scope takes any name). Bind any of them to your game's own state with
  `"host_scopes"`, a resolver per token, as Patterplay takes it:

  ```gdscript
  var world := {"time_of_day": "day"}
  var engine := StoryletEngine.create(bundle, {"host_scopes": {"world": {
      "get": func(n: String): return world.get(n),
      "set": func(n: String, v) -> void: world[n] = v,
  }}})
  ```

  A scope you bind is your game's state and never saved; leave out `"set"` and the story can't write it. A scope you
  don't bind is backed by the engine from its declared defaults, saved with the run and reset by `reset()`. Tokens
  are case-sensitive: binding one the bundle doesn't declare is reported to `"on_error"` as `"setup"`, naming the
  declared spelling when only the case differs.
- **Flows**: the engine owns the bundle, the shared state and the host scopes; each
  flow is one playthrough across it. `open_flow` / `get_flow` / `flows` /
  `close_flow` manage them, re-opening a name replaces that flow, and what a
  flow keeps to itself is settled per property when the story is authored.
  A single-player game opens one flow and forgets about it.
- **Shared scarcity**: a deck (or a single card) marked `shared` is scarce
  across flows too, not just the state it reads: one goblin in the world, held
  by whoever was dealt it first, and a shared `redraw: "never"` is spent for
  everyone the moment anyone plays it. `sharedCopies` is the world cap and
  defaults to the card's Across hands limit (one hand, or any).
- **Discard**: `flow.discard(card_id, hand_id)` takes a card out of a hand
  unplayed. Its Redraw starts from the current turn, so the next deal doesn't
  hand it straight back; it returns `""` or the refusal, as `play` does.
- **Save / load**: `engine.save_game()` / `engine.load_game(envelope)`
  snapshot and restore the whole run, every open flow included. The envelope
  is `storylets/save@3`, naming cards, hands and boxes by Game ID;
  `storylets/save@2` and `storylets/save@1` envelopes and files still load.
  `StoryletSave.serialize_state` / `deserialize_state` are the
  `.storyletsave` string boundary: a foreign, malformed or wrong-project blob
  is refused instead of corrupting a run.
- **One registry per game**: every property value lives in a
  `StoryletScopeRegistry`. Pass the game's own as
  `StoryletEngine.create(bundle, {"registry": registry})` to share it with
  any other engine (Patterplay, say): the engine registers `@story` under
  `story` and every other bag under a key starting `storylets/`, the host
  scopes (`@world` and the rest) are the game's to register, and `save_game()`
  leaves the values to the game, which saves `registry.save()` once and loads
  it with `registry.load()`, before or after `load_game`. Without one the
  engine makes its own registry, self-backs every host scope from its declared
  defaults, and `save_game()` carries every value, those included, so one call
  is still the whole run. A resolver you bind through `"host_scopes"` is your
  game's state and never saved. A token
  another engine already holds refuses the engine: `create` returns null and
  the error names the holder. See
  [Running it with Patter](https://storylets.dev/play/with-patter/#one-registry).
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
  evict / play / write / turns / diagnostic events, naming every card, hand,
  box and outcome by its gameId; create the ENGINE with
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
  See [Live Link](https://storylets.dev/play/live-link/).
- **State kernel**: `StoryletPropertyBag` and `StoryletScopeRegistry` are the
  shared properties implementer (the owned / foreign scope split for a host
  scope such as `@world`). Both are thin shims over sources shared with Patterplay
  (`runtime/expr/`), so a game running both engines can hand them one
  registry: either addon's registry class will do. A refused registry call
  returns its error String ("" on success).

## Exporting your game

With the plugin enabled there's nothing to configure: the addon's export hook
puts each raw `.storyletsc` into the exported build at its original path, so
`FileAccess.get_file_as_string("res://story.storyletsc")` reads the same bytes
in the editor and in the export, on every platform.

With the plugin disabled, Godot treats a `.storyletsc` as a non-resource file
and leaves it out of the export: add `*.storyletsc` to your export preset's
**Resources > "Filters to export non-resource files/folders"**.

Changes per release: [CHANGELOG.md](CHANGELOG.md).
