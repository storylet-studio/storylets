// Where each Storylet Engine runtime's source says its own version: the constant game code reads at runtime, so
// a game, a tool or an extension can check it's running on a Storylet Engine it was built for. The manifests
// can't do that on every engine (Unreal's .uplugin and Godot's plugin.cfg declare no version ranges, and none is
// readable by game code in a shipped build), so the version lives in code too. Patterplay's table, carried across.
//
// Shared by `bump:play`, which writes the version into each one beside the manifests, and the lockstep check,
// which fails when one differs from them. Each pattern's one capture group is the version.

export const VERSION_CONSTANTS = [
  { rel: "packages/runtime/src/version.ts", pattern: /^export const STORYLET_ENGINE_VERSION = "([^"]*)";$/m },
  { rel: "ports/unity/StoryletEngine/Runtime/StoryletEngineVersion.cs", pattern: /^\s*public const string Current = "([^"]*)";$/m },
  { rel: "ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/Storylets/Version.h", pattern: /^\s*inline constexpr const char\* StoryletEngineVersion = "([^"]*)";$/m },
  { rel: "ports/godot/addons/storyletengine/runtime/storylet_engine_version.gd", pattern: /^const CURRENT := "([^"]*)"$/m },
];

/** The version a constant's source says, or undefined when the pattern isn't found. */
export function readVersionConstant(source, { pattern }) {
  return pattern.exec(source)?.[1];
}

/** The source with the constant set to `version`. Throws when the pattern isn't found. */
export function writeVersionConstant(source, { rel, pattern }, version) {
  const m = pattern.exec(source);
  if (!m) throw new Error(`${rel}: no Storylet Engine version constant found`);
  const line = m[0].replace(`"${m[1]}"`, `"${version}"`);
  return source.slice(0, m.index) + line + source.slice(m.index + m[0].length);
}

/** Every manifest and version constant in the runtime set, by file, with the version each says (undefined when
 *  unreadable). The lockstep check and its test both read through this. */
export function lockstepVersions(read) {
  const json = (rel) => JSON.parse(read(rel));
  const versions = {
    "packages/runtime/package.json (JS)": json("packages/runtime/package.json").version,
    "packages/play-helpers/package.json (JS, ships in the runtime's zip)": json("packages/play-helpers/package.json").version,
    "ports/unity/StoryletEngine/package.json": json("ports/unity/StoryletEngine/package.json").version,
    "ports/unreal/StoryletEngine/StoryletEngine.uplugin": json("ports/unreal/StoryletEngine/StoryletEngine.uplugin").VersionName,
    "ports/godot/addons/storyletengine/plugin.cfg": (read("ports/godot/addons/storyletengine/plugin.cfg").match(/^version="([^"]+)"/m) ?? [])[1],
  };
  for (const c of VERSION_CONSTANTS) {
    let source;
    try { source = read(c.rel); } catch { source = ""; }
    versions[`${c.rel} (constant)`] = readVersionConstant(source, c);
  }
  return versions;
}
