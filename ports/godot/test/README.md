# Godot test scripts (maintainers)

Headless checks for the Godot addon. **Not part of the shipped addon zip**
(only `addons/storyletengine` ships); end-users never need these.

Import the project once first so class names register:

```sh
godot --headless --path ports/godot --import
```

- `test_corpus.gd` - replays the shared conformance corpus
  ([`packages/conformance`](../../../packages/conformance)) through the
  addon's runtime and asserts the same results the JS reference produces (the
  four runner obligations of `packages/conformance/src/runner.ts`:
  expressions, specificity, peek asked twice, scripted):

  ```sh
  godot --headless --path ports/godot --script res://test/test_corpus.gd \
      [-- /abs/path/to/corpus.json]
  ```

  Defaults to the repo's `packages/conformance/corpus.json`. Also runs the two
  corpora vendored from `../expr` beside it: `expr-corpus.json` (the
  evaluator's) and `registry-corpus.json` (the ScopeRegistry's, through the
  shared runner `registry_corpus.gd`, vendored here too; a missing file is a
  failure). Last it runs `one_registry_checks.gd`: the engine and the game's
  one registry from the game's side (the keys and owner label it registers
  under, `save_game` with and without a game registry, loading in either
  order, `storylets/save@1` envelopes and files, parking a flow, a fresh flow
  not claiming a load's values, `reset` dropping only this engine's waiting
  values, a token clash leaving the registry as it was, and another engine's
  scope read by path and by a condition), the JS runtime's
  `one-registry.test.ts` case for case, its "hotSwap on the game's registry"
  included (`hot_swap` carrying the run and its drift report, leaving other
  engines' values and waiting values alone, refusing another project, putting
  everything back when the rebuild fails, and `apply_live_bundle` on the
  game's registry). It also runs the runtime half of the JS compiler test's
  "other engines' scopes": a bundle's `externalScopes`, a card reading and
  writing `@patter` through the registry, `open_flow` and `load_game` refused
  before anything changes when nobody registered it, and an outcome's write to
  it failing once Patter has taken it away. Prints per-family counts,
  `registry corpus: N/N`, `one registry: N/N`, then `ALL PASS` (exit 0) or
  `N FAILED` (exit 1).

- `test_smoke.gd` - loads the bundled Hamlet demo, deals, plays one outcome
  and round-trips the run through the `.storyletsave` string boundary:

  ```sh
  godot --headless --path ports/godot --script res://test/test_smoke.gd
  ```

  Prints PASS/FAIL lines then `SMOKE ALL PASS` (exit 0).

- `test_live_link.gd` - replays the shared Live Link fixture
  ([`packages/conformance/live-link/`](../../../packages/conformance/live-link))
  through `StoryletLiveLink` over a fake socket: the scripted run from
  `script.json`, and every frame the link sends compared byte for byte with
  the compact form of `frames.json` (the contract every runtime's client is
  held to). Also checks a pushed bundle end to end (`bundle_pushed`,
  `apply_live_bundle`, `set_build`):

  ```sh
  godot --headless --path ports/godot --script res://test/test_live_link.gd
  ```

  Prints PASS/FAIL lines then `LIVE LINK ALL PASS` (exit 0).

- `test_editor_view.gd` - drives the EDITOR's bundle view
  (`addons/storyletengine/editor/storylet_bundle_view.gd`) headlessly. It is a
  `@tool` script that otherwise only ever runs inside the Inspector, so
  without this a change to it is parsed and never executed:

  ```sh
  godot --headless --path ports/godot --script res://test/test_editor_view.gd
  ```

  Prints PASS/FAIL lines then `EDITOR VIEW ALL PASS` (exit 0).

- `test_state_panel.gd` - drives the Runtime State panel
  (`addons/storyletengine/ui/storylet_state_panel.gd`) headlessly, including
  the walk from a registered ENGINE to its open flows: registering, the
  per-flow sections appearing and disappearing as flows open and close, and
  unregistering. One step per frame, because the panel drops old rows with
  `queue_free()` and that lands at the end of the frame:

  ```sh
  godot --headless --path ports/godot --script res://test/test_state_panel.gd
  ```

  Prints PASS/FAIL lines then `STATE PANEL ALL PASS` (exit 0).

- `test_state_logger.gd` - drives the state logger
  (`addons/storyletengine/runtime/state_logger.gd`) from the outside: take a
  snapshot, write a SHARED `@story` property, snapshot again, and require
  `diff_state` to name the change.

  It exists because nothing in this suite so much as loaded
  `StoryletStateLogger`, and two things had gone wrong there unseen. The flows
  refactor deleted six of its methods (`_copy`, `_full`, `_hook`, `_mount`,
  `capture`, `dispose`) while leaving `_init` calling two of them, so the whole
  script failed to COMPILE from that commit on; and `snapshot_state` read the
  save envelope's shared half one level too shallow, dropping every shared
  property. The API parity script could not see either, because it matches
  declarations as TEXT: `create_state_logger` was still spelled correctly in a
  file that would not load.

  ```sh
  godot --headless --path ports/godot --script res://test/test_state_logger.gd
  ```

  Prints PASS/FAIL lines then `ALL PASS` (exit 0).

The last three read the Hamlet demo's built bundle, so run
`storyletengine export` on `examples/the-hamlet.storylets` first if they
report one missing.

## With Patter: one registry, one save (`with-patter/`)

`with-patter/test_with_patter.gd` is the combined proof on Godot: a Patter
engine and a Storylet Engine in one game, on ONE scope registry, with one save
`{ registry, patter, storylets }`. It ports the JS runtime's
[`with-patter/combined-game.test.ts`](../../../packages/runtime/test/with-patter/combined-game.test.ts)
case for case, with the same content: Patter reading `@story.act`, a storylet
gated on a `@world` value a Patter scene wrote, the Storylet Engine reading
`patter.visits` by path, the save loaded registry first and engines first,
content drift in both engines with a Patter `hot_swap` on the same registry,
a card (`c_patron`) gated on `@patter.visits` that writes it, followed by a
Storylet Engine `hot_swap` on the shared registry, and token clashes naming
the holder. Every case runs twice, on a registry the
game made with Patterplay's shim (`PatterScopeRegistry`) and with this addon's
(`StoryletScopeRegistry`), and a first case proves the two addons'
`class_name`s coexist (every one either addon declares is registered, once, to
the file declaring it).

It needs both addons in one project, and Patterplay from the SOURCE of a
sibling `../patter` checkout (never a release, so never the Hamlet demo's
pinned copy). So it does not run in this project (the folder carries a
`.gdignore`); `run.sh` assembles a throwaway project in a temporary directory,
COPYING in `addons/storyletengine` from here and `addons/patterplay` from
`../patter` (copies, because importing writes `.uid` and `.import` files beside
the scripts), imports it once, and runs the suite:

```sh
bash ports/godot/test/with-patter/run.sh
```

Prints `ok`/`FAIL` per case, then `WITH PATTER ALL PASS`; `run.sh` exits 0
only on that line, since a script that fails to parse exits 0 printing no
verdict. Without a `../patter` checkout it prints `SKIP test_with_patter: ...`
and exits 0, so a plain clone runs everything else. Environment: `GODOT` (the
binary; defaults to the macOS app bundle's), `PATTER_DIR` (another Patter
checkout), `REQUIRE_PATTER=1` (a missing checkout fails instead of skipping;
CI sets it), `KEEP=1` (keep the assembled project and print its path).

The bundles are written in the test as the compilers emit them: the Storylet
Engine's expanded as the conformance package's `expandBundle` writes it (as
`one_registry_checks.gd` does), Patter's as `exportBundle` writes it, build
hashes and `externalScopes` included. To regenerate one, run the JS test's own
builder (`storyletBundle`, `patterBundle`) and paste its `JSON.stringify`.
