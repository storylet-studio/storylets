# Changelog

All notable changes to Storylet Engine for Godot are documented here. The
Storylet Engine runtimes (JS, Unity, Unreal, Godot) are versioned in lockstep:
the same version number always means the same runtime behaviour.

## [Unreleased]

## [0.8.0] - 2026-09-24

### Added

- **Other engines' scopes, with no setting.** A card can name another engine's game-wide scope from the family's shared list (`@patter.visits` in a condition, `@patter.gold` in an outcome's changes). The compiler lets it through unchecked and records it in the bundle (`externalScopes`, which `StoryletBundle.load_from_dict` checks and `StoryletBundle.external_scopes(bundle)` reads); an outcome writes it through the game's registry under that engine's rules. Content that names one runs only where that engine is on the same registry: without it, `open_flow` and `load_game` refuse before anything changes, checking `externalScopes` in order and refusing on the first token the registry does not have, the way they refuse anything else (`push_error`, then `open_flow` returns null and `load_game` an empty Dictionary) with the same message as every runtime: `this content names @patter, which no engine on this registry registered: give every engine the game's one registry`. `load_game` checks right after the same-project check, so a refused load leaves every flow as it was. An outcome can still meet an unregistered scope when another engine takes its scope away mid-game, and fails with `@patter.gold cannot be written: no engine on this registry registered @patter`.
- **`StoryletEngine.hot_swap(bundle, opts = {})`**, live bundle refresh as an engine method. Returns `{"ok": true, "engine", "report"}` (the replacement and its load report) or `{"ok": false, "error"}` with `push_error`. On the game's registry the old engine hands its keys over: it carries its own values into the snapshot, so the report covers property drift and a dropped property is dropped, values waiting for one of its flows wait on, and nothing belonging to another engine is touched; the old engine is spent (its flows closed). A bundle for another project is refused before anything moves, and a failed rebuild puts everything back. Standalone, it is a save and a load into a new engine, as before. The engine remembers the options it was built with, so `opts` only overrides one of them. `StoryletLiveLink.apply_live_bundle` now calls it, so a Live Link refresh works when the game owns the registry, where it used to be refused; its `opts` are now overrides too, and it still never `push_error`s a refusal.

### Changed

