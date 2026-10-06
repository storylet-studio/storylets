# @storylet-studio/conformance

The storylets **parity contract**: a language-agnostic JSON corpus that
every runtime - the JS reference (`@storylet-studio/runtime`), each engine
port (Godot / Unity / Unreal) and the online server - must pass. New engine
behaviour lands here as a case first, then in the implementations
(contract-first; the founding rule of the workshop).

## The corpus

[`corpus.json`](./corpus.json) (`version: 13`) is the portable artifact. It
carries **compiled** forms only (`{ src, ast }` envelopes, whole bundles),
so a runtime-only port consumes it with no parser or compiler. Five case
kinds - `expressions`, `specificity`, `peek`, `scripted`, `load` - specified in
[the compatibility contract](https://storylets.dev/compatibility/), with the
dealing semantics they pin in
[the bundle format](https://storylets.dev/format/bundle/).

A `load` case is a bundle the engine must **refuse at construction**: the
runner builds an engine from `bundle`, construction must fail through the
runtime's own refusal channel (JS, C# and C++ throw; Godot's `create`
returns null with `push_error`), and the refusal must contain every string in
`expectRefused`. Nothing else runs. Version 10 added it, with the project map:
bundles that carry `map` (the project's zone group) or a box's `usesMap` are
written at schema `storylets/bundle@1`, every other bundle stays at `@0`, so
the corpus holds both tags a runtime must accept.

Version 11 made a save history-independent: a scripted `saveLoad` may carry
`expectSameBytes`, and then the envelope saved before the load must equal,
byte for byte, what the freshly loaded engine saves straight after (each
runtime's own serialised save text). `parkFlow` may carry `keepOpen`, which
takes the blob without closing the flow, so the `resumeFlow` after it
replaces a live flow in place.

Version 12 is the engine review of 2026-10-06: a peek consumes no draws, a
play is all-or-nothing, a shared one-shot another flow has taken is evicted
with the reason `taken`, a seated card whose deck moved to another box is
evicted as `vanished`, and a NaN priority is not dealt, beside pins for the
behaviour the JS reference already had (value-to-text, the `$` grammars, seeds
past 2^63, integer-like flow ids, `peek` capped at `null`, the draw count of a
deal). Two runner obligations are new: a peek op's `n` may be JSON `null`,
which is a cap distinct from an absent one and must be passed through, and
every flow a `saveLoad` rebuilds is subscribed to the trace sink as a lazily
opened flow is, so a deal after the load can pin its evictions.

Version 13 is durable state as a feature (ruling H, 2026-10-06), with four new
scripted ops a runner must implement. `keepPocket` takes `flow.saveDurable()`
on the op's flow and keeps it under the flow's name; `keepMemory` takes
`engine.saveDurable()` and keeps it once. Both are held outside the engine, and
the runner checks every half it keeps carries `schema: "storylets/durable@1"`
and the running bundle's `content`, then the op's `expect`: `values` compared
whole and in any key order, `spent` exactly. `newRun` replaces the engine with a
fresh one (from `bundleB` with `into: "B"`), drops every handle, and, if a memory
was kept, calls `loadDurable(memory)` and checks `expectReport` as `saveLoad`
does. `openFlowDurable` opens the named flow with `{ durable: <its pocket> }`,
re-takes and watches the handle, and checks the report `onRestoreReport` was
handed (one must arrive); with `withRestore` it passes the blob parked under that
name as `restore` too, and `expectError` requires the open to be refused with the
flow already open under that name left live. The card and deck fixtures gained
`durable`.

## PRNG

Seeded cases pin **mulberry32** (schema doc 3.3): default seed 0,
`random(a, b)` inclusive, Fisher-Yates descending. Anchor values a port can
verify first are tabled in the design notes, section 3.

## Working on it

- Fixtures are authored in [`src/cases.ts`](./src/cases.ts) as **source**
  with **hand-authored** expectations - the expectations are the contract,
  never derived from an engine (PRNG-dependent ones are computed from the
  pinned algorithm and marked `PRNG-computed`). `src/cases.ts` is the live
  contract - 205 cases (10 expressions, 8 specificity, 34 peek, 147 scripted,
  6 load);
  the design notes' sections 1-5 specify the shapes, and its section 6 listing
  is the round-1 draft, awaiting re-transcription.
- `buildCorpus` (in [`src/build.ts`](./src/build.ts)) compiles fixtures to
  `corpus.json`. The test builds the corpus, sanity-checks its internal
  references, and file-snapshots the artifact. After changing fixtures,
  regenerate and review:

  ```
  npx vitest run packages/conformance -u
  ```

- The reference runners ([`src/runner.ts`](./src/runner.ts): one per case
  kind, replaying every case through `@storylet-studio/runtime`) are the
  model each port re-implements in its own language and drives from
  `corpus.json`.

## The Live Link fixture

[`live-link/`](./live-link/) is the contract for the Live Link client
([Live Link](https://storylets.dev/play/live-link/)): the game-side WebSocket client every runtime carries
(`createLiveLink` in play-helpers, `StoryletLiveLink` in Unity and Godot,
`FStoryletLiveLink` in Unreal). The corpus does not test the clients
(network); this fixture does, and it is how the four stay in step. It is
GENERATED by the JS client's own test
(`packages/play-helpers/test/live-link-fixture.test.ts`) so it cannot drift
from the reference; a port that disagrees is wrong by definition, as with the
corpus. Regenerate and review after a deliberate change with:

```
npx vitest run packages/play-helpers/test/live-link-fixture.test.ts -u
```

- [`script.json`](./live-link/script.json): the scripted run. `bundle`
  is a repo-relative path to the compiled Hamlet bundle (the same copy every
  Board demo ships), `build` its `content.hash`, `project` the name the client
  is given, `seed` the run's seed, and `steps` the calls in order. Four steps
  are the harness's: `attach` (attach the ENGINE to the link), `open` (the
  fake socket opens: the client must now send `hello`), and `openFlow` /
  `closeFlow` (`flow`), which add and remove a participant so the client's
  own `flowOpen` / `flowClose` frames are exercised. The rest are FLOW calls
  by gameId: `dealMany` (optional `hands`), `deal`, `play` (`card`,
  `outcome`, `hand`), `advanceTurns` (`box`, `n`), `peek` (`box`, `criteria`,
  `n`). Each of those may carry a `flow` naming which participant runs it;
  absent means `"main"`, so the single-flow half of the script reads as it
  always did. The order attach-then-open is deliberate: it is the real
  order (a game attaches at boot and the socket opens a moment later), and it
  means the `hello` carries `boxes`.
- [`frames.json`](./live-link/frames.json): every frame the client must
  send for that script, in order, as a JSON array. It is pretty-printed for
  review; the contract is the COMPACT form (`JSON.stringify(frame)`, no
  whitespace), which must equal, byte for byte, the text the client put on
  the wire. Key order matters and is the reference's. Ignore nothing.

To replay it in a port's test host: load the bundle, create the link over a
fake socket that records every string sent, create an engine with the seed and
open the `main` flow,
run the steps, then compare the recorded strings with the compact form of
each entry in `frames.json`, in order, and fail on the first difference.
`trace` frames wrap the runtime's own TraceEvent verbatim, so a port's event
must serialise to exactly the reference's JSON for that call (same keys, same
order, same number formatting), and it must fire AFTER the state it reports
has landed: the `board` that follows a `deal`, `play`, `evict` or `turns`
event is the client reading the flow from inside the trace handler, and it
shows that event's effect.
