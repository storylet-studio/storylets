# Storylet Engine Demo (Unity demo project)

A ready-to-open **Unity project** for the **Storylet Engine** package. Its
`Packages/manifest.json` finds the package in the **sibling `StoryletEngine/`
folder** (`"com.storylet-studio.storyletengine": "file:../../StoryletEngine"`),
so there is nothing to install and no sample to import: open the project and
press **Play**.

## Run it

1. Keep the two folders side by side (a clone of the repo already does):

   ```
   ports/unity/
     StoryletEngine/                 # the runtime package
     StoryletEngineDemo/             # this project  <- open this
   ```

2. Open `StoryletEngineDemo/` with Unity **6000.4.6f1** (Unity Hub > Add >
   pick this folder). The first open takes a minute or two while Unity
   resolves packages and builds its library; it needs to reach the Unity
   package registry once to fetch `com.unity.nuget.newtonsoft-json`, then
   never again.
3. Press **Play**. The project opens on `Assets/BoardDemo.unity`, its only
   scene and the first entry in **File > Build Profiles > Scene List**. If you
   ever land on an empty untitled scene instead (Unity reopens whatever you had
   open last), double-click `Assets/BoardDemo.unity` in the Project window.
4. Open **Window > Storylet Engine > Runtime State** beside the Game view to
   watch the run live: the flow's properties (type-aware editors, per-row reset),
   the per-box turn clocks, the board, the retained log, and **Save State... /
   Load State...** for the whole run as a `.storyletsave` file.

## The Board demo

The demo is the **Board demo**: the same one that ships for JavaScript, Unreal
and Godot, with the same on-screen content, the same control labels and the
same transcript grammar. The board arrives dealt, a click on a card shows its
outcomes, a click on an outcome plays it, and every action appends a line to
the transcript pane.

- **Deal all hands** refreshes every hand in one call and reports the dealt
  slice, one `dealt:` line per hand.
- **Next turn** winds on every box's own clock by 1. Each box counts its own
  turns, so the header shows them all.
- **Restart** drops the engine and its flow and builds them again on the same seed: the
  board empties, the clocks go back to 0, the transcript starts over.
- Outcomes gated shut still show, disabled and marked `(locked)`, because the
  gate is part of the story. Availability is re-asked every time, never
  snapshotted at deal time.

## The pieces

- **`Assets/BoardDemo.unity`** - one GameObject, *Storylet Engine Board Demo*,
  carrying `BoardDemo` with the imported bundle already assigned to its
  **Bundle** field, plus the default camera and light. There is no prefab and
  no canvas: the whole UI is immediate-mode `OnGUI`.
- **`Assets/Demo/BoardDemo.cs`** - the demo itself. The smallest part to read
  first is `Start()` plus `DealAllHands()`: load the bundle, build an engine,
  open a flow,
  deal, read `Board()`. Everything else is the UI around those few calls. It
  runs at seed 7 with the retained log on and registers its engine with
  `StoryletDebug` under the label `board demo`, which is what the Runtime State
  window lists. In the editor (and a development build) it also opens a
  `StoryletLiveLink` to Storyletter: turn the link on in the editor and press
  Play, and the editor's Board shows this run; save in the editor and the
  pushed bundle lands in `Update()` via `StoryletLiveBundle.Apply`, the run
  carried across (a `live refresh:` transcript line). Nothing listening means
  nothing happens.
- **`Assets/Demo/the-hamlet.storyletsc`** - the Hamlet example from the
  repo's `examples/`, compiled with the Storyletter CLI. The package's
  ScriptedImporter turns any `.storyletsc` into a `StoryletBundleAsset` on
  import, so dragging your own bundle into the project is all it takes.
- **`Assets/Editor/BoardDemoSmokeTest.cs`** - a headless check that this
  project still runs (opens the scene, deals, plays an outcome, confirms the
  hand refills). Nothing in the demo depends on it:

  ```sh
  /Applications/Unity/Hub/Editor/6000.4.6f1/Unity.app/Contents/MacOS/Unity \
    -batchmode -nographics -quit \
    -projectPath ports/unity/StoryletEngineDemo \
    -executeMethod StoryletStudio.StoryletEngine.Demo.Editor.BoardDemoSmokeTest.Run \
    -logFile /dev/stdout
  ```

To use Storylet Engine in **your own game**, add the package to your project
(see [its README](../StoryletEngine/README.md)), then copy `Assets/Demo/` over
as a starting point. This project is just a demo shell and is freely deletable.
