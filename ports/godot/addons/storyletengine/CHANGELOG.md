# Changelog

All notable changes to Storylet Engine for Godot are documented here. The
Storylet Engine runtimes (JS, Unity, Unreal, Godot) are versioned in lockstep:
the same version number always means the same runtime behaviour.

## [Unreleased]

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