- **`StoryletScopeRegistry` is the shared registry, one per game** (2026-09-24). The class is now a thin shim over `runtime/expr/scope_registry.gd`, vendored from expr and shared with Patterplay, so a game that runs both engines can hand them one registry. It matches `@wildwinter/scoperegistry` 0.7.0 and runs that package's registry corpus. New: `define_owned(token, declarations, {"path_prefix", "normalise", "owner"})` (rows default to the `<token>.` prefix; the two-argument form still works), an `owner` on `mount_owned` and `define_foreign` that a clash error names and every `list_properties()` row carries, `define_foreign(..., {"writable", "normalise", "owner"})` beside the old bool form, `remove(token, {"keep": true})`, `discard_parked(prefix)`, a read-only `revision`, and `to_eval_context(host, {"aliases": {token: key}})`. A `load()` section for a key nobody has registered is now PARKED, handed to the scope when that key registers and kept in the next `save()`, where it used to be dropped; pass `{"keep_parked": true}` to keep what an earlier load parked. `list_properties()` rows now carry `path` and `stages` on foreign scopes too. **Breaking**: `define_owned`, `mount_owned`, `define_foreign`, and `reseed_owned` return an error String ("" on success) in place of the registry, so they no longer chain; and `save_fragment`, `load_fragment`, and `SAVE_FRAGMENT_VERSION` are gone, since versioning belongs to the save that embeds `save()`. The engine itself does not use the registry yet, so a game that never touched `StoryletScopeRegistry` sees no change.
- **One registry per game** (2026-09-24). Every property bag now lives in a `StoryletScopeRegistry` instead of standing alone: the shared `@story` under `story`, and every other bag that declares something under a key starting `storylets/` (`storylets/deck/<id>`, `storylets/flow/<flow>/story`, `storylets/flow/<flow>/deck/<id>`, and so on, keyed by internal id with `%` and `/` escaped). A new `"registry"` option on `StoryletEngine.create` takes the game's own registry, shared with any other engine in the game, Patterplay included; without one the engine makes its own and acts as its own game, so a single-engine game needs no change. A token another engine already holds refuses the engine: `create` returns null, the error names the holder, and the registry is left as it was. Everything the engine registers carries the owner label "Storylet Engine".
- **The save is `storylets/save@2`.** The envelope holds what is not a property (boards, clocks, cooldowns, PRNGs, play logs, spent cards). An engine created without a registry also carries that registry's values under `"registry"`, so one call is still the whole run, and the load report still walks them; an engine given the game's registry leaves them to the game, which saves `registry.save()` once and can load it before or after `load_game`. `storylets/save@1` envelopes still load, their values moving into the registry, and `StoryletSave.load_state` / `deserialize_state` accept a file holding either. `save_flow` still carries the parked flow's properties. `StoryletBundle.SAVE_SCHEMA` is now `"storylets/save@2"`, and `SAVE_SCHEMA_V1` names the old one.
- **A self-backed `@world` is saved.** When the game binds no `"world"` resolver, `@world` is a property the engine's registry stores, so a save and load keeps it where it used to fall back to its defaults. A resolver the game binds is still external and never saved. Given the game's registry, the engine self-backs nothing: `@world` is the game's to register there.
- **Every expression reads every registered scope**, and `get_property` / `set_property` on the engine and on a flow take another engine's game-wide path (`patter.gold`).
- `StoryletEngine.world_set` now returns an error String ("" on success), and the new `world_get(name)` is the read side of the same seam. `reset()` and `load_game` reseed the shared bags in place rather than building new ones, so a subscription on a bag from `list_bags()` survives them.

## [0.7.0] - 2026-09-14

### Added

- **A card with no outcomes is played with none** (2026-09-14). A masthead, a notice, a codex entry: a card whose play means "shown". `flow.play(card_id, "", hand_id)` on a card whose `outcomes` is empty does everything a play does except the writes: the play log records it with `"outcome": ""` and the history functions count it, the box's clock moves by the usual rule (nothing in a timed box, `playAdvancesTurns` otherwise, an explicit `advance_turns` still honoured), the redraw rests it (a cooldown, or never again, a shared one-shot marked taken), it leaves its hand, and the play trace event carries `"outcome": ""`. There is no gate to check and nothing is written. "" is the one spelling every runtime can express. Two refusals, both before any mutation: "" on a card that HAS outcomes returns `card "<id>" has outcomes (<o1>, <o2>); name the one played`, and a named outcome on a card with none is refused as before (`card "<id>" has no outcome "<name>"`). A save whose play record lacks `"outcome"` now loads it as "" rather than failing. The Board demo shows one "Done" button on an open card that has no outcomes, and the state panel logs such a play as `play <card>`. Parity with the JS runtime, corpus-pinned (corpus version 9).

## [0.6.0] - 2026-09-13

### Added

- **An outcome carries fields, and they reach the game with the outcome** (2026-09-13). A box declares `outcomeFields` beside the card template it already declares, and an outcome fills them the way a card fills its own: `flow.outcomes(card_id, hand_id)` hands each view's `"fields"` over exactly as the bundle wrote it, present only where the outcome has any. That is the line a venue's phone shows after a press ("The notice is in your pocket.") without spending a card on it. The engine never reads them, as it never reads a card's: they are game data, validated at publish and inert here. Parity with the JS runtime, corpus-pinned (corpus version 8).

## [0.5.0] - 2026-09-06

### Added

