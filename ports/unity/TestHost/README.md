# Unity TestHosts (maintainers)

Plain dotnet consoles that compile the same `Runtime/**/*.cs` the Unity package ships, so the
C# runtime is checkable in plain .NET (and CI) without a Unity install. Neither is part of the
shipped package; end users never need them. Both are pinned to C# 9 to stay Unity-safe.

## The Storylet Engine on its own

```sh
dotnet run --project ports/unity/TestHost
```

Replays the conformance corpus, the expr and registry corpora, the Live Link fixture and the
one-registry checks (`OneRegistry.cs`) through the runtime, and ends `ALL PASS` or `N FAILED`.
It compiles the Storylet Engine's own copy of the kernel (`Runtime/Expr`), as Unity does when
Patterplay is not installed.

## With Patter: one registry, one save

```sh
dotnet run --project ports/unity/TestHost/with-patter
dotnet run --project ports/unity/TestHost/with-patter -p:PatterDir=/path/to/patter
```

The combined proof on C#: a Patter engine and a Storylet Engine in one game, on ONE
`ScopeRegistry`, with one save `{ registry, patter, storylets }`. It is a port of
`packages/runtime/test/with-patter/combined-game.test.ts`, case for case, with the same content:
Patter reading `@story.act`, a storylet gated on a `@world` value a Patter scene wrote, the one
save loaded in either order, content drift and a Patter hot swap on the same registry, and token
clashes naming the holder, and a card naming `@patter` directly followed by a Storylet
Engine hot swap on the shared registry. Each case runs twice, the game saving its registry through
Patterplay's `PatterSave` and then through the Storylet Engine's `StoryletSave`, and a last case
reads one's output with the other.

`with-patter/WithPatter.csproj` compiles this repo's Storylet Engine (Runtime and Json layers),
Patterplay's from the SOURCE of a sibling `../patter` checkout, and exactly one kernel:
Patterplay's `Runtime/Expr`. The Storylet Engine's own kernel and its `ExprSkew` assembly are
left out, as Unity leaves them out when Patterplay 0.14.0 or newer is installed beside it.

It prints an `ok` or `FAIL` line per case and ends `WITH PATTER ALL PASS` (exit 0) or
`WITH PATTER N FAILED` (exit 1). With no Patter checkout it compiles nothing but `Skip.cs`, prints
`SKIP with-patter: ...` and exits 0, so a plain clone of this repo is not broken by a proof it
cannot run. Set `REQUIRE_PATTER=1` to make that a failure instead; CI does, because a skip there
would be a green that proved nothing.

`CombinedGame.cs` is also compiled, unchanged, into a real Unity project holding both packages by
`scripts/check-unity-with-patter.sh`, which is the evidence for the Unity side (asmdefs, the
Storylet Engine's kernel switching itself off, a player build). The dotnet host cannot see any of
that: it compiles sources, not packages.
