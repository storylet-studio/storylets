# Storylet Engine for Unreal

The native **C++ Storylet Engine runtime**, packaged as an Unreal Engine plugin.

```
ports/unreal/
  StoryletEngine/      # the runtime plugin - what ships (see its README + CHANGELOG)
  StoryletEngineDemo/  # ready-to-open sample project (finds the plugin as a sibling)
  TestHost/            # maintainers: clang corpus runner (never shipped)
```

- **Using the plugin**: read [`StoryletEngine/README.md`](StoryletEngine/README.md)
  (it ships inside the plugin).
- **Trying it**: open
  [`StoryletEngineDemo/StoryletEngineDemo.uproject`](StoryletEngineDemo/README.md)
  and press Play.
- **Maintainers**: the engine core
  (`StoryletEngine/Source/StoryletEngineRuntime/Public/Storylets/`, std-only
  C++) is parity-verified against the shared conformance corpus via the
  [TestHost](TestHost/README.md); the UE wrapper layer compile-verifies with
  `RunUAT BuildPlugin -Plugin=.../StoryletEngine.uplugin -Package=<out>
  -TargetPlatforms=Mac -Rocket`, and the UObject-boundary smoke test
  (`StoryletEngine.Smoke`) runs headless via
  `-ExecCmds="Automation RunTests StoryletEngine"`.
- **Releases**: the `engine-unreal-v*` tag pipeline lands with the public
  repo migration (design/engine-runtimes.md section 7, phase 5).