- **Hand positions carried in a bundle's `maps` block** (2026-09-05). A map may carry `sites`, a list of `{hand, x, y}` saying where each placed hand stands, and `describe_bundle` counts it beside the zones and the pictures (design/engine-server.md 4.3). The parsed Dictionary IS the bundle here, so a host reads the positions straight off it. Still INERT PAYLOAD: nothing in the engine reads any of it. The bundle view counts it on the map's line. No corpus change: a position is not a behaviour.

- **`durable` carried on declarations, decks and cards** (2026-09-05). The durability axis (design/engine-server.md 4.2): `durable` says whether a value, or a `redraw: "never"` spend, survives the end of a RUN, where `shared` says whose it is within one. INERT in the engine, which partitions by `shared` alone and never reads the flag; a server lifts and restores durable values across a run boundary through `get_property` / `set_property`, and durable spends through `open_flow(id, {"restore": blob})` and `mark_taken`. The bundle carries it through, `describe_bundle` marks a durable declaration with `"durable": true` and counts a box's durable cards as `"durableCards"`, and the addon's bundle view shows "(durable)" on the property row and "durable cards N" on the box's counts line. No corpus change: nothing about play is different.

- **A box that counts in time: `turn: { seconds: N }`** (2026-09-05). A box may declare that its turns are TIME rather than plays. In such a box `play` advances the clock by 0 by default instead of `settings.playAdvancesTurns`; a call passing `advance_turns` still gets what it asked for, and `advance_turns` is unchanged, because the host is what ticks a timed box. `redraw: N` on its cards then reads as N x `seconds`, which the tools say and the engine does not act on. `describe_bundle` reports it as `turn: {"seconds"}` on the box summary, and the addon's bundle view shows `turn = 60s` on the box's counts line. Parity with the JS runtime, corpus-pinned (corpus version 5).

- **A hole filled from a property: the hand that moves** (2026-09-05). A hand's `chosen` value (or a standalone hand's rule binding) may be a property reference (`"@hand.zone"`, `"@story.where"`, `"@world.place"`) rather than a tag id; the engine resolves it at ask time and binds the hole to the tag it names, so moving a hand is `set_property` and the next deal follows. Parity with the JS runtime, corpus-pinned. A value naming no tag leaves the hole unbound (a wildcard) with a diagnostic, never a silently empty hand. `StoryletBundleInspector.describe_bundle` reports the holes as a hand row's `"movable"`, and the bundle view shows them on the hand's own line.

- **`engine.save_flow(id)` and `engine.open_flow(id, {"restore": blob})`: park one flow, and open it as it was** (2026-09-05). Parity with the JS runtime's `saveFlow` / `openFlow(restore)`, corpus-pinned. Closing a parked flow releases its shared claims; on the way back, a shared card the world has since given out is dropped as `claimed-elsewhere` rather than double-claimed. `{"on_restore_report": Callable}` hands out what the restore did.

- **`engine.preview_load(envelope)` and `engine.preview_flow_restore(id, blob)`.** What a save load would drop, default or reset, and whether its build is this one - answered before the load. Both change nothing.

### Changed

- **A tag two boxes both name is addressed by its box: `value.<boxGameId>/<tagGameId>.<name>`** (2026-09-06; design/engine-server.md 4.4). The one hole the change above left. Box, deck, hand and card gameIds are unique across a bundle, so their owner segment names exactly one thing; a TAG's is unique only within its group, and a group's only within its box, so a harbour box and a cellar box may each have a `docks`, and `value.docks.danger` then named two stores. It resolved to the first in bundle order, silently, which is the bug this removes. The qualified form carries the box, with the slash INSIDE the owner segment so an address still splits into three on the dot, and it is accepted whether or not it is needed. The short form resolves while exactly one tag in the bundle carries that gameId and is REFUSED when more do, through the channel an unknown owner segment already uses, naming every candidate: `"value.docks.danger" names a tag in 2 boxes; write "value.harbour/docks.danger" or "value.cellar/docks.danger"`. What the engine PRINTS - `list_properties()`, a `write` event's `path`, `list_bags`'s mount prefixes, `StoryletStateLogger`'s snapshot, a load report's paths and the Runtime State panel - is qualified ONLY for a repeated gameId, so a project whose tag names happen to be unique sees no change at all. The value scope's internal-id form is therefore on the same timetable as the other three now rather than exempt from it, refused after the next lockstep release, and its diagnostic names the qualified address wherever that is the one that works. The addon's own surfaces follow it: nothing in the state panel or the bundle view builds an address of its own. Parity with the JS runtime, corpus-pinned (corpus version 7).

