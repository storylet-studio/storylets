// Verify the four Storylet Engine runtimes expose the SAME public API surface.
//
// Why this exists, and why the corpus is not enough:
//
//   The conformance corpus pins BEHAVIOUR, but only of the calls a corpus case
//   actually makes. An API no case exercises can live on one runtime alone,
//   indefinitely, with every gate green (Patter's advanceToStop lived JS-only
//   for months this way, and its Unreal Blueprint wrapper lagged its own C++
//   core). The old storylets Godot port shipped and ANNOUNCED parity while
//   missing priming, site hands and the whole flags API.
//
//   So: the corpus proves the runtimes AGREE about what they both do; this
//   proves they both HAVE it. Add every new public runtime API here IN THE SAME
//   COMMIT that adds it; a member missing anywhere fails CI.
//
//   It says "fails CI" and, until 2026-08-29, that was not true: nothing ran
//   this file. It is `npm run parity` now and a step in the CI workflow.
//
//   PRESENCE IS NOT ENOUGH, which the same audit showed twice. Live Link v2
//   moved `attach` from a flow to the ENGINE and six documents plus the Unity
//   demo went on passing a flow; every one of them named a member this table
//   already recorded as present, so the table said fine. A row may therefore
//   also declare `takes:` - a token that must appear in the declaration's
//   parameter list - which is what turns "the name exists" into "the name
//   exists and means what we think".
//
//   Every deliberate hole carries a why:. Holes found by the 2026-07-31 audit
//   are recorded honestly as "MISSING - audit 2026-07-31" so this table
//   documents the debt instead of papering over it; fixing one means turning
//   its null back into a spelling.
//
//   Every row also declares `on:` - the OBJECT the member lives on (Engine,
//   Flow, Bundle, Save, Logger, PropertyBag, ScopeRegistry, Debug, Examiner,
//   BundleInspector), the same field Patter's parity table carries. It is not
//   decoration: it is what makes a shape divergence visible. The Unreal
//   Blueprint wrapper was single-flow for a while and the table read as fine,
//   because a row only asked "does the name exist somewhere in these files?".
//   Naming the owner forces the question "on WHAT?", which is the question
//   that catches an engine surface quietly living on a flow.
//
// Surfaces: js / unity / godot / unreal (std core + UE modules) / bp (the
// Unreal Blueprint wrapper, the API Unreal USERS see, held as a first-class
// fifth surface per design/engine-runtimes.md section 5). The JS state kernel
// lives in the sibling expr repo (../expr/packages/scoperegistry); the native
// kernels are vendored in the ports.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The surfaces we hold to parity. */
const SURFACES = {
  js: {
    label: "JS (packages/runtime + play-helpers + scoperegistry kernel)",
    files: [
      "packages/runtime/src/engine.ts",
      "packages/play-helpers/src/world.ts",
      "packages/runtime/src/describe.ts",
      "packages/play-helpers/src/logger.ts",
      "packages/play-helpers/src/save.ts",
      "packages/play-helpers/src/inspector.ts",
      "packages/play-helpers/src/bundle-inspector.ts",
      "packages/play-helpers/src/live-link.ts",
      "packages/play-helpers/src/refresh.ts",
      "../expr/packages/scoperegistry/src/index.ts",
      // The kernel state logger: diffState and the logger class are declared there and
      // re-exported here, the same way the bag already is.
      "../expr/packages/scoperegistry/src/state-logger.ts",
    ],
  },
  unity: {
    label: "Unity (C#)",
    files: [
      "ports/unity/StoryletEngine/Runtime/Engine.cs",
      "ports/unity/StoryletEngine/Runtime/Flow.cs",
      "ports/unity/StoryletEngine/Runtime/DescribeBundle.cs",
      "ports/unity/StoryletEngine/Runtime/StateLogger.cs",
      "ports/unity/StoryletEngine/Runtime/Expr/PropertyBag.cs",   // vendored from expr/ports/unity
      "ports/unity/StoryletEngine/Runtime/Expr/StateLogger.cs",   // likewise: the logger core
      "ports/unity/StoryletEngine/Runtime/Expr/ScopeRegistry.cs",
      "ports/unity/StoryletEngine/Runtime/Json/StoryletSave.cs",
      "ports/unity/StoryletEngine/Runtime/Unity/StoryletDebug.cs",
      "ports/unity/StoryletEngine/Runtime/Unity/StoryletBundleAsset.cs",
      "ports/unity/StoryletEngine/Runtime/StoryletLiveLink.cs",
      "ports/unity/StoryletEngine/Runtime/Json/StoryletLiveBundle.cs",
      "ports/unity/StoryletEngine/Editor/StoryletStateWindow.cs",
      "ports/unity/StoryletEngine/Editor/StoryletBundleAssetEditor.cs",
      "ports/unity/StoryletEngine/Editor/StoryletBundleImporter.cs",
    ],
  },
  godot: {
    label: "Godot (GDScript)",
    files: [
      "ports/godot/addons/storyletengine/runtime/engine.gd",
      "ports/godot/addons/storyletengine/runtime/flow.gd",
      "ports/godot/addons/storyletengine/runtime/describe_bundle.gd",
      "ports/godot/addons/storyletengine/runtime/state_logger.gd",
      // The shim keeps the class_name; the bag ITSELF is the vendored shared source
      // beside it, so a surface check reading only the shim reports every member
      // missing. Both, because the shim is where StoryletPropertyBag is declared.
      "ports/godot/addons/storyletengine/runtime/property_bag.gd",
      "ports/godot/addons/storyletengine/runtime/expr/property_bag.gd",
      // Same again for the logger: the shim carries the class_name, the vendored core
      // carries diff_state and the instance half.
      "ports/godot/addons/storyletengine/runtime/expr/state_logger.gd",
      "ports/godot/addons/storyletengine/runtime/scope_registry.gd",
      // The registry is shared too since 2026-09-24: the shim above holds the class_name,
      // the vendored source beside it holds the members.
      "ports/godot/addons/storyletengine/runtime/expr/scope_registry.gd",
      "ports/godot/addons/storyletengine/runtime/save.gd",
      "ports/godot/addons/storyletengine/runtime/live_link.gd",
      "ports/godot/addons/storyletengine/storylet_debug.gd",
      "ports/godot/addons/storyletengine/ui/storylet_state_panel.gd",
      "ports/godot/addons/storyletengine/editor/storylet_bundle_inspector_plugin.gd",
      "ports/godot/addons/storyletengine/editor/storylet_bundle_view.gd",
      "ports/godot/addons/storyletengine/storyletengine_plugin.gd",
      "ports/godot/addons/storyletengine/editor/storylet_bundle_import_plugin.gd",
      "ports/godot/addons/storyletengine/editor/storylet_bundle_resource.gd",
      // The SHARED sources, vendored from expr/ports/godot. The import flow and
      // the Inspector view's empty/error states live there now, not in the two
      // family files above, so a surface check that reads only those would
      // report a member missing that is present.
      "ports/godot/addons/storyletengine/runtime/expr/bundle_import_plugin.gd",
      "ports/godot/addons/storyletengine/runtime/expr/bundle_view.gd",
    ],
  },
  unreal: {
    label: "Unreal (std C++ core + runtime/editor modules)",
    files: [
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/Storylets/Engine.h",
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/Storylets/Save.h",
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/Storylets/DescribeBundle.h",
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/Storylets/StateLogger.h",
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/Storylets/Expr/PropertyBag.h",
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/Storylets/Expr/StateLogger.h",
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/Storylets/Expr/ScopeRegistry.h",
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Private/StoryletSaveJson.h",
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/StoryletDebug.h",
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/StoryletLiveLink.h",
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/Storylets/LiveLink.h",
      "ports/unreal/StoryletEngine/Source/StoryletEngineEditor/Private/SStoryletStatePanel.cpp",
      "ports/unreal/StoryletEngine/Source/StoryletEngineEditor/Private/StoryletBundleDetails.cpp",
      "ports/unreal/StoryletEngine/Source/StoryletEngineEditor/Private/StoryletEngineEditorModule.cpp",
      "ports/unreal/StoryletEngine/Source/StoryletEngineEditor/Private/StoryletBundleFactory.cpp",
    ],
  },
  bp: {
    label: "Unreal (Blueprint wrapper)",
    files: [
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/StoryletEngine.h",
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/StoryletSave.h",
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/StoryletBundle.h",
      // The USTRUCTs the wrapper hands back (FStoryletDealtCard and the rest),
      // which the returned-shape check below reads.
      "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/StoryletTypes.h",
    ],
  },
};

