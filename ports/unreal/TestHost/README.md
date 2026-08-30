# Storylet Engine C++ TestHost

Maintainers only; never ships. Compiles the plugin's pure C++ core
(`../StoryletEngine/Source/StoryletEngineRuntime/Public/Storylets/`,
std-only headers) with plain clang - no Unreal - and replays the whole
conformance corpus through it, exactly as documented in
`packages/conformance/src/runner.ts`.

```sh
bash ports/unreal/TestHost/build.sh
```

`build.sh` compiles `main.cpp` (with `Json.h`, a tiny strict JSON parser
that feeds the core's neutral `JsonValue` tree) and runs the binary against
`packages/conformance/corpus.json`. The binary takes an overriding corpus
path as its first argument:

```sh
ports/unreal/TestHost/storyletengine_testhost path/to/corpus.json
```

It prints a per-family summary (expressions / specificity / peek / scripted),
the Live Link fixture result (`live-link/script.json` beside the corpus,
replayed through the std-only client in `Storylets/LiveLink.h` against a
recording sink and compared with `frames.json` byte for byte, compact JSON;
`LiveLinkFixture.h`) and `ALL PASS`, exiting non-zero on any divergence
from the reference expectations. A second argument writes the frames the
client sent, one per line, to that path (for pairing them with a running
Storyletter over a real socket).

## What this does NOT cover

The pure core only. `StoryletEngineRuntime`'s UObject wrappers and
`StoryletEngineEditor`'s Slate panel need Unreal headers, so clang cannot
reach them - and those are exactly the parts a refactor breaks quietly.

```sh
npm run check:unreal-plugin
```

builds both modules with the Unreal you already have. No secret is involved;
it is just slow (minutes), which is why it is a script you run before a release
rather than a CI step. Point it elsewhere with `UE_ROOT=/path/to/UE_5.7`.
