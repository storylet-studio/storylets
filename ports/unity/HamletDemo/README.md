# The Hamlet on Unity

One game, two engines, in a Unity project you open and read. The Storylet
Engine decides which beat happens; Patter performs its dialogue; the game owns
`@world` and hands one object to both. The JS client and the Godot demo again,
in C#, shape for shape.

```
./build.sh                 # once: Patter's package from its pinned release, both bundles
open in Unity 6000.4+      # press Play (Assets/Hamlet.unity)
dotnet run --project TestHost   # the core, played with no editor
```

Read `Assets/Hamlet/HamletGame.cs` first (the whole integration, no Unity in
it), then `HamletWorld.cs` (one dictionary behind both engines' resolver
interfaces). `HamletUI.cs` draws it. `Assets/Editor/HamletSmokeTest.cs` plays it
headless in the editor: `Unity -batchmode -nographics -quit -projectPath . -executeMethod StoryletStudio.Hamlet.Editor.HamletSmokeTest.Run`.
