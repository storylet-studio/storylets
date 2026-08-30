---
title: Live Link
description: "A localhost link between Storyletter and your running game: saves push the new bundle straight into the run (live refresh), and the game streams its deals and plays back so the Board shows the game's run (live debug)."
sidebar:
  label: Live Link
---

One small localhost link between Storyletter and your running game buys you two things:

- **Live refresh**: save in the editor and the running game **picks up the edit without
  restarting**. Change a card's condition, save, and the next deal in the game sees it. The run
  carries across: same turns, same hands, same state.
- **Live debug**: the game streams what it deals and plays back to the editor, and the
  **Board shows the game's run instead of its own**: the hands as the game has them, the
  journal of what the game did, and "Not listed · why" for the game's own deals.

The debug half is **observe-only**: the game stays in control and the editor is a passive
mirror. The link is a **loopback-only** WebSocket (`127.0.0.1`): only processes on your own
machine can reach it; nothing leaves your machine.

> **Every engine ships a client** (JavaScript, Unity, Unreal, Godot), all speaking the same
> `storyletengine/debug@1` protocol below. Each is a **debug-only tool**: it is inert in a
> shipping build and safe to leave wired in (see the per-engine notes).

## Turn it on in Storyletter

The link is controlled by a small **connect icon** in the **bottom-right corner** of the editor
(and by **Play ▸ Live Link** in the menu, which is ticked while the link is on).

1. Click the **connect icon** (or tick **Play ▸ Live Link**). It turns **amber** (*listening*)
   and the address (`ws://127.0.0.1:4472`) appears beside it.
2. Run your game with its link client pointed at that address (below). When it connects the
   icon turns **green**, and if the Board is open it switches to the game's run.
3. Click the icon again (or untick the menu item) to stop.

The icon's **colour** is the state at a glance, and hovering it spells the status out:

- **Grey**: off.
- **Amber**: listening, waiting for a game.
- **Green**: connected and **in sync** (the game is running this exact build).
- **Red**: connected, but a **different build**. You've saved or edited since the game launched.
  A game wired for [live refresh](#live-refresh) re-syncs itself: saving pushes the new bundle
  into it and the icon goes green again. Otherwise rebuild and relaunch to re-sync.

If you run Patterpad on the same machine, the two don't collide: Patterpad listens on 4471,
Storyletter on 4472.

## Live refresh

With the link connected, Storyletter doesn't just *watch* your game: **saving in the editor
pushes the freshly compiled bundle into the running game**, which picks it up without
restarting. Change a card's condition, hit save, and the next deal in the game sees it. For a
designer, this closes the loop: play your actual game, feel a card land wrong, fix it, and see
the fix on the next deal, no rebuild, no restart, no losing your place.

The run carries across the swap the same way a save does. Turns, properties, cooldowns and
the hands on the table all survive. A new property takes its default. A card you deleted
leaves the table. A card whose When you changed stays on the table until its hand is next
dealt, and is dropped then if it no longer passes.

**JavaScript** wiring, via `applyLiveBundle` (a one-time developer task; designers just save):

```js
import { createLiveLink, applyLiveBundle } from "@storylet-studio/play-helpers";

let engine = new Engine(BUNDLE, { seed: 7, log: true });
let flow = engine.openFlow("main");

const link = createLiveLink({
  build: BUNDLE.content.hash,
  onBundle: ({ build, data }) => {
    const r = applyLiveBundle(engine, data, { log: true }); // a new engine carrying the run
    if (!r.ok) return console.warn(r.error);               // another project, bad JSON: keep yours
    engine = r.engine;                                      // re-bind: the load rebuilt every flow,
    flow = engine.getFlow("main");                          // so re-take your handles too
    link.attach(engine);
    link.setBuild(build);                                   // the editor's icon goes back to green
  },
});
link.attach(engine);
```

`applyLiveBundle` never throws: a bundle it can't apply comes back as `{ ok: false, error }`
and your engine is untouched. The seed you pass only matters for fresh flows; the swap
resumes the random sequence exactly where the old flow was, so later draws match.

Honest limits: your game's own side effects don't rewind (things already spawned stay
spawned); a card already on the table stays there if it still exists and is evicted if it
doesn't; and an edit that changes how many random draws happen before now changes later
draws.

## Live debug: the Board shows the game

With a game connected and the Board open, the Board enters **Live** mode: it renders the hands
as the game has them, its journal fills with what the game deals and plays, "Not listed ·
why" answers for the game's own deals, and **Follow in the editor** opens each card as the game
deals it. The Board's own controls (deal, Next turn, play, the raw state) are off, because the
game is in control. Seed, Save state, Restore and Restart hide. When the link drops, or you
click **Local**, the Board goes back to its own session.

## Wire the client

Every engine's client has the same shape: open it with the build id, attach the **engine**,
and leave it. It forwards every trace event any flow emits, each frame naming the flow it came
from, and a board snapshot after each deal, play, eviction and turn. It never throws into your
game, and if Storyletter isn't listening every call is a no-op.

**You attach the engine, not a flow, and you never announce a flow yourself.** The client
diffs the engine's open flows before each event it forwards and sends `flowOpen` / `flowClose`
on its own, so there is nothing to remember and the editor's list cannot drift from the truth.
The one thing to know: a flow that opens and then does nothing at all is not announced until
the next event anywhere in the run.

**JavaScript**: `@storylet-studio/play-helpers` ships `createLiveLink`:

```js
import { createLiveLink } from "@storylet-studio/play-helpers";

const link = createLiveLink({
  build: BUNDLE.content.hash,       // the build identity, from your compiled bundle
  project: "My Game",               // shown in the editor's connect-icon tooltip (optional)
  // url: "ws://127.0.0.1:4472",    // the default; override if you changed the port
});

link.attach(engine);               // forward every flow's trace; a board each goes first
// ...play as normal; every deal, play and turn reaches the editor as it happens.
link.detach();                     // stop forwarding (a refresh replaces the engine: attach the new one)
link.close();                       // done
```

That's the whole integration. Leave it wired behind your engine's debug flag and it costs
nothing in a shipped game.

**Unity**: `StoryletLiveLink`, in the runtime package. Wire it behind
`#if UNITY_EDITOR || DEVELOPMENT_BUILD` so a release build strips it; the socket runs on a
worker thread, so you drain pushed bundles from your `Update()` and the swap happens on the
main thread:

```csharp
#if UNITY_EDITOR || DEVELOPMENT_BUILD
private StoryletLiveLink _link;
#endif

void Start()
{
    _engine = new Engine(Bundle.Bundle, new EngineOptions { Seed = 7, Log = true });
    _flow = _engine.OpenFlow("main");
#if UNITY_EDITOR || DEVELOPMENT_BUILD
    _link = new StoryletLiveLink(Bundle.Bundle.Content.Hash, "My Game");   // the build id, the tooltip name
    _link.Attach(_engine);                  // forward every flow's trace; a board each goes first
    StoryletDebug.RegisterLink(_link);      // optional: the Runtime State window shows the link state
#endif
}

#if UNITY_EDITOR || DEVELOPMENT_BUILD
void Update()
{
    // Live refresh: the editor pushed a bundle. Apply = a new engine over it, carrying the run.
    if (_link.TryReceive(out var raw) && StoryletLiveBundle.TryParsePush(raw, out var build, out var data))
    {
        var r = StoryletLiveBundle.Apply(_engine, data, new EngineOptions { Seed = 7, Log = true });
        if (!r.Ok) { Debug.LogWarning(r.Error); return; }   // another project, bad JSON: keep yours
        _engine = r.Engine;                                  // re-bind your handles and anything over them
        _flow = _engine.GetFlow("main") ?? _engine.OpenFlow("main");
        _link.Attach(_engine);
        _link.SetBuild(build);                               // the editor's icon goes back to green
    }
}
#endif

void OnDestroy()
{
#if UNITY_EDITOR || DEVELOPMENT_BUILD
    _link?.Close();
#endif
}
```

`StoryletLiveBundle` lives in the Json assembly (`StoryletEngine.Runtime.Json`), so reference
it from your asmdef alongside the runtime. The demo project's `BoardDemo.cs` is this wiring in
full.

**Unreal**: `FStoryletLiveLink::Create(...)`. It compiles to no-ops in a Shipping build (the
WebSockets dependency is dropped there), so it's safe to leave in. Hold the shared pointer for
as long as you want the link open:

```cpp
#include "StoryletLiveLink.h"

Link = FStoryletLiveLink::Create(Bundle->GetBuildId(), TEXT("My Game"));
Link->Attach(Engine);                 // forward every flow's trace; a board each goes first
// ...play as normal; every deal, play and turn reaches the editor as it happens.

// Live refresh: the editor saved and pushed a new bundle. Fires on the game thread.
Link->OnBundle = [this](const FString& Build, const FString& Data)
{
    FString Error;
    if (!FStoryletLiveLink::ApplyLiveBundle(Engine, Data, Error))    // another project, bad JSON: keep yours
    {
        UE_LOG(LogTemp, Warning, TEXT("live link: %s"), *Error);
        return;
    }
    Link->SetBuild(Build);            // the editor's icon goes back to green
};
```

`ApplyLiveBundle` compiles the pushed JSON and calls `UStoryletEngine::ApplyLiveBundle`, which
swaps the new bundle in **in place**: your `UStoryletEngine` and `UStoryletFlow` pointers, the
debug registration and the link's attachment all stay valid, so there's nothing to re-bind (the
Unreal difference from the JavaScript shape above, and the same in-place swap Patterplay does).
It returns false with the error and leaves the run untouched if the bundle won't compile or belongs to
another project. `UStoryletEngine::ApplyLiveBundle(NewBundle, Error)` is Blueprint-callable
too, for a bundle you've loaded yourself.

**Godot**: a `StoryletLiveLink` node. It only opens the link in a debug build
(`OS.is_debug_build()`), so it is inert in a release export:

```gdscript
var link := StoryletLiveLink.new(bundle["content"]["hash"], "My Game")
add_child(link)                       # starts polling; a missing editor is a silent no-op
link.attach(engine)                   # forward every flow's trace; a board each goes first
# ...play as normal; every deal, play and turn reaches the editor as it happens.

# Live refresh: the editor saved and pushed a new bundle.
link.bundle_pushed.connect(func(build: String, data: String) -> void:
    var r := StoryletLiveLink.apply_live_bundle(engine, data, {"seed": 7, "log": true})
    if not r["ok"]:
        push_warning(r["error"])      # another project, bad JSON: keep yours
        return
    engine = r["engine"]              # re-bind your handles and anything over them
    flow = engine.get_flow("main")
    if flow == null:
        flow = engine.open_flow("main")
    link.attach(engine)
    link.set_build(build))            # the editor's icon goes back to green
```

`apply_live_bundle` never `push_error`s: a bundle it can't apply comes back as
`{"ok": false, "error": ...}` and your run is untouched. Pass the options you created the
engine with. The addon's Board demo (`addons/storyletengine/demo/board_demo.tscn`) is wired
this way; run it from the editor with Live Link on and the Board follows it.

## The wire protocol (`storyletengine/debug@1`)

For a custom client, the protocol is one small JSON object per message over the WebSocket.

Transport: a WebSocket, the editor listening on `ws://127.0.0.1:4472`, one JSON object per
text frame, UTF-8. A client sends `hello` first; the editor ignores everything else until it
has. The editor accepts one game at a time (a new connection replaces the old). Every field
not listed is ignored by the receiver, so either end may add fields without a version bump;
`v` bumps only when a listed field changes meaning.

Game to editor:

| Frame | Shape | When |
|---|---|---|
| hello | `{ "t":"hello", "v":2, "build":"<bundle content.hash>", "flows":["<flow id>", ...], "project":"<name, optional>", "boxes":["<box gameId>", ...] }` | on connect, and again after a pushed bundle is applied (with the new build). `flows` seeds the editor's list |
| flowOpen / flowClose | `{ "t":"flowOpen"\|"flowClose", "flow":"<flow id>" }` | a participant joined or left after the handshake |
| trace | `{ "t":"trace", "flow":"<flow id>", "event": <one runtime TraceEvent, verbatim, as subscribeTrace delivers it> }` | for every trace event any flow emits, in order |
| board | `{ "t":"board", "flow":"<flow id>", "hands": { "<hand gameId>": ["<card gameId>", ...] }, "turns": { "<box gameId>": <number> } }` | after `hello` (one per open flow), and after every `deal`, `play`, `evict` and `turns` trace event (the cheap snapshot; `trace` is the story) |

Editor to game:

| Frame | Shape | When |
|---|---|---|
| bundle | `{ "t":"bundle", "v":1, "build":"<new content.hash>", "data":"<the full .storyletsc JSON as a string>" }` | after a save, when the connected client's build differs from the editor's current compiled hash |

Identity in frames is by **gameId** (hands, boxes, cards), never by opaque id, because that is
what the game's own code already speaks and what the bundle inspector lists. The trace event
inside `trace` is the runtime's own object and keeps whatever ids the runtime uses; the Board
already renders from those.

A trace event fires after the state it reports has landed, so the board snapshot that follows
it shows the deal, play, eviction or turn it describes. The server binds to `127.0.0.1` only,
so no pairing token is needed.

Every client is held to one shared fixture (`packages/conformance/live-link/` in the repo): a
scripted run over the Hamlet bundle and the exact frames a client must send for it. A
port that sends anything else is wrong by definition, the same rule as the
[conformance corpus](/compatibility/).