- **Identity by gameId: trace events and property addresses** (2026-09-06). One vocabulary, in two places that used to have two (design/engine-server.md 4.4). On the TRACE, `evict.hand`, `evict.card`, `play.card` and every `cards[].id` on a `deal` or a `peek` are gameIds now, joining `deal.hand`, `peek.box`, `play.outcome` and `turns.box`, which always were: a refresh used to report the hand it filled by name and the cards it dropped by internal id in the same breath, so the state panel, the Live Link and every host handler kept a translation table of its own. A card the build no longer has is the one exception, named by the id the board carried, because there is no gameId left to give it. On an ADDRESS, the owner segment is its gameId too: `list_properties()` prints `box.village.heat`, `deck.wares.n`, `hand.the-elder.zone` and `value.docks.danger`, and `get_property` and `set_property` (on the engine and on a flow), the `write` event's `path` including a routed `@hand` write, `list_bags`'s mount prefixes, `StoryletStateLogger`'s snapshot and a load report's `droppedProperties` / `defaultedProperties` / `retypedProperties` all speak that form. **The internal-id form is still accepted on input for this release**, resolving as before and raising a `diagnostic` whose `where` is "property address" and which names the address to move to, so a host can find its old ones by running once with the trace on; it is REFUSED AFTER THE NEXT LOCKSTEP RELEASE. Saves are untouched: the bags, the envelope and the ladders stay keyed by internal id, because a save has to survive a rename, which is the whole reason ids exist. One scope needed a second pass: a tag's gameId is unique only within its group, and a group's only within its box, so two boxes may each name a tag "docks", and `value.docks` named the first in bundle order. The entry below settles that and puts the value scope back on the same timetable as the other three. Parity with the JS runtime, corpus-pinned (corpus version 6), with two new assertions in the corpus runner: `expectTrace` on a deal or a play, and `expectDiagnostic` on a `setState`.

- **Read-only `@world` properties honour the game's own writes** (2026-09-05). `writable: false` on a `@world` declaration is the STORY's promise not to write that value, so it binds an outcome and nobody else: `set_property` on the engine and on a flow passes the kernel's `{"host": true}` (in every scope, not just `@world`) and is never refused, while an outcome is still refused against the engine's read-only table before the write reaches a bag or a bound resolver. `StoryletScopeRegistry.set_value` takes the same option, `StoryletEngine.world_set` / `world_can_set` are the seam the flows write through, and the engine's own `list_properties` now carries `writable` on its `world.*` rows, which only the flow's rows had. Parity with the JS runtime.

- **BREAKING: `load_game` returns the load report Dictionary, not an error String.** It answers with the same report `preview_load` gives, and refuses a save for another project the way the rest of the addon refuses things: `{}` and a `push_error`. `StoryletSave.load_state` and `StoryletLiveLink.apply_live_bundle` still report a foreign project by message, asked for by name before the load.

- **A load now prunes what it reports**: a property the build no longer declares, a cooldown or spent entry for a deleted card, and a saved value that no longer fits its declaration (a struck-out enum value, an edited quality ladder) are dropped rather than carried, and named in the report.

## [0.4.1] - 2026-09-04

### Fixed

