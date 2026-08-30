# Storylet Engine for Godot

The native **pure-GDScript port** of the Storylet Engine runtime, packaged as
a Godot addon.

```
ports/godot/
  project.godot            # minimal host project for headless runs (never shipped)
  addons/storyletengine/   # the addon - what ships (see its README + CHANGELOG)
  test/                    # maintainers: corpus runner + smoke check (never shipped)
```

- **Using the addon**: read
  [`addons/storyletengine/README.md`](addons/storyletengine/README.md)
  (it ships inside the addon).
- **Maintainers**: parity against the shared conformance corpus runs headless
  via the scripts in [`test/`](test/README.md). Import the project once
  first:

  ```sh
  godot --headless --path ports/godot --import
  godot --headless --path ports/godot --script res://test/test_corpus.gd
  godot --headless --path ports/godot --script res://test/test_smoke.gd
  godot --headless --path ports/godot --script res://test/test_editor_view.gd
  godot --headless --path ports/godot --script res://test/test_state_panel.gd
  godot --headless --path ports/godot --script res://test/test_live_link.gd
  ```

  On this machine Godot is not on `$PATH`: it is
  `/Applications/Godot.app/Contents/MacOS/Godot`.

  The third and fourth in that list drive UI headlessly: the EDITOR's bundle view (a
  `@tool` script that otherwise only ever runs inside the Inspector) and the
  Runtime State panel, including the walk from a registered ENGINE to its open
  flows. Without them a change to either is parsed and never executed. Both
  read the Hamlet demo's built bundle, so run `storyletengine export` on
  `examples/the-hamlet.storylets` first if they report one missing.

  The fifth replays the shared Live Link fixture
  (`packages/conformance/live-link/`) through `StoryletLiveLink` over a fake
  socket and holds every frame it sends to the reference's, byte for byte.

  A sixth, `test/test_state_logger.gd`, drives the state logger from the
  outside: snapshot, write a shared `@story` property, snapshot again, and
  require `diff_state` to name the change. Nothing else in the suite loaded
  `StoryletStateLogger`, and two bugs had been living there unseen.

- **Releases**: the `engine-godot-v*` tag pipeline lands with the public-repo
  migration (design/engine-runtimes.md phase 5); until then the gates run
  locally.