/** How a declaration of `name` looks in each language. A row cell may instead
 *  be { re, flags } to match an idiom rather than a named declaration. */
/** Every parameter list this member is declared or called with, in one
 *  surface's sources.
 *
 *  ALL of them, not the first: the C++ probe is deliberately loose (C++
 *  declarations vary too much to pin), and every one of these files opens with
 *  a usage comment, so the first hit is reliably `Link->Attach(Engine)` in
 *  prose. A `takes` row passes when ANY occurrence names the expected type,
 *  which is the honest question - "is this member, anywhere in this runtime,
 *  taking the thing the others take?" - and it still fails a port whose
 *  attach takes a flow, because then no occurrence names an engine.
 *
 *  What this catches: one port's member drifting to a different SHAPE while
 *  keeping its name, which is how the Unreal wrapper stayed single-flow for a
 *  while with this table reading fine. What it does NOT catch: a doc or a demo
 *  passing the wrong thing to a correct declaration, which is what actually
 *  happened at Live Link v2 - that wants the docs gate and a compiler, and
 *  both now exist.
 */
function paramLists(source, name, key) {
  const out = [];
  const probe = new RegExp(DECL[key](name).source, "g");
  for (const m of source.matchAll(probe)) {
    const open = source.indexOf("(", m.index);
    if (open < 0) continue;
    let depth = 0;
    for (let i = open; i < source.length && i < open + 400; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") {
        depth--;
        if (depth === 0) { out.push(source.slice(open + 1, i)); break; }
      }
    }
  }
  return out;
}

const DECL = {
  js: (n) => new RegExp(`(^|\\n)\\s*(export\\s+function\\s+|get\\s+)?${n}\\s*[(<]`),
  unity: (n) => new RegExp(`\\b(public|internal)\\b[^;\\n]*\\b${n}\\s*[({=;]`),
  godot: (n) => new RegExp(`\\n\\s*(static\\s+)?(func\\s+${n}\\s*\\(|signal\\s+${n}\\b)`),
  unreal: (n) => new RegExp(`\\b${n}\\s*\\(`),
  bp: (n) => new RegExp(`\\b${n}\\s*\\(`),
};

