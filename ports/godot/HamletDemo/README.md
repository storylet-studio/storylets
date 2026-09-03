# The Hamlet on Godot

One game, two engines, in a Godot project you open and read. The Storylet
Engine decides which beat happens; Patter performs its dialogue; the game owns
`@world` and hands one resolver to both. It is the JS client
(`packages/hamlet-client`) again, in GDScript, shape for shape.

```
./build.sh          # once: our addon from ../addons, Patter's from its pinned release, both bundles
open project.godot  # Godot 4.7+, press Play
```

Read `hamlet_game.gd` first: it is the whole integration and has no UI in it.
`hamlet_ui.gd` draws it. `test/test_hamlet.gd` plays it headless, including a
save taken mid-conversation and a save the JS client wrote, loaded here.

The two addons are generated, not committed (`build.sh`, `.gitignore`), so this
folder never carries a stale copy of either.
