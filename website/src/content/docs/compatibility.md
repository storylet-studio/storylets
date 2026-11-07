---
title: Compatibility & conformance
description: One bundle schema and one shared test suite keep every runtime playing the same project identically, with the per-engine differences listed.
sidebar:
  label: Compatibility and conformance
---

"What your designers saw is what your players get" is only worth something if it's actually
*true*. There's one versioned contract, and one shared set of tests every runtime has to
pass, so this is something you can check, not something you hope for.

<svg viewBox="0 0 760 288" role="img" aria-labelledby="sy-compat-title" style="width:100%;height:auto;font-family:var(--sl-font,sans-serif)">
  <title id="sy-compat-title">One .storyletsc bundle loads into each Storylet Engine runtime (JavaScript, Unity, Unreal, Godot); every runtime is checked against the same shared test suite on each release, so a project behaves the same wherever it runs.</title>
  <defs>
    <marker id="sy-c-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--sl-color-gray-3)"/></marker>
  </defs>
  <rect x="280" y="16" width="200" height="44" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
  <text x="380" y="37" text-anchor="middle" fill="var(--sl-color-white)" font-family="var(--sl-font-mono,monospace)" font-size="13">.storyletsc</text>
  <text x="380" y="52" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10">one schema: storylets/bundle@N</text>
  <g stroke="var(--sl-color-gray-3)" fill="none">
    <path d="M380 60 V84 H130 V102" marker-end="url(#sy-c-arrow)"/>
    <path d="M380 60 V84 H290 V102" marker-end="url(#sy-c-arrow)"/>
    <path d="M380 60 V84 H450 V102" marker-end="url(#sy-c-arrow)"/>
    <path d="M380 60 V84 H610 V102" marker-end="url(#sy-c-arrow)"/>
  </g>
  <g font-size="12.5" text-anchor="middle" fill="var(--sl-color-white)">
    <rect x="60" y="104" width="140" height="40" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="130" y="129">JavaScript</text>
    <rect x="220" y="104" width="140" height="40" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="290" y="129">Unity</text>
    <rect x="380" y="104" width="140" height="40" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="450" y="129">Unreal</text>
    <rect x="540" y="104" width="140" height="40" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="610" y="129">Godot</text>
  </g>
  <g stroke="var(--sl-color-gray-3)" fill="none">
    <path d="M130 144 V172 H380"/>
    <path d="M290 144 V172 H380"/>
    <path d="M450 144 V172 H380"/>
    <path d="M610 144 V172 H380"/>
    <path d="M380 172 V194" marker-end="url(#sy-c-arrow)"/>
  </g>
  <rect x="230" y="196" width="300" height="46" rx="6" fill="color-mix(in oklab, var(--sl-color-accent) 8%, var(--sl-color-bg-sidebar))" stroke="var(--sl-color-accent)"/>
  <text x="380" y="217" text-anchor="middle" fill="var(--sl-color-white)" font-size="12.5">one shared test suite</text>
  <text x="380" y="233" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5">the same cases, checked on every release</text>
  <text x="380" y="270" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11.5">The same language-neutral cases, pinned so a conforming runtime reproduces them exactly.</text>
</svg>

## The bundle schema is the contract