// The public runtime API. One row per member; each surface's cell is that
// runtime's spelling, a { re } idiom probe, or null where the member is
// deliberately absent there (the `why` says why; never use null to paper over
// a gap silently - an audited gap is null WITH a "MISSING - audit ..." why).
const API = [
  // --- the engine: world + flow manager (design/flows.md; schema 5) ---------
  // Every runtime, the Blueprint wrapper included, has the same two objects:
  // an engine that owns the bundle, the shared state and @world, and named
  // flows that do the playing. A BP hole here would be a divergence, not a
  // simplification, so the flow surface is complete on all five.
  { on: "Engine", member: "create",
    js: { re: "class Engine" }, unity: { re: "class Engine" },
    godot: "create", unreal: { re: "class Engine" }, bp: "Create",
    why: "constructor idiom probes where the language builds engines with new; Godot's static create and the BP Create are the factory spellings" },
  { on: "Engine", member: "openFlow", js: "openFlow", unity: "OpenFlow", godot: "open_flow", unreal: "openFlow", bp: "OpenFlow" },
  { on: "Engine", member: "getFlow", js: "getFlow", unity: "GetFlow", godot: "get_flow", unreal: "getFlow", bp: "GetFlow" },
  { on: "Engine", member: "closeFlow", js: "closeFlow", unity: "CloseFlow", godot: "close_flow", unreal: "closeFlow", bp: "CloseFlow" },
  { on: "Engine", member: "flows", js: "flows", unity: "Flows", godot: "flows", unreal: "flows", bp: "Flows" },
  { on: "Engine", member: "reset", js: "reset", unity: "Reset", godot: "reset", unreal: "reset", bp: "Reset" },
  { on: "Flow", member: "close", js: "close", unity: "Close", godot: "close", unreal: "close", bp: "Close" },
  { on: "Flow", member: "isClosed", js: "isClosed", unity: "IsClosed", godot: "is_closed", unreal: "isClosed", bp: "IsClosed" },
  { on: "Flow", member: "id",
    js: { re: "readonly id: string" }, unity: { re: "readonly string Id" },
    godot: { re: "var id: String" }, unreal: { re: "const std::string& id\\(\\)" }, bp: "GetFlowId",
    why: "a field in four languages, so these are field probes; Blueprint has no readonly pin, hence the GetFlowId accessor" },
  { on: "Engine", member: "traceTap",
    js: { re: "emitEngine" }, unity: { re: "EmitEngine" }, godot: { re: "emit_engine" }, unreal: { re: "emitEngine" }, bp: null,
    why: "the (flowId, event) engine-level stream behind subscribeTrace; probed by its emit seam because the subscribe name is shared with the flow's. No delegate crosses a BP pin (as subscribeTrace)" },
  { on: "Engine", member: "worldSeam",
    js: { re: "world\\?: ScopeResolver" }, unity: { re: "IScopeResolver World" },
    godot: { re: '"world"' }, unreal: { re: "WorldResolver" }, bp: null,
    why: "the host's @world binding (EngineOptions) is a std::function/interface, which does not cross a BP pin; Blueprint binds @world through a UStoryletWorld instead, which the engine registers as a foreign scope" },
  // The diagnostic hooks (2026-10-06): a JS-side warning or callback is port
  // parity, the same as any member, and until this review no row held them,
  // which is how the Blueprint wrapper came to have neither. Option fields, so
  // these are field probes; the cores spell them as engine or open-flow options.
  { on: "Engine", member: "onReplacedFlow",
    js: { re: "onReplacedFlow\\?: \\(id: string, dealt: number\\) => void" },
    unity: { re: "Action<string, int> OnReplacedFlow" },
    godot: { re: '"on_replaced_flow"' },
    unreal: { re: "std::function<void\\(const std::string&, int\\)> onReplacedFlow" },
    bp: { re: "FStoryletReplacedFlow OnReplacedFlow" },
    why: "a field or option in the cores; Blueprint binds it as an assignable delegate on the engine" },
  { on: "Flow", member: "onRestoreReport",
    js: { re: "onRestoreReport\\?: \\(report: LoadReport\\) => void" },
    unity: { re: "Action<LoadReport> OnRestoreReport" },
    godot: { re: '"on_restore_report"' },
    unreal: { re: "std::function<void\\(const LoadReport&\\)> onRestoreReport" },
    bp: { re: "OpenFlowFromJson\\(const FString& Id, const FString& Json, FString& OutReportJson\\)" },
    why: "an open-flow option in the cores; Blueprint has no callback pin, so the restore's report comes back as JSON in OpenFlowFromJson's OutReportJson" },
  { on: "Flow", member: "openFlowSeed",
    js: { re: "interface OpenFlowOptions[\\s\\S]{0,1500}?seed\\?: number" },
    unity: { re: "class OpenFlowOptions[\\s\\S]{0,400}?double\\? Seed" },
    godot: { re: 'OPEN_FLOW_OPTION_KEYS := \\["seed"' },
    unreal: { re: "struct OpenFlowOptions[\\s\\S]{0,1500}?seed" },
    bp: "OpenFlowSeeded",
    why: "seeding one flow is an open-flow option in the cores; a Blueprint pin cannot be optional, hence the OpenFlowSeeded variant (added 2026-10-06; Blueprint could not seed a flow before)" },
  // The LoadReport is never thrown away (2026-10-06): a hot swap and a save load
  // both say what they cost, and until this review the helpers on three
  // runtimes dropped it on the floor.
  { on: "LiveLink", member: "liveBundleReport",
    js: { re: "report: LoadReport \\}" },
    unity: { re: "public LoadReport Report" },
    godot: { re: '"report": swapped\\["report"\\]' },
    unreal: { re: "ApplyLiveBundle\\(UStoryletEngine\\* Engine, const FString& Data, FString& OutError, FString& OutReportJson\\)" },
    bp: "ApplyLiveBundleWithReport",
    why: "the swap's LoadReport in the live-bundle result; Blueprint and the C++ link hand it back as JSON" },
  { on: "Save", member: "loadStateReport",
    js: { re: "onReport\\?: \\(report: LoadReport\\) => void" },
    unity: { re: "Action<LoadReport> onReport = null" },
    godot: { re: 'LOAD_OPTION_KEYS := \\["on_report"\\]' },
    unreal: { re: "onReport" },
    bp: "LoadStateFromJsonWithReport",
    why: "loading a save hands back what it cost: an optional callback in the cores (the return value stays the @world values), a WithReport variant with an out-param in Blueprint" },
  { on: "Engine", member: "registryOption",
    js: { re: "registry\\?: ScopeRegistry" }, unity: { re: "ScopeRegistry Registry" },
    godot: { re: '"registry"' }, unreal: { re: "std::shared_ptr<ScopeRegistry> registry;" }, bp: null,
    why: "the game's one registry (one-registry programme, gate 5). A std object shared by pointer crosses no Blueprint pin; C++ games use UStoryletEngine::CreateWithRegistry" },
  { on: "Engine", member: "createWorldContainer", js: "createWorldContainer", unity: null, godot: null, unreal: null, bp: null,
    why: "the ready-made host container is a JS play-helpers convenience; native hosts bind their own resolver, and the UE wrapper self-backs and round-trips @world through its save file" },

  // --- the flow: the play verbs (schema section 3/5) -------------------------
  { on: "Flow", member: "peek", js: "peek", unity: "Peek", godot: "peek", unreal: "peek", bp: "Peek" },
  { on: "Flow", member: "deal", js: "deal", unity: "Deal", godot: "deal", unreal: "deal", bp: "Deal" },
  { on: "Flow", member: "dealMany", js: "dealMany", unity: "DealMany", godot: "deal_many", unreal: "dealMany", bp: "DealMany" },
  { on: "Flow", member: "dealAllHands", js: null, unity: null, godot: null, unreal: null, bp: "DealAllHands",
    why: "the no-argument dealMany; split out only for Blueprint (no optional array args on a BP pin)" },
  { on: "Flow", member: "board", js: "board", unity: "Board", godot: "board", unreal: "board", bp: "Board" },
  // The box filter on the whole-board read ("give me the barks hands"). Four
  // surfaces carry it as an OPTIONAL argument on board() itself, so a bare
  // name probe would pass on the unfiltered spelling alone: these cells are
  // signature probes on purpose.
  { on: "Flow", member: "boardForBox",
    js: { re: "board\\(boxRef\\?: string\\)" },
    unity: { re: "Board\\(string boxRef\\)" },
    godot: { re: "func board\\(box_ref" },
    unreal: { re: "board\\(const std::string& boxRef\\)" },
    bp: "BoardForBox",
    why: "not a hole: elsewhere an optional argument on board(); a separate BP method because Blueprint has no optional args and an always-present pin would make the whole-board read look like it needed one (as PlayAdvancing / DealAllHands)" },
  { on: "Flow", member: "outcomes", js: "outcomes", unity: "Outcomes", godot: "outcomes", unreal: "outcomes", bp: "Outcomes" },
  { on: "Flow", member: "play", js: "play", unity: "Play", godot: "play", unreal: "play", bp: "Play" },
  { on: "Flow", member: "playAdvancing", js: null, unity: null, godot: null, unreal: null, bp: "PlayAdvancing",
    why: "elsewhere an option (opts.advanceTurns / PlayOptions / {\"advance_turns\"}); a separate BP method because Blueprint has no optional struct args" },
  { on: "Flow", member: "advanceTurns", js: "advanceTurns", unity: "AdvanceTurns", godot: "advance_turns", unreal: "advanceTurns", bp: "AdvanceTurns" },
  { on: "Flow", member: "turn", js: "turn", unity: "Turn", godot: "turn", unreal: "turn", bp: "GetTurn" },
  { on: "Flow", member: "listBoxes", js: "listBoxes", unity: "ListBoxes", godot: "list_boxes", unreal: "listBoxes", bp: "ListBoxes" },
  { on: "Engine/Flow", member: "listProperties", js: "listProperties", unity: "ListProperties", godot: "list_properties", unreal: "listProperties", bp: "ListProperties" },
  { on: "Flow", member: "listBags", js: "listBags", unity: "ListBags", godot: "list_bags", unreal: "listBags", bp: null,
    why: "the state logger's mount surface (design 3.4); kernel-shaped, not a Blueprint surface (as bag.get)" },
  { on: "Engine/Flow", member: "getProperty", js: "getProperty", unity: "GetProperty", godot: "get_property", unreal: "getProperty", bp: null,
    why: "Blueprint is typed-only: GetPropertyNumber / String / Bool / Flags (rationale in StoryletEngine.h)" },
  { on: "Engine/Flow", member: "setProperty", js: "setProperty", unity: "SetProperty", godot: "set_property", unreal: "setProperty", bp: null,
    why: "Blueprint is typed-only: SetPropertyNumber / String / Bool / Flags" },
  { on: "Engine/Flow", member: "typedPropertyAccessors", js: null, unity: null, godot: null, unreal: null, bp: "GetPropertyNumber",
    why: "the BP-only face of getProperty/setProperty (one honest pin per type)" },
  { on: "Engine", member: "saveGame", js: "saveGame", unity: "SaveGame", godot: "save_game", unreal: "saveGame", bp: null,
    why: "Blueprint saves through UStoryletSave::SaveStateToJson (the string boundary; no envelope struct crosses a pin), as Patterplay's UPatterSave" },
  { on: "Engine", member: "loadGame", js: "loadGame", unity: "LoadGame", godot: "load_game", unreal: "loadGame", bp: null,
    why: "Blueprint loads through UStoryletSave::LoadStateFromJson" },

  // --- parking one visit, and pricing a load (design/engine-server.md 4.1, 4.9) ---
  // A visit parks when the player walks away and resumes when they scan in
  // again: one flow's state, not the engine's. saveFlow / openFlow(restore) are
  // that pair, and previewLoad / previewFlowRestore are the question a hot swap
  // has to ask before it acts.
  { on: "Engine", member: "saveFlow", js: "saveFlow", unity: "SaveFlow", godot: "save_flow", unreal: "saveFlow", bp: "SaveFlowToJson",
    why: "Blueprint parks through the string boundary (no FlowSave struct crosses a pin), as saveGame does through UStoryletSave" },
  { on: "Engine", member: "openFlowRestoring",
    js: { re: "restore\\?: FlowSave" }, unity: { re: "FlowSave Restore" },
    godot: { re: '"restore"' }, unreal: { re: "std::optional<FlowSave> restore" }, bp: "OpenFlowFromJson",
    why: "not a hole: elsewhere an option on openFlow (OpenFlowOptions.restore, with onRestoreReport beside it for the report the restore produces), so these are field probes on the options struct; a separate BP method because Blueprint has no optional struct args and takes the blob as JSON (as PlayAdvancing / DealAllHands)" },
  { on: "Engine", member: "previewLoad", js: "previewLoad", unity: "PreviewLoad", godot: "preview_load", unreal: "previewLoad", bp: null,
    why: "Blueprint previews through UStoryletSave::PreviewLoadFromJson, beside the LoadStateFromJson it prices: no LoadReport struct crosses a pin, so the report goes over as JSON" },
  { on: "Engine", member: "previewFlowRestore",
    js: "previewFlowRestore", unity: "PreviewFlowRestore", godot: "preview_flow_restore",
    unreal: "previewFlowRestore", bp: "PreviewFlowRestoreJson",
    why: "as previewLoad, the report crosses a BP pin as JSON; the method itself is on the engine wrapper because the flow it asks about may not be open" },

  // --- durable state (ruling H, 2026-10-06) ----------------------------------
  // What outlives a run, as a feature rather than a recipe: one shape for both
  // halves (the installation's memory on the engine, the player's pocket on a
  // flow), a load that reports what no longer fits, and an open-flow option
  // that writes a pocket in. With these public, markTaken and the flow's
  // snapshot / restore are internal on every runtime.
  { on: "Engine/Flow", member: "saveDurable",
    js: "saveDurable", unity: "SaveDurable", godot: "save_durable", unreal: "saveDurable", bp: "SaveDurableToJson",
    why: "one name on both objects, the engine's half and a flow's, so a name probe holds both; Blueprint takes the half through the string boundary (no DurableSave struct crosses a pin), as SaveFlowToJson" },
  { on: "Engine", member: "loadDurable",
    js: "loadDurable", unity: "LoadDurable", godot: "load_durable", unreal: "loadDurable", bp: "LoadDurableFromJson",
    why: "Blueprint passes the half as JSON and takes the LoadReport back as JSON in an out-param, as OpenFlowFromJson" },
  { on: "Engine", member: "openFlowDurable",
    js: { re: "durable\\?: DurableSave" }, unity: { re: "DurableSave Durable" },
    godot: { re: 'OPEN_FLOW_OPTION_KEYS := \\[[^\\]]*"durable"' },
    unreal: { re: "std::optional<DurableSave> durable" }, bp: "OpenFlowWithDurableJson",
    why: "an open-flow option in the cores, beside restore, with onRestoreReport carrying its report; a separate BP method because Blueprint has no optional struct args, taking the pocket as JSON and handing the report back as JSON (as OpenFlowFromJson)" },

  // --- the registry accessor (ruling J, 2026-10-06) ---------------------------
  { on: "Engine", member: "registry",
    js: "registry", unity: { re: "ScopeRegistry Registry =>" }, godot: "registry", unreal: "registry", bp: "GetRegistry",
    why: "the engine's scope registry, the game's or its own, read-only: a getter in JS, a property in C# (probed by its expression body, because the EngineOptions.Registry field has the same name), a method elsewhere. The C++ core's ownsRegistry() is test plumbing and has no row" },

  // --- the retained session log + trace (schema 5) --------------------------
  { on: "Flow", member: "log", js: "log", unity: "Log", godot: "log", unreal: "log", bp: "Log" },
  { on: "Engine", member: "log",
    js: { re: "engineLog" }, unity: { re: "_engineLog" }, godot: { re: "_engine_log" },
    unreal: { re: "engineLog_" }, bp: "GetRunLog",
    why: "the RUN's log: every flow's events in one order, each naming its flow (design/shared-scarcity.md 8.2). Probed by the field rather than the name, because log() is spelled the same on the flow and a name probe cannot tell the two apart - which is the exact confusion the `on:` field exists to catch" },
  { on: "Engine", member: "clearLog",
    js: { re: "clearLog\\(\\): void \\{\\n    this.engineLog" }, unity: { re: "_engineLog.Clear" },
    godot: { re: "_engine_log = \\[\\]" }, unreal: { re: "engineLog_.clear" }, bp: "ClearRunLog",
    why: "as Engine.log" },
  { on: "Flow", member: "clearLog", js: "clearLog", unity: "ClearLog", godot: "clear_log", unreal: "clearLog", bp: "ClearLog" },

  // --- the Live Link client (design/live-link.md) ---------------------------
  // Added 2026-08-29. This surface had NO rows, which is why v2 moving `attach`
  // from a flow to the engine went unnoticed in six documents and the Unity
  // demo: every one of them named a member the table already called present,
  // on an object the table did not model.
  //
  // `takes` is the answer to that. `attach` exists everywhere and always did;
  // what changed was what it accepts, and a presence check cannot see the
  // difference between an engine and a flow.
  { on: "LiveLink", member: "attach",
    js: "attach", unity: "Attach", godot: "attach", unreal: "Attach", bp: null,
    takes: { js: "engine", unity: "Engine", godot: "StoryletEngine", unreal: "UStoryletEngine" },
    why: "Blueprint has no Live Link: the link is a debug tool wired in C++ behind a Shipping guard, and a BP pin for it would ship the socket into a release build" },
  { on: "LiveLink", member: "detach",
    js: "detach", unity: "Detach", godot: "detach", unreal: "Detach", bp: null,
    why: "as LiveLink.attach" },
  { on: "LiveLink", member: "setBuild",
    js: "setBuild", unity: "SetBuild", godot: "set_build", unreal: "SetBuild", bp: null,
    why: "as LiveLink.attach" },
  { on: "Engine", member: "hotSwap",
    js: "hotSwap", unity: "HotSwap", godot: "hot_swap", unreal: "hotSwap", bp: null,
    why: "live bundle refresh as an engine method, which the live-link apply helpers call on every runtime; Blueprint refreshes through ApplyLiveBundle, because the result carries a new engine and a load report no pin carries" },
  { on: "LiveLink", member: "applyLiveBundle",
    js: "applyLiveBundle", unity: "Apply", godot: "apply_live_bundle", unreal: "ApplyLiveBundle", bp: null,
    takes: { js: "engine", godot: "engine" },
    why: "as LiveLink.attach. Unity spells it StoryletLiveBundle.Apply and Unreal has it on both the link and the engine wrapper, so the name differs where the idiom does" },

  // --- shared scarcity (design/shared-scarcity.md) --------------------------
  // Added 2026-08-29 by the pre-release audit, which found all three shipping
  // in four runtimes with no row: a port could have omitted any of them and
  // this gate would have stayed green, which is the precise failure its own
  // header warns about.
  { on: "PropertyBag", member: "rowStages",
    js: { re: "stages: d.stages" }, unity: { re: "Stages = d.Stages" },
    godot: { re: '"stages"' }, unreal: { re: "r.stages = d.stages" }, bp: null,
    why: "a quality's ladder on a listProperties() row. JS and Godot carried it and Unity and Unreal had no such field, so one public call answered differently on two runtimes (fixed 2026-08-29). No BP pin: Blueprint reads properties by typed accessor, not as rows" },

  { on: "Engine", member: "sharedClaims", js: "sharedClaims", unity: "SharedClaims",
    godot: "shared_claims", unreal: "sharedClaims", bp: null,
    why: "the world's claim ledger, an engine-internal read the host never needs: Blueprint gets the ANSWER through a deal's trace verdict (claimed-elsewhere), not the ledger" },
  { on: "Engine", member: "isTaken", js: "isTaken", unity: "IsTaken",
    godot: "is_taken", unreal: "isTaken", bp: null,
    why: "as sharedClaims: the `taken` verdict is how Blueprint learns this" },
  { on: "Engine", member: "markTaken", js: "markTaken", unity: "MarkTaken",
    godot: "mark_taken", unreal: "markTaken", bp: null,
    why: "as sharedClaims; the engine marks a shared one-shot spent as part of play, never the host. Internal on every runtime since ruling H: a host carries spends across a run with saveDurable and loadDurable" },
  { on: "Flow", member: "subscribeTrace", js: "subscribeTrace", unity: "SubscribeTrace", godot: "subscribe_trace", unreal: "subscribeTrace", bp: null,
    why: "deliberate: no delegate crosses a BP pin; Blueprint reads the retained log by polling Log() (the log option lands on Create as bRetainLog) - closes the 2026-07-31 audit hole" },

  // --- the .storyletsave string boundary (in the RUNTIME, never editor-only) -
  { on: "Save", member: "serializeState", js: "serializeState", unity: "SerializeState", godot: "serialize_state", unreal: "StoryletSaveStateToJson", bp: "SaveStateToJson" },
  // FOUR VERBS, in PATTERPLAY's pairing, which is the family template and was
  // checked rather than assumed (patter play-helpers save.ts and all four of
  // its runtimes, 2026-08-29): saveState / loadState work on the PARSED
  // object, serializeState / deserializeState work on TEXT, and
  // deserializeState therefore takes an engine and RESTORES - it is the text
  // twin of loadState, not a parse step.
  //
  // Storylets did not hold that. Godot and Unreal had the family shape; the JS
  // reference and Unity had a different one (deserializeState parsed and did
  // not restore, loadState took text), so one name meant two things across the
  // four runtimes AND neither pair matched Patter. The reference was brought to
  // the ports, not the other way round. `takes` pins the shapes.
  { on: "Save", member: "saveRegistry",
    js: null, unity: "SaveRegistry", godot: null, unreal: "saveRegistry", bp: null,
    why: "the game's half of a combined save: a registry's values as save text. JS writes JSON.stringify(registry.save()) and GDScript JSON.stringify(registry.save()) directly, since their values are already plain JSON; C# and C++ need a door because their values are a family type. Named as Patterplay names it" },
  { on: "Save", member: "loadRegistry",
    js: null, unity: "LoadRegistry", godot: null, unreal: "loadRegistry", bp: null,
    why: "as saveRegistry" },
  { on: "Save", member: "saveState",
    js: "saveState", unity: "SaveState", godot: "save_state", unreal: null, bp: null,
    takes: { js: "engine", unity: "Engine engine", godot: "engine: StoryletEngine" },
    why: "deliberate, not debt: `savedetail::EnvelopeToJson` writes the file as TEXT directly, character by character, and is the single serialiser. A saveState returning a tree would need a second one for the same data - and the corpus pins the file byte for byte, key order and number formatting included, so two serialisers is exactly the duplication that would drift. loadState still takes a tree, because parsing one is free. Blueprint likewise has no pin for a parsed tree" },
  { on: "Save", member: "loadState",
    js: "loadState", unity: "LoadState", godot: "load_state", unreal: "loadState", bp: null,
    takes: { js: "file: SaveFile", unity: "SaveFile file", godot: "file", unreal: "const JsonValue& tree" },
    why: "restore from the PARSED file. Blueprint takes text (LoadStateFromJson): a BP pin cannot hold a parsed tree" },
  { on: "Save", member: "deserializeState",
    js: "deserializeState", unity: "DeserializeState", godot: "deserialize_state",
    unreal: "deserializeState", bp: "LoadStateFromJson",
    takes: { js: "engine", unity: "Engine engine", godot: "engine: StoryletEngine", unreal: "Engine& engine" },
    why: "parse AND restore, from text, everywhere - the text twin of loadState, as Patterplay pairs them. It takes an ENGINE on every surface, which is what the `takes` probe holds it to: a parse-only spelling here is the divergence that was fixed on 2026-08-29" },

  // --- the state logger (kernel member, design 3.4: push-based on the
  //     PropertyBag audit hook + a per-product path-provider adapter; ships
  //     beside the kernel sources until the vendor-sync slice takes it in) --
  { on: "Logger", member: "snapshotState", js: "snapshotState", unity: "SnapshotState", godot: "snapshot_state", unreal: "snapshotState", bp: null,
    why: "a dev-surface helper over the kernel, not a Blueprint surface; Unreal users read the examiner's log panel" },
  { on: "Logger", member: "diffState", js: "diffState", unity: "DiffState", godot: "diff_state", unreal: "diffState", bp: null,
    why: "as snapshotState" },
  { on: "Logger", member: "createStateLogger", js: "createStateLogger", unity: "CreateStateLogger", godot: "create_state_logger", unreal: "createStateLogger", bp: null,
    why: "as snapshotState" },

  // --- the state kernel: PropertyBag (design 3.1) ----------------------------
  { on: "PropertyBag", member: "get", js: "get", unity: "Get", godot: "get_value", unreal: "get", bp: null,
    why: "the kernel is not a Blueprint surface; sessions expose typed accessors (Godot: get_value/set_value because Object owns get/set, recorded in ledger section 8)" },
  { on: "PropertyBag", member: "set", js: "set", unity: "Set", godot: "set_value", unreal: "set", bp: null,
    why: "as bag.get" },
  { on: "PropertyBag", member: "subscribe", js: "subscribe", unity: "Subscribe", godot: "subscribe", unreal: "subscribe", bp: null,
    why: "as bag.get" },
  { on: "PropertyBag", member: "onAudit", js: "onAudit", unity: "OnAudit", godot: "on_audit", unreal: "onAudit", bp: null,
    why: "as bag.get" },
  { on: "PropertyBag", member: "rows", js: "rows", unity: "Rows", godot: "rows", unreal: "rows", bp: null,
    why: "as bag.get" },
  { on: "PropertyBag", member: "declarations", js: "declarations", unity: "Declarations", godot: "declarations", unreal: "declarations", bp: null,
    why: "as bag.get" },
  { on: "PropertyBag", member: "clone", js: "clone", unity: "Clone", godot: "clone", unreal: "clone", bp: null,
    why: "as bag.get" },
  { on: "PropertyBag", member: "reseed", js: "reseed", unity: "Reseed", godot: "reseed", unreal: "reseed", bp: null,
    why: "as bag.get" },

  // --- the state kernel: ScopeRegistry (design 3.1) --------------------------
  { on: "ScopeRegistry", member: "defineOwned", js: "defineOwned", unity: "DefineOwned", godot: "define_owned", unreal: "defineOwned", bp: null,
    why: "as bag.get" },
  { on: "ScopeRegistry", member: "qualityLadders",
    js: { re: "qualityLadders" }, unity: { re: "QualityLadders" }, godot: { re: "_quality_ladders" },
    unreal: { re: "qualityLadders" }, bp: null,
    why: "the quality channel toEvalContext wires when any declaration is a quality. Not a BP surface: Blueprint never drives the kernel registry directly. Added to the three ports 2026-08-29 - they returned scopes and host alone, so a host using the registry WITHOUT the engine lost every ladder, and ordering comparisons silently stopped working" },
  { on: "ScopeRegistry", member: "mountOwned", js: "mountOwned", unity: "MountOwned", godot: "mount_owned", unreal: "mountOwned", bp: null,
    why: "as bag.get" },
  { on: "ScopeRegistry", member: "ownedBag", js: "ownedBag", unity: "OwnedBag", godot: "owned_bag", unreal: "ownedBag", bp: null,
    why: "as bag.get" },
  { on: "ScopeRegistry", member: "reseedOwned", js: "reseedOwned", unity: "ReseedOwned", godot: "reseed_owned", unreal: "reseedOwned", bp: null,
    why: "as bag.get" },
  { on: "ScopeRegistry", member: "defineForeign", js: "defineForeign", unity: "DefineForeign", godot: "define_foreign", unreal: "defineForeign", bp: null,
    why: "as bag.get" },
  { on: "ScopeRegistry", member: "has", js: "has", unity: "Has", godot: "has", unreal: "has", bp: null,
    why: "as bag.get" },
  { on: "ScopeRegistry", member: "remove", js: "remove", unity: "Remove", godot: "remove", unreal: "remove", bp: null,
    why: "as bag.get" },
  { on: "ScopeRegistry", member: "discardParked", js: "discardParked", unity: "DiscardParked", godot: "discard_parked", unreal: "discardParked", bp: null,
    why: "as bag.get" },
  { on: "ScopeRegistry", member: "revision", js: "revision", unity: "Revision", godot: { re: "\\nvar revision\\b" }, unreal: "revision", bp: null,
    why: "a read-only counter: a getter in JS, a property in C# and GDScript, an accessor in C++; not a BP surface, as bag.get" },
  { on: "ScopeRegistry", member: "saveFragment", js: "saveFragment", unity: null, godot: null, unreal: null, bp: null,
    why: "DEPRECATED in @wildwinter/scoperegistry 0.7.0 and removed at its next breaking release. No engine ever called it (versioning belongs to the save that embeds the values), so the shared native registry vendored from expr/ports does not carry it (patterkit design/one-registry-handover.md, section 5)" },
  { on: "ScopeRegistry", member: "loadFragment", js: "loadFragment", unity: null, godot: null, unreal: null, bp: null,
    why: "DEPRECATED in @wildwinter/scoperegistry 0.7.0 and removed at its next breaking release. No engine ever called it (versioning belongs to the save that embeds the values), so the shared native registry vendored from expr/ports does not carry it (patterkit design/one-registry-handover.md, section 5)" },
  { on: "ScopeRegistry", member: "toSchema", js: "toSchema", unity: null, godot: null, unreal: null, bp: null,
    why: "AUTHORING-SIDE, decided 2026-08-29 (the 2026-07-31 audit recorded the absence and left the call open). toSchema builds the schema the expr VALIDATOR consumes - autocomplete and squiggles while somebody types an expression - and that happens in Storyletter and in the compiler, both JS. A runtime EVALUATES expressions; it never validates authored text, because a bundle cannot reach a port until the compiler has accepted it. Adding it natively would ship a validator with nothing to validate" },
  { on: "ScopeRegistry", member: "readScopeRegistrySpec", js: "readScopeRegistrySpec", unity: "ReadScopeRegistrySpec", godot: "read_scope_registry_spec", unreal: "readScopeRegistrySpec", bp: null,
    why: "as bag.get" },

  // --- the debug registry (design 2.5) ---------------------------------------
  { on: "Debug", member: "register", js: null, unity: "Register", godot: "register", unreal: "Register", bp: "RegisterForDebug",
    why: "JS runs in-process: the session is handed to the inspector directly, no registry needed (recorded in play-helpers/src/inspector.ts header)" },
  { on: "Debug", member: "unregister", js: null, unity: "Unregister", godot: "unregister", unreal: "Unregister", bp: "UnregisterForDebug",
    why: "as debug.register" },
  { on: "Debug", member: "list", js: null, unity: "List", godot: "list", unreal: "List", bp: null,
    why: "JS as debug.register; Blueprint publishes via RegisterForDebug, the editor panel does the listing" },
  { on: "Debug", member: "changed", js: null, unity: "OnChanged", godot: "changed", unreal: "OnChanged", bp: null,
    why: "JS as debug.register; Blueprint has no registry-shape event (the editor panel subscribes natively)" },

  // The Live Link's whereabouts, shown by every examiner. Unity alone had this
  // until 2026-08-29, so the same panel answered a different question in each
  // engine: a Godot or Unreal user with the link attached had no in-engine way
  // to tell "the editor is not listening" from "I never attached".
  { on: "Debug", member: "registerLink", js: null, unity: "RegisterLink", godot: "register_link", unreal: "RegisterLink", bp: null,
    why: "no JS registry at all (the inspector runs in-process and is handed its engine); no BP pin, as the link itself has none" },
  { on: "Debug", member: "unregisterLink", js: null, unity: "UnregisterLink", godot: "unregister_link", unreal: "UnregisterLink", bp: null,
    why: "as Debug.registerLink" },
  { on: "LiveLink", member: "linkState",
    js: { re: "readonly state: LiveLinkState" }, unity: { re: "LiveLinkState State" }, godot: "link_state", unreal: "LinkState", bp: null,
    why: "connecting / connected / closed, the same three everywhere. JS exposes it as a read-only `state` on the link object rather than a method, which is the JS idiom (added 2026-10-06: the row's old `state\\b` probe passed on prose while the member did not exist); no BP pin, as the link has none" },

  // --- the bundle asset path (design 2.2) -------------------------------------
  { on: "Bundle", member: "importer", js: null, unity: "OnImportAsset", godot: "_import", unreal: "FactoryCreateFile", bp: null,
    why: "JS has no engine asset pipeline (the host passes parsed JSON to createSession); Blueprint sees the imported asset, not the importer" },
  { on: "Bundle", member: "loadFromJsonString", js: null, unity: "LoadFromJsonString", godot: "from_json_text", unreal: null, bp: "LoadFromJsonString",
    why: "JS: JSON.parse is the side door; Unreal core: the asset side door is the UE-layer UStoryletBundle::LoadFromJsonString (the bp column)" },

  // --- the examiner (design 2.4) ----------------------------------------------
  { on: "Examiner", member: "panel", js: "createPropertyInspector", unity: "Open", godot: "_ready", unreal: "Construct", bp: null,
    why: "the examiner is an editor/dev surface; Blueprint users open the editor panel" },
  { on: "Examiner", member: "saveLoad", js: { re: "Save state" }, unity: { re: "Save State" }, godot: { re: "Save State" }, unreal: { re: "Save State" }, bp: null,
    why: "Blueprint: editor-side, as examiner.panel" },
  { on: "Examiner", member: "turnsSection", js: { re: "Turns \\(per box\\)" }, unity: { re: "Turns \\(per box\\)" }, godot: { re: ": turn %s" }, unreal: { re: "Turns \\(per box\\)" }, bp: null,
    why: "Blueprint: editor-side, as examiner.panel" },
  { on: "Examiner", member: "boardSection", js: { re: "board\\(\\)" }, unity: { re: "\"Board\"" }, godot: { re: "\\.board\\(\\)" }, unreal: { re: "BoardSection" }, bp: null,
    why: "Blueprint: editor-side, as examiner.panel" },
  { on: "Examiner", member: "resetToDefault", js: { re: "Reset to default" }, unity: { re: "\"Reset to default\"" }, godot: { re: "Reset to default" }, unreal: { re: "Reset to default" }, bp: null,
    why: "Blueprint: editor-side, as examiner.panel" },
  { on: "Examiner", member: "searchFilter", js: { re: "Filter properties" }, unity: { re: "Filter properties" }, godot: { re: "Filter properties" }, unreal: { re: "SSearchBox" }, bp: null,
    why: "Blueprint: editor-side, as examiner.panel" },
  { on: "Examiner", member: "logPanel", js: { re: "Autoscroll" }, unity: { re: "Autoscroll" }, godot: { re: "Autoscroll" }, unreal: { re: "Autoscroll" }, bp: null,
    why: "Blueprint: editor-side, as examiner.panel (per-kind filters + Autoscroll + Copy in every examiner; closes the 2026-07-31 audit hole)" },

  // --- the bundle inspector (design 2, piece 6) -------------------------------
  //
  // The runtime half is a BUNDLE-level API, not a session method: it answers
  // "what may my game code call?" from the imported asset alone. It is a full
  // five-surface member, Blueprint included - integrators ARE the audience, and
  // the description is read-only data (no mis-settable pin, unlike the session's
  // typed-only property accessors). The view half is per engine, so its rows are
  // idiom probes; the section headings are held to one shared vocabulary so all
  // four inspectors read the same.
  { on: "Bundle", member: "describeBundle", js: "describeBundle", unity: "DescribeBundle", godot: "describe_bundle", unreal: "describeBundle", bp: "DescribeBundle" },
  { on: "BundleInspector", member: "view",
    js: { re: "createBundleInspector" },
    unity: { re: "CustomEditor\\(typeof\\(StoryletBundleAsset\\)\\)" },
    godot: { re: "EditorInspectorPlugin" },
    unreal: { re: "RegisterCustomClassLayout" },
    bp: null,
    why: "the view is an editor surface in every engine; Blueprint users open the asset (and can call DescribeBundle themselves at runtime)" },
  { on: "BundleInspector", member: "handsSection",
    js: { re: "Hands \\(deal\\)" }, unity: { re: "Hands \\(deal\\)" },
    godot: { re: "Hands \\(deal\\)" }, unreal: { re: "Hands \\(deal\\)" }, bp: null,
    why: "Blueprint: editor-side, as bundleInspector.view" },
  { on: "BundleInspector", member: "tagsSection",
    js: { re: "Tags by box \\(peek criteria\\)" }, unity: { re: "Tags by box \\(peek criteria\\)" },
    godot: { re: "Tags by box \\(peek criteria\\)" }, unreal: { re: "Tags by box \\(peek criteria\\)" }, bp: null,
    why: "Blueprint: editor-side, as bundleInspector.view" },
  { on: "BundleInspector", member: "propertiesSection",
    js: { re: "Properties \\(declared\\)" }, unity: { re: "Properties \\(declared\\)" },
    godot: { re: "Properties \\(declared\\)" }, unreal: { re: "Properties \\(declared\\)" }, bp: null,
    why: "Blueprint: editor-side, as bundleInspector.view" },
  { on: "BundleInspector", member: "countsSection",
    js: { re: "Counts" }, unity: { re: "Counts" }, godot: { re: "Counts" }, unreal: { re: "Counts" }, bp: null,
    why: "Blueprint: editor-side, as bundleInspector.view" },
  { on: "BundleInspector", member: "loadError",
    js: null,
    unity: { re: "LoadError" }, godot: { re: "Bundle failed to load" }, unreal: { re: "failed to compile" },
    bp: null,
    why: "JS has no asset pipeline: describeBundle takes an already-parsed bundle, so there is no import failure to surface (the host's JSON.parse throws at its own boundary). Blueprint: editor-side, as bundleInspector.view" },
];