- **The Board demo would not parse, so a project carrying this addon failed to open.** `board_demo.gd` held a statement at column 0 inside `_on_bundle_pushed`, which GDScript reads as an identifier in the class body: `Unexpected identifier "StoryletDebug" in class body`. Godot parses every script in a project when it opens, so this broke the whole project for anyone who dropped the addon in, and it has shipped that way since 2026-08-29. The headless suites run named scripts and never touched the demo, so nothing caught it; CI now parses every script in the addon.
- The same botched edit had added `StoryletDebug.unregister_link(_link)` to the live-refresh path, where it would have dropped the Live Link from the state panel for good: the link object survives a refresh and nothing re-registers it. Removed; the old engine is still unregistered, as it was before.


## [0.4.0] - 2026-09-04

### Added

- **Read-only `@world` refused at runtime**: an outcome writing a `writable: false` property is refused with `'@world.x' is read-only`. Parity with the JS runtime and with Patterplay, corpus-pinned.

- **`on_replaced_flow`** create option, a `Callable(id: String, dealt: int)`:
  fired when `open_flow` replaces a flow that still held dealt cards. Parity with
  the JS runtime's `onReplacedFlow`, added the same day, and for the same reason:
  a host calling `open_flow` instead of `get_flow` after `load_game` silently
  discards the restored hand. Zero cost when unset.

## [0.3.0] - 2026-09-02

### Changed
- **A property bag composes its rows' addresses.** Each bag is built knowing the path it answers
  to (`story.`, `box.<id>.`, `deck.<id>.`, `hand.<id>.`, `value.<id>.`, `world.`), so a row
  arrives addressed instead of having a prefix pasted onto it by each caller. **The addresses are
  unchanged** - this is where they are composed, not what they are.

### Fixed

- **A quality row carries its ladder.** `stages` was on the examiner row so an editor could
  offer the stages instead of a free-text box, and the shared code that builds rows never filled
  it in - on this runtime and two others. Every quality row came out without one.

## [0.2.0] - 2026-09-01

### Removed

- **BREAKING: the `StoryletAst` class is gone.** The evaluator now walks the
  tagged-tuple form a bundle already carries, so there is no deserialisation step
  and nothing to expose. It was an internal detail and is not referenced anywhere
  in the addon; if you called `StoryletAst.deserialise`, the compiled `ast` array
  is now what the evaluator takes directly.

### Changed

- **BREAKING: a bare non-boolean condition now passes when it is non-empty.** A
  condition that resolves to a string or a flag list previously always FAILED;
  it now passes when the string is non-empty or the list has members, which is
  what Patterplay has always done and what JavaScript coerces.

  This is a behaviour change to existing content: a card gated on a bare
  `@story.title` was unreachable and now is not. Booleans and numbers are
  unaffected.

  The two engines share a property registry, so the same value read from the
  same registry answered a condition differently depending on which engine
  asked. That was drift from writing them at different times rather than a
  decision, and this is the side that was wrong.

- **Flags compare as a SET.** `==` and `!=` on a flags value now ignore order.
  They are compared as multisets, so a duplicated flag still counts. The stored
  order was an artefact of the order somebody happened to add things in, and
  `set_flags` sorting its result only held while every producer sorted, which a
  declared default or a host-supplied list does not. `set_flags` still sorts, now
  purely so a save is byte-reproducible.

### Fixed

- **Numbers render the way JavaScript's `String(n)` renders them.** This is
  described as the cross-runtime number-rendering contract and it did not hold.
  `js_number` used a 1e15 cutoff and `String.num`'s 14-decimal default, so
  `0.1 + 0.2` showed as `0.3`, `1e16` as `10000000000000000.0` with a trailing
  `.0`, and `1/3` lost two digits.
- **The PRNG seed is coerced the way JavaScript coerces it** (ECMA-262 ToUint32).
  `StoryletMulberry32` took an `int`, so seeds outside 64-bit integer range
  (`1e19`, `Infinity`) both answered `4294967295` rather than `2313682944` and
  `0`. The other three runtimes were already correct, which is why nothing
  noticed.

### Changed