A compiled [bundle](/format/bundle/) declares a **schema version** (`storylets/bundle@N`). A
runtime plays any bundle whose schema it supports and refuses any other by name. The current
runtimes read `storylets/bundle@2`, the bundle whose game scopes are `scopeRegistry`, and the
earlier `@1` and `@0`. That version is the one thing that cuts across everything, because
bumping it is the one change that moves every runtime together. How the rest is numbered is
below, in [Versions and compatibility](#versions-and-compatibility).

| Runtime | Ships as | Get it |
|---|---|---|
| **Storylet Engine JS** | Release zip: `@storylet-studio/runtime`, `@storylet-studio/play-helpers`, and a browser drop-in | [Download](/download/) |
| **Storylet Engine Unity** | Release zip: the package folder and a demo project | [Download](/download/) |
| **Storylet Engine Unreal** | Release zip: the plugin folder and a demo project | [Download](/download/) |
| **Storylet Engine Godot** | Release zip: the addon folder | [Download](/download/) |
| **`storyletengine` CLI** | Standalone binaries, one per platform | [Download](/download/) |

## Versions and compatibility

The Storylet Engine is at 1.0: its shape has settled. From here every public package, runtime,
app and tool follows semantic versioning, with one meaning of "breaking" for all of them: a
change that means your game, your project or your build has to change before it works again.

- **A patch (1.0.x)** is fixes. Nothing that plays changes unless it was wrong.
- **A minor (1.x.0)** adds: new API, new format fields with defaults, new features. Everything
  that worked keeps working, unchanged.
- **A major (2.0.0)** removes something or changes what it means, all gathered into one
  release, with a migration guide and tooling. There's one when a break is worth it, not on a
  calendar.

What a minor may not break:

- **Bundles.** A bundle compiled by any 1.x Storyletter or CLI plays on the same or any later
  1.x runtime. The other way round isn't promised: a minor may add to the format, so compile
  with a Storyletter or CLI no newer than the runtime you ship. The [Download](/download/) page
  keeps them together.
- **Saves.** A save written by any 1.x runtime loads in any later 1.x runtime.
- **Projects.** A 1.x project opens in any later 1.x Storyletter, upgraded in place where a
  field has changed.
- **The public API** of all four runtimes: the JavaScript exports, Unity's public members,
  Unreal's Blueprint nodes and public C++, and Godot's methods and signals. A removal or a
  change of meaning waits for a major. A rename adds the new name and marks the old one
  deprecated in each runtime's own way, and the old name stays until the next major.
- **The expression kernel**, which the Storylet Engine shares with Patter: a kernel change is a
  major on every runtime that carries it.

Who shares a number:

- **The four Storylet Engine runtimes share one version** and move together, with
  `@storylet-studio/play-helpers` beside them. A feature lands in all four in one release, or
  in none. This is the version your game sees, and the one a tool checks with `versionInRange`.
- **The libraries** (`@storylet-studio/model`, `dialect` and `with-patter` on npm) have their
  own versions. **Storyletter, the CLI and the Hamlet** have theirs, and release whenever a
  library they carry moves, so a download never holds an older library than npm does.

Deprecated API in force: none at 1.0.0. [What's new](/whats-new/) lists each release.

## The shared test suite

Every runtime is checked against **one shared suite**, a single language-neutral set of cases
that pins the exact behaviour a conforming engine must produce. It covers:

- The evaluator, the expression dialect, and the seeded random-number generator give
  identical results everywhere.
- **Specificity**, the score that decides which of two matching cards asked for more, comes out
  the same.
- A peek returns an exact ordered list, and peeking twice returns the same list, because a
  peek changes nothing.
- **Whole runs** match, which covers dealing, the board, playing outcomes, state writes, turns,
  and cooldowns, save and load round-trips, and reset.

Each runtime ships a small test host that replays those cases in its own language and checks
it gets the same answers, down to the random draws. Runs are seeded, so "the same seed deals
the same cards" holds across JavaScript, C#, C++, and GDScript alike. The suite runs on every
release, and a release doesn't go out on a runtime that fails it.

Saving is part of the contract too. Loading a save made against **edited** content is checked,
so state belonging to something that no longer exists drops harmlessly, never a crash.

## Per-engine differences

Every runtime carries the same API and the same [dev tools](/play/dev-tools/). A few places
differ because the host language differs, and these are the only ones.

**Godot** has no exceptions, so errors come back as values. `play()` and `set_property()`
return an error string. `StoryletEngine.create()` returns `null` for a bundle it refuses, and
`load_game()` returns an empty report, both with a `push_error`. The state kernel's accessors are `get_value` and
`set_value`, because `get` and `set` collide with Godot's own `Object` methods.

**Unbounded slots** are the string `"unbounded"` in JavaScript and positive infinity in the
native ports. Every engine has a label helper, so a view prints the same text either way.

**Unreal Blueprint** gets typed property accessors instead of one generic value pin, and
hears the trace through the engine's `OnTrace` event rather than a per-flow subscription. Both
surfaces are available in full from C++.

## What this means for you

You ship on one engine. That's why you can trust **that** engine. It plays your project
exactly as Storyletter's [Board](/storyletter/board/) does, the same cards in the same order,
the same conditions, the same saves, right down to the random draws. There's no "works in the
editor, behaves differently in my game" gap to chase.

It isn't "should match". It's checked, case by case, on every release. The per-engine guides
themselves start from [Playing in your game](/play/overview/).