// --- the fields of what the API hands back (added 2026-10-06) ----------------
//
// The table above asks whether a member exists and, with `takes`, what it
// accepts. It never asked what comes BACK, so a port could drop a field from a
// dealt card and stay green: the 2026-10-06 review found the Blueprint log
// entry carrying Flow / Kind / Seq / Turn / Summary and nothing structured,
// and no row could have said so.
//
// SHAPES names where each surface DECLARES a returned shape: a regex for the
// head of the interface, class or struct (or, where a surface has no type for
// it, the function whose signature or body builds it). FIELDS then holds one
// row per required field, in the API table's own form: each surface's
// spelling, a { re } probe, or null with a why ("MISSING - review ..." is
// debt). A field passes only if it is declared INSIDE that declaration, not
// anywhere in the file, because `id` and `turn` are everywhere and a loose
// probe would pass on any of them. A cell may name `in:` a companion
// declaration where the field lives one step away (a log entry's kind is
// declared on the event it carries).
//
// GDScript builds these as Dictionaries inline, so its "declaration" is the
// builder function and a field is its string key there. Those anchors carry a
// parameter where the name alone is shared (the vendored state logger has an
// _emit and the registry a _view of its own).
const SHAPES = {
  DealtCard: { from: "Flow.deal / dealMany / board / peek",
    js: "interface DealtCard\\b", unity: "class DealtCard\\b", godot: "func _view\\(entry: Dictionary\\)",
    unreal: "struct DealtCard\\s*\\{", bp: "struct FStoryletDealtCard\\b" },
  OutcomeView: { from: "Flow.outcomes",
    js: "interface OutcomeView\\b", unity: "class OutcomeView\\b", godot: "func outcomes\\(",
    unreal: "struct OutcomeView\\s*\\{", bp: "struct FStoryletOutcomeView\\b" },
  BoxView: { from: "Flow.listBoxes",
    js: "interface BoxView\\b", unity: "class BoxView\\b", godot: "func list_boxes\\(",
    unreal: "struct BoxView\\s*\\{", bp: "struct FStoryletBoxView\\b" },
  RankedList: { from: "Flow.peek",
    js: "interface RankedList\\b", unity: "class RankedList\\b", godot: "func peek\\(",
    unreal: "struct RankedList\\s*\\{", bp: "TArray<FStoryletDealtCard> Peek\\(",
    why: "Blueprint's Peek returns the card array itself, so its signature stands in for the shape" },
  LogEntry: { from: "Flow.log",
    js: "type LogEntry =", unity: "class LogEntry\\b", godot: "func _emit\\(event: Dictionary",
    unreal: "struct LogEntry\\s*\\{", bp: "struct FStoryletLogEntry\\b" },
  HotSwapResult: { from: "Engine.hotSwap",
    js: "hotSwap\\([^)]*\\):", unity: "class HotSwapResult\\b", godot: "func _swap\\(",
    unreal: "struct HotSwapResult\\s*\\{", bp: null,
    why: "JS declares it inline as hotSwap's return type; Godot builds it in _swap, which hot_swap and the live link share. No BP hotSwap (see Engine.hotSwap): Blueprint swaps in place through ApplyLiveBundle, so there is no replacement engine to hand back" },
  LiveBundleResult: { from: "LiveLink.applyLiveBundle",
    js: "type LiveBundleResult =", unity: "class StoryletLiveBundleResult\\b",
    godot: "func apply_live_bundle\\(",
    unreal: "static bool ApplyLiveBundle\\(", bp: "bool ApplyLiveBundleWithReport\\(",
    why: "Unreal has no result type: the C++ link and the BP engine return ok as a bool and the rest as out-params, so the signatures (both overloads on the link) stand in for the shape" },
  DurableSave: { from: "Engine/Flow.saveDurable",
    js: "interface DurableSave\\b", unity: "class DurableSave\\b", godot: "func save_durable\\(",
    unreal: "struct DurableSave\\s*\\{", bp: null,
    why: "Godot builds the half in save_durable. Blueprint carries a durable half as JSON text, so it has no struct of its own" },
};

