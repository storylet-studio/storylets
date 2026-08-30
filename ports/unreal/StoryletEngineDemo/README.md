# Storylet Engine Demo (Unreal sample project)

A ready-to-open **Unreal sample project** for the **Storylet Engine** plugin. Its
`.uproject` finds the plugin in the **sibling `StoryletEngine/` folder** (via Unreal's
`AdditionalPluginDirectories`), so the release zip works exactly as unpacked - nothing
to copy into another project first.

## Run it

1. Unzip the release; keep the two folders side by side:

   ```
   StoryletEngine/                     # the runtime plugin
   StoryletEngineDemo/                 # this sample project
     StoryletEngineDemo.uproject      # <- open this
   ```

2. Open `StoryletEngineDemo.uproject` (Unreal Engine 5.7 and a C++ toolchain -
   everything ships source-only; confirm the build prompt on first open). The very
   first open takes a few minutes while Unreal compiles the code and warms its shader
   caches - a one-time cost, not a hang.
3. Press **Play**. The project's game mode puts the **Board demo** on screen: it loads
   `Demos/the-hamlet.storyletsc` straight from disk (nothing to import or place),
   deals every hand, and gives you a board you can play with the mouse.

While it runs, **Window > Storylet Engine Runtime State** shows the run live: the flow's
properties (with type-aware editors, per-row reset and a search filter), per-box turns,
the board, and **Save State... / Load State...** for the whole run as a
`.storyletsave` file.

## The Board demo

The demo is the **Board demo**: the same one that ships for
Godot, Unity and JavaScript, with the same on-screen content, the same control labels
and the same transcript grammar. It is click-driven: the board arrives as buttons, a
click on a card shows its outcomes, a click on an outcome plays it, and every action
appends a line to the transcript pane (the Output Log mirrors it line for line).

`StoryletBoardDemoGameMode` is the project's default game mode, so pressing **Play** is
all it takes. From a command line you can name it explicitly in the map URL:
`?game=/Script/StoryletEngineDemo.StoryletBoardDemoGameMode`.

**Window > Storylet Engine Runtime State** sits beside it;
the Board demo registers its engine under the label `board demo`, and runs with the
retained log on, so the examiner's log panel fills as you play.

Outside Shipping the demo also opens a **Live Link** to Storyletter. Turn the link on in the
editor (the connect icon, bottom right) with the Hamlet project open, press Play here, and
the editor's Board mirrors this one; save an edit in the editor and the demo applies the
pushed bundle in place (a `live link: applied build ...` transcript line) with the run
carried across. Nothing listening is a silent no-op. The wiring is `AttachLiveLink()` in
`UStoryletBoardDemoWidget`, the shape to copy into your own game.

## The pieces

- **The Board demo** - `UStoryletBoardDemoWidget` (the whole screen, built in C++ with
  no `.uasset` and no Blueprint), put on screen by `AStoryletBoardDemoHUD` and selected
  by `AStoryletBoardDemoGameMode`. It plays the Hamlet bundle on seed 7 and calls the
  API you would call yourself: `DealAllHands`, `Board`, `Outcomes`, `Play`,
  `AdvanceTurns`, `ListBoxes`. The smallest part to read first is
  `CreateBoardSession()` plus `OnDealAllHandsClicked()`; the rest is the UI around
  them. A headless run can drive it without a mouse with the
  `storylet.BoardDemo.Drive` console command, which calls the very handlers the
  buttons are wired to.
- **`Demos/the-hamlet.storyletsc`** - the Hamlet example from the repo's
  `examples/`, exported with the Storyletter CLI
  (`npx tsx packages/cli/src/cli.ts export examples/the-hamlet.storylets -o ...`).
- To import a bundle as an asset instead, drag any `.storyletsc` into the Content
  Browser; the plugin's factory builds a `UStoryletBundle` (a broken bundle still
  imports, with the error readable on the asset).

To use Storylet Engine in **your own game**, copy the `StoryletEngine/` folder into
your project's `Plugins/` directory (see [its README](../StoryletEngine/README.md));
this sample project is just a demo shell and is freely deletable.
