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
`LiveLinkFixture.h`), the one-registry checks (`OneRegistry.h`: the JS
runtime's `packages/runtime/test/one-registry.test.ts` ported case for case,
plus the registry leaving with a destroyed engine and the live swap's
hand-over), the kernel-error checks (also in `OneRegistry.h`: one case per
place the engine rethrows the shared kernel's `ExprError` / `RegistryError`
as its own `EvalError` / `StoryletError`, each failing when its rethrow is
removed), the expr parity corpus and the registry corpus beside ours, and
`ALL PASS`, exiting non-zero on any divergence from the reference
expectations. A second argument writes the frames the
client sent, one per line, to that path (for pairing them with a running
Storyletter over a real socket).

## With Patterplay: `with-patter/`

```sh
bash ports/unreal/TestHost/with-patter/build.sh            # the combined game, and the tripwire
bash ports/unreal/TestHost/with-patter/build.sh --probes   # and show every case can fail
```

The combined proof on C++, the twin of the JS runtime's
`packages/runtime/test/with-patter/combined-game.test.ts`: Patterplay's C++
core and this one in ONE translation unit, on ONE `ScopeRegistry`, every case
of the JS test, run once per plugin's registry save helpers and once crossed.
It compiles Patterplay's source from a sibling `../patter` checkout (or
`PATTER_ROOT`), as the JS test does, and skips, saying so, when there is none.
Both plugins carry the shared kernel (`Storylets/Expr/`, `Patter/Expr/`); the
host checks at compile time that `storylets::ScopeRegistry` and
`patter::ScopeRegistry` are one type, then shows the kernel's tripwire: the
same translation unit with Patterplay's kernel restamped with another kernel
id must stop at the `#error` naming the fix, in either include order.
`--probes` runs five deliberate integration mistakes (two registries, a
registry never loaded, engines saving their own values, a rebuild in place of
a hot swap, a second engine on another registry) and fails unless every case
fails under at least one.

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