// Why the Unreal cores have no engine or bundle in a live-bundle result, said once.
const IN_PLACE = "swapped IN PLACE: the UStoryletEngine the caller holds stays valid with the new bundle under it (GetBundle reads it), so there is nothing to hand back";

const FIELDS = [
  ...["id", "gameId", "title", "purpose", "fields"].map((f) => ({ shape: "DealtCard", field: f })),
  ...["id", "gameId", "title", "purpose", "fields", "available"].map((f) => ({ shape: "OutcomeView", field: f })),
  ...["id", "gameId", "title", "turn"].map((f) => ({ shape: "BoxView", field: f })),
].map((row) => ({
  ...row,
  // These three follow each language's naming exactly, so the spellings are
  // derived rather than typed out thirty times: camelCase in JS, the C++ core
  // and Godot's keys, PascalCase in C# and Blueprint (bool gets UE's b prefix).
  js: row.field, godot: row.field, unreal: row.field,
  unity: row.field[0].toUpperCase() + row.field.slice(1),
  bp: row.field === "available" ? "bAvailable" : row.field[0].toUpperCase() + row.field.slice(1),
})).concat([
  { shape: "RankedList", field: "box", js: "box", unity: "Box", godot: "box", unreal: "box", bp: null,
    why: "Blueprint's Peek returns the cards alone; the box is the BoxRef the caller passed (the other surfaces echo it normalised to a gameId, which a BP caller who peeks by internal id does not get back)" },
  { shape: "RankedList", field: "cards", js: "cards", unity: "Cards", godot: "cards", unreal: "cards",
    bp: { re: "TArray<FStoryletDealtCard> Peek\\(" } },

  { shape: "LogEntry", field: "seq", js: "seq", unity: "Seq", godot: "seq", unreal: "seq", bp: "Seq" },
  { shape: "LogEntry", field: "turn",
    js: { re: "turn\\?: number" }, unity: "Turn", godot: "turn", unreal: "turn", bp: "Turn",
    why: "JS by its optional spelling, because the play and turns events carry a `turn: number` of their own" },
  { shape: "LogEntry", field: "type",
    js: { re: 'type: "deal"', in: "type TraceEvent =" }, unity: null,
    godot: { re: '"type": "deal"', in: "func deal_many\\(" },
    unreal: { re: "Kind kind", in: "struct TraceEvent\\s*\\{" }, bp: "Kind",
    why: "the event's kind. Declared on the event, not the entry, in JS, Godot (each emitting builder sets it) and the C++ core. C# has no tagged union, so the kind IS the event's class (DealEvent, PeekEvent, ...) and a host switches on it" },
  { shape: "LogEntry", field: "event",
    js: { re: "TraceEvent &" }, unity: { re: "TraceEvent Event" }, godot: { re: "event\\.duplicate\\(\\)" },
    unreal: { re: "TraceEvent event" }, bp: { re: "TArray<FStoryletTraceCard>\\s+Cards\\s*;" },
    why: "the structured event: the hand, box, card, outcome, path, criteria and verdicts a log line is about. JS and Godot spread it into the entry, C# and C++ hold it. Blueprint flattens the event onto the entry: string fields per kind, a write's values as JSON text, and the verdicts as Cards" },

  { shape: "HotSwapResult", field: "engine", js: "engine", unity: "Engine", godot: "engine", unreal: "engine", bp: null,
    why: "as the shape: no Blueprint hotSwap" },
  { shape: "HotSwapResult", field: "report", js: "report", unity: "Report", godot: "report", unreal: "report", bp: null,
    why: "as the shape: no Blueprint hotSwap" },

  ...["schema", "content", "values", "spent"].map((f) => ({
    shape: "DurableSave", field: f, js: f, godot: f, unreal: f, unity: f[0].toUpperCase() + f.slice(1), bp: null,
    why: "as the shape: Blueprint holds a durable half as JSON text",
  })),

  { shape: "LiveBundleResult", field: "ok", js: "ok", unity: "Ok", godot: "ok",
    unreal: { re: "bool ApplyLiveBundle\\(" }, bp: { re: "bool ApplyLiveBundleWithReport\\(" },
    why: "the Unreal cells are the bool return" },
  { shape: "LiveBundleResult", field: "engine", js: "engine", unity: "Engine", godot: "engine", unreal: null, bp: null,
    why: IN_PLACE },
  { shape: "LiveBundleResult", field: "bundle", js: "bundle", unity: "Bundle", godot: "bundle", unreal: null, bp: null,
    why: `${IN_PLACE}. The BP caller passed the bundle in` },
  { shape: "LiveBundleResult", field: "report", js: "report", unity: "Report", godot: "report",
    unreal: { re: "FString& OutReportJson\\b" }, bp: { re: "FString& OutReportJson\\b" },
    why: "the Unreal cells are the out-param carrying the LoadReport as JSON" },
  { shape: "LiveBundleResult", field: "error", js: "error", unity: "Error", godot: "error",
    unreal: { re: "FString& OutError\\b" }, bp: { re: "FString& OutError\\b" },
    why: "the Unreal cells are the out-param" },
]);

