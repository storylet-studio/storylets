# The Hamlet on Unreal

One game, two engines, in an Unreal project you open and read. The Storylet
Engine decides which beat happens; Patter performs its dialogue; the game owns
`@world` and hands one object to both. The JS client and the Godot and Unity
demos again, in C++, shape for shape.

```
./build.sh                      # once: Patter's plugin (sibling ../Patterplay) from its pinned release, both bundles
open HamletDemo.uproject        # Unreal 5.7+, let it build, press Play
```

Read `Source/HamletDemo/Public/HamletGame.h` and `Private/HamletGame.cpp` first:
the whole integration, each half through its plugin's wrapper: `UStoryletBundle`
then `UStoryletEngine::Create(Bundle, Seed, false, World)`, and `UPatterBundle`
then `UPatterEngine::Create(Bundle, World)`. Two Create calls, one world. Each
plugin takes only its own container type (`UStoryletWorld`, `UPatterWorld`), so
`HamletWorldSync.cpp` keeps the two equal: a change in either is copied across as
a host write when the value differs. A game's read-only policy would be set on
both (`SetReadOnly`); the Hamlet sets none, since both projects let time move.
`HamletWidget.cpp` draws it, built in code like the Board demo.
`Private/Tests/HamletTest.cpp` plays it headless:

```
UnrealEditor-Cmd HamletDemo.uproject -ExecCmds="Automation RunTests StoryletStudio.Hamlet; Quit" -unattended -nullrhi -nosplash
```
