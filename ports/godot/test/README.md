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

  Defaults to the repo's `packages/conformance/corpus.json`. Prints
  per-family counts then `ALL PASS` (exit 0) or `N FAILED` (exit 1).

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