/**
 * The source with its comments removed, so a probe can only be satisfied by
 * CODE. Until 2026-10-06 the probes ran over the raw text, and two rows passed
 * on a comment alone: JS `LiveLink.linkState` (its `state\b` probe met the
 * word in prose; there was no such member) and Unity's "Reset to default"
 * (named in a comment over a button that said only "Reset"). String literals
 * are kept, because several probes deliberately match a UI string.
 *
 * C-family files (`.ts`, `.cs`, `.h`, `.cpp`) lose `//` and block comments;
 * GDScript loses `#` comments. Quoted strings survive whole, including a
 * GDScript triple-quoted string and a C# verbatim `@"..."` (whose quote is
 * doubled, not escaped). Newlines are kept so a line-anchored probe still
 * sees line starts.
 */
function stripComments(text, file) {
  const gd = file.endsWith(".gd");
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (gd && c === "#") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (!gd && c === "/" && next === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (!gd && c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
      continue;
    }
    if (gd && (text.startsWith('"""', i) || text.startsWith("'''", i))) {
      const q = text.slice(i, i + 3);
      const end = text.indexOf(q, i + 3);
      const stop = end < 0 ? n : end + 3;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (!gd && c === "@" && next === '"') {
      let j = i + 2;
      while (j < n) {
        if (text[j] === '"' && text[j + 1] === '"') { j += 2; continue; }
        if (text[j] === '"') { j++; break; }
        j++;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || (!gd && c === "`")) {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === "\\") j++;
        else if (text[j] === "\n" && c !== "`") break;   // an unterminated quote ends with its line
        j++;
      }
      out += text.slice(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const sources = {};
const missingFiles = [];
for (const [key, s] of Object.entries(SURFACES)) {
  const texts = [];
  for (const rel of s.files) {
    const abs = resolve(root, rel);
    if (!existsSync(abs)) {
      missingFiles.push(`  ${rel}  (surface: ${s.label})`);
      continue;
    }
    texts.push(stripComments(readFileSync(abs, "utf8"), rel));
  }
  sources[key] = texts.join("\n");
}

if (missingFiles.length) {
  console.error("check-runtime-api-parity: source files not found - paths moved?\n");
  console.error(missingFiles.join("\n"));
  process.exit(2);
}

const probe = (key, cell) =>
  typeof cell === "string" ? DECL[key](cell) : new RegExp(cell.re, cell.flags ?? "");

const missing = [];
for (const row of API) {
  if (!row.on) {
    console.error(`check-runtime-api-parity: row \`${row.member}\` has no \`on:\` - say which object it lives on.`);
    process.exit(2);
  }
  for (const key of Object.keys(SURFACES)) {
    const cell = row[key];
    if (cell == null) continue; // deliberately absent here (see `why`)
    if (!probe(key, cell).test(sources[key])) {
      const shown = typeof cell === "string" ? cell : `/${cell.re}/`;
      missing.push(`  ${row.on ?? "?"}.${row.member}  ->  MISSING from ${SURFACES[key].label} (expected \`${shown}\`)`);
      continue;
    }
    // Present. Does it take what it is supposed to take?
    const wants = row.takes?.[key];
    if (wants === undefined || typeof cell !== "string") continue;
    const lists = paramLists(sources[key], cell, key);
    if (!lists.some((params) => params.includes(wants))) {
      missing.push(`  ${row.on}.${row.member}  ->  WRONG SHAPE on ${SURFACES[key].label}: `
        + `expected a parameter naming \`${wants}\`, found ${lists.length === 0 ? "no declaration" : lists.map((l) => `(${l.trim()})`).join(", ")}`);
    }
  }
}

/**
 * The text of every declaration in `source` whose head matches `anchor`, so a
 * field probe can be held to the shape it belongs to. All matches, joined, for
 * the same reason paramLists takes all of them: the Unreal link declares
 * applyLiveBundle as two overloads, and the report lives on the second.
 *
 * GDScript has no braces, so there it is the function from its `func` line to
 * the next line back at column 0. Elsewhere it runs from the head to the close
 * of the first bracket opened after it (the body of an interface, class or
 * struct, a function's parameter list, or hotSwap's inline return type), or,
 * for a TypeScript alias (`type X =`), to its `;`. Comments are already gone,
 * so the only brackets left are code; none of these declarations holds a
 * bracket inside a string.
 */
function declBodies(source, key, anchor) {
  const out = [];
  for (const m of source.matchAll(new RegExp(anchor, "g"))) {
    const head = m.index;
    let end = m.index + m[0].length;
    if (key === "godot") {
      for (;;) {
        const nl = source.indexOf("\n", end);
        if (nl < 0) { end = source.length; break; }
        const next = source.indexOf("\n", nl + 1);
        const line = source.slice(nl + 1, next < 0 ? source.length : next);
        end = nl;
        if (line.trim() !== "" && !/^\s/.test(line)) break;
        end = next < 0 ? source.length : next;
        if (next < 0) break;
      }
      out.push(source.slice(head, end));
      continue;
    }
    const alias = /=\s*$/.test(m[0]);
    let depth = 0;
    let i = alias ? end : end - 1;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") {
        depth--;
        if (!alias && depth === 0) break;
      } else if (alias && depth === 0 && c === ";") break;
    }
    out.push(source.slice(head, i + 1));
  }
  return out;
}

/** How a field declaration looks inside each surface's declaration of a shape. */
const FIELD = {
  js: (n) => `(?<![\\w$])${n}\\??\\s*:`,
  unity: (n) => `(?<=\\s)${n}\\s*(;|=|\\{)`,
  godot: (n) => `"${n}"`,
  unreal: (n) => `(?<=[\\s>*&])${n}\\s*(;|=|\\{)`,
  bp: (n) => `(?<=[\\s>*&])${n}\\s*(;|=|\\{)`,
};

const undeclared = new Set();
for (const row of FIELDS) {
  const shape = SHAPES[row.shape];
  if (!shape) {
    console.error(`check-runtime-api-parity: field row \`${row.field}\` names shape \`${row.shape}\`, which SHAPES does not declare.`);
    process.exit(2);
  }
  for (const key of Object.keys(SURFACES)) {
    const cell = row[key];
    if (cell == null) continue; // deliberately absent here (see `why`)
    if (shape[key] == null) {
      console.error(`check-runtime-api-parity: ${row.shape}.${row.field} has a ${key} spelling, but ${row.shape} has no ${key} declaration.`);
      process.exit(2);
    }
    const anchor = cell.in ?? shape[key];
    const bodies = declBodies(sources[key], key, anchor);
    if (bodies.length === 0) {
      const line = `  ${row.shape} (returned by ${shape.from})  ->  NO DECLARATION on ${SURFACES[key].label} (expected /${anchor}/)`;
      if (!undeclared.has(line)) { undeclared.add(line); missing.push(line); }
      continue;
    }
    const re = new RegExp(typeof cell === "string" ? FIELD[key](cell) : cell.re, cell.flags ?? "");
    if (!bodies.some((body) => re.test(body))) {
      const shown = typeof cell === "string" ? cell : `/${cell.re}/`;
      missing.push(`  ${row.shape}.${row.field}  ->  MISSING FIELD on ${SURFACES[key].label} (expected \`${shown}\` inside /${anchor}/)`);
    }
  }
}

if (missing.length) {
  console.error("Storylet Engine runtime API parity FAILED - the runtimes must expose the same surface:\n");
  console.error(missing.join("\n"));
  console.error(`
Fix by implementing the member or field on the runtime(s) above, in this commit. If it genuinely does
not belong there, set that column to null in scripts/check-runtime-api-parity.mjs with a \`why\`.`);
  process.exit(1);
}

// The hole count, broken down, because one number invited the wrong reading.
//
// "89 recorded holes" sounds like 89 things to look at. Most are nothing of
// the kind: a member that exists ONLY as a Blueprint spelling (dealAllHands,
// playAdvancing, the typed accessors) books four holes at once, and a whole
// family is absent from JS for one structural reason (it runs in-process, so
// there is no debug registry to have). What actually wants reading is the
// DEBT: a hole whose `why` admits the member should be there and is not.
// Those say "MISSING" and are counted separately (2026-08-29).
const holesFor = (table, pred) => table.reduce(
  (n, row) => n + Object.keys(SURFACES).filter((k) => row[k] == null && pred(row)).length, 0);
const isDebt = (row) => /MISSING/i.test(row.why ?? "");
const debt = holesFor(API, isDebt) + holesFor(FIELDS, isDebt);
const holes = holesFor(API, () => true);
const fieldHoles = holesFor(FIELDS, () => true);
console.log(
  `Storylet Engine runtime API parity OK - ${API.length} members and ${Object.keys(SHAPES).length} `
  + `returned shapes (${FIELDS.length} fields) across ${Object.keys(SURFACES).length} surfaces `
  + `(${holes} member holes and ${fieldHoles} field holes, each with a why; `
  + `${debt} of them admitted DEBT).`);