- The evaluator, the specificity scorer, the value helpers, the PRNG and both
  bundle plugins moved to `runtime/expr/`, generated from a single shared source
  also used by Patterplay. `StoryletExpression`, `StoryletValues`,
  `StoryletMulberry32` and `StoryletSpecificity` are unchanged as names and
  members; they are now thin wrappers over that source.


## [0.1.0] - 2026-08-30

### Added
- Shared scarcity (design/shared-scarcity.md): `shared` on a deck (or a card,
  overriding its deck) plus `sharedCopies`, so a pile is scarce across flows
  rather than one each per participant. Claims count every live flow's board;
  a shared `redraw: "never"` is spent for everyone on the first play; a finite
  `redraw` stays personal, because a cooldown is an absolute turn of a per-flow
  clock. Two new trace verdicts, `claimed-elsewhere` and `taken`.
- `engine.log()` / `clear_log()`: the RUN's log, every flow's events in one
  order with each entry naming its `flow`. The state panel draws it under the
  engine's name, above the per-flow sections.
- The save's shared half is now `{props, spent}`, carrying what a shared
  one-shot took out of the world.
- Flows (design/flows.md): `StoryletEngine` owns the bundle, the shared state
  and `@world`; a `StoryletFlow` is one playthrough across it, and every play
  verb lives there. `open_flow` / `get_flow` / `flows` / `close_flow` /
  `reset` manage them, re-opening a name replaces that flow, and a closed
  handle is inert. Named after Patter's engine / flow so a project running
  both engines reads the same. `StoryletDebug` keys on the ENGINE
  (`register(engine, "label")`): the Runtime State panel asks each engine for
  its open flows, so a flow opened or closed later appears and disappears
  without a registry call. Covered headlessly by `test/test_state_panel.gd`.
  This REPLACES the `session` of the entries below, which was engine and
  single flow in one object: everything they say about a "session" is now
  split between the two, with the play verbs on the flow and the bundle,
  shared state and save on the engine.
- The pure GDScript runtime: bundle loading (`.storyletsc`), sessions
  (deal / peek / play / outcomes / board / per-box turns / cooldowns /
  claims and copies / templates and the composed `@hand`), the storylets
  expression dialect, matched-constraint specificity ranking, the mulberry32
  per-flow PRNG, and the save envelope with the `.storyletsave`
  string boundary (`StoryletSave`).
- The shared state kernel pieces: `StoryletPropertyBag` (typed declared
  properties, the firing rule, audit hook, one clone door) and
  `StoryletScopeRegistry` (owned / foreign scopes, save fragments).
- The `.storyletsc` EditorImportPlugin and `StoryletBundleResource` (raw JSON
  held verbatim, lazily parsed; a broken bundle still imports with its error
  readable on the asset).
- `StoryletStatePanel`, the in-game property examiner / editor with per-box
  turns, board contents and Save/Load state, plus the `StoryletDebug`
  session registry it reads.
- The Hamlet demo scene and the headless corpus / smoke TestHosts
  (maintainers; not shipped).
- Live Link went to protocol **v2** (design/live-link.md): a client now
  attaches to the **ENGINE**, not to one flow. `hello` carries `flows`, new
  `flowOpen` / `flowClose` frames announce participants joining and leaving,
  and every `trace` and `board` frame names its `flow`. The client discovers
  flows itself by diffing the engine's list before each forwarded event, so a
  multi-participant run needs nothing extra from the host. The editor's Board
  follows one flow at a time and remembers the last board per flow. Held to
  the shared fixture in `packages/conformance/live-link/`, which now scripts a
  second participant opening, playing and closing.
- Live Link: `StoryletLiveLink` streams the attached engine's trace and
  board snapshots to Storyletter (`storyletengine/debug@1`) and takes edited
  bundles back into the running game (`bundle_pushed` then
  `StoryletLiveLink.apply_live_bundle`, the run carried across). Debug
  builds only. Trace events now fire after the state they report has landed,
  so a handler reading the session inside one sees the effect.
