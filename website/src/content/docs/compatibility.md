---
title: Compatibility & conformance
description: How the same project plays identically on every runtime - one bundle schema as the contract, one shared test suite every runtime passes, and the handful of per-engine differences.
sidebar:
  label: Compatibility & conformance
---

"What your designers saw is what your players get" is only worth something if it's actually
*true*. There's one versioned contract, and one shared set of tests every runtime has to
pass, so this is something you can check, not something you hope for.

<svg viewBox="0 0 760 288" role="img" aria-labelledby="sy-compat-title" style="width:100%;height:auto;font-family:var(--sl-font,sans-serif)">
  <title id="sy-compat-title">One .storyletsc bundle loads into each Storylet Engine runtime (JavaScript, Unity, Unreal, Godot); every runtime is checked against the same shared test suite on each release, so a project behaves the same wherever it runs.</title>
  <defs>
    <marker id="sy-c-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--sl-color-gray-3)"/></marker>
  </defs>
  <rect x="306" y="16" width="148" height="44" rx="8" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 14%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
  <text x="380" y="37" text-anchor="middle" fill="var(--sl-color-white)" font-family="var(--sl-font-mono,monospace)" font-size="13">.storyletsc</text>
  <text x="380" y="52" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10">one schema: storylets/bundle@N</text>
  <g stroke="var(--sl-color-gray-3)" fill="none">
    <path d="M380 60 V84 H130 V102" marker-end="url(#sy-c-arrow)"/>
    <path d="M380 60 V84 H290 V102" marker-end="url(#sy-c-arrow)"/>
    <path d="M380 60 V84 H450 V102" marker-end="url(#sy-c-arrow)"/>
    <path d="M380 60 V84 H610 V102" marker-end="url(#sy-c-arrow)"/>
  </g>
  <g font-size="12.5" text-anchor="middle" fill="var(--sl-color-white)">
    <rect x="60" y="104" width="140" height="40" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><rect x="60" y="104" width="140" height="3" rx="1.5" fill="var(--sy-plum-tint,#9a89b5)"/><text x="130" y="129">JavaScript</text>
    <rect x="220" y="104" width="140" height="40" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><rect x="220" y="104" width="140" height="3" rx="1.5" fill="var(--sy-plum-tint,#9a89b5)"/><text x="290" y="129">Unity</text>
    <rect x="380" y="104" width="140" height="40" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><rect x="380" y="104" width="140" height="3" rx="1.5" fill="var(--sy-plum-tint,#9a89b5)"/><text x="450" y="129">Unreal</text>
    <rect x="540" y="104" width="140" height="40" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><rect x="540" y="104" width="140" height="3" rx="1.5" fill="var(--sy-plum-tint,#9a89b5)"/><text x="610" y="129">Godot</text>
  </g>
  <g stroke="var(--sl-color-gray-3)" fill="none">
    <path d="M130 144 V172 H380"/>
    <path d="M290 144 V172 H380"/>
    <path d="M450 144 V172 H380"/>
    <path d="M610 144 V172 H380"/>
    <path d="M380 172 V194" marker-end="url(#sy-c-arrow)"/>
  </g>
  <rect x="230" y="196" width="300" height="46" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sy-plum-mid,#4a3866)"/>
  <rect x="230" y="196" width="300" height="3" rx="1.5" fill="var(--sy-plum-mid,#4a3866)"/>
  <text x="380" y="217" text-anchor="middle" fill="var(--sl-color-white)" font-size="12.5">one shared test suite</text>
  <text x="380" y="233" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5">the same cases, checked on every release</text>
  <text x="380" y="270" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11.5">The same language-neutral cases, pinned so a conforming runtime reproduces them exactly.</text>
</svg>

## The bundle schema is the contract

A compiled [bundle](/format/bundle/) declares a **schema version** (`storylets/bundle@N`). A
runtime plays any bundle whose schema it supports. That version is the one thing that cuts
across everything: bumping it is the one change that moves every runtime together. Each
runtime, the editor and the CLI otherwise version on their own.

| Runtime | Ships as | Get it |
|---|---|---|
| **Storylet Engine JS** | Release zip: `@storylet-studio/runtime`, `@storylet-studio/play-helpers` and a browser drop-in | [Download](/download/) |
| **Storylet Engine Unity** | Release zip: the package folder and a demo project | [Download](/download/) |
| **Storylet Engine Unreal** | Release zip: the plugin folder and a demo project | [Download](/download/) |
| **Storylet Engine Godot** | Release zip: the addon folder | [Download](/download/) |
| **`storyletengine` CLI** | Standalone binaries, one per platform | [Download](/download/) |

## The shared test suite

Every runtime is checked against **one shared suite**: a single language-neutral set of cases
that pins the exact behaviour a conforming engine must produce. It covers:

- **Expressions**: the evaluator, the expression dialect, and the seeded random-number
  generator, giving identical results everywhere.
- **Specificity**: the score that decides which of two matching cards asked for more.
- **Peeks**: a peek returns an exact ordered list, and peeking twice returns the same list,
  because a peek changes nothing.
- **Whole runs**: dealing, the board, playing outcomes, state writes, turns and cooldowns,
  save and load round-trips, and reset.

Each runtime ships a small test host that replays those cases in its own language and checks
it gets the same answers, down to the random draws. Runs are seeded, so "the same seed deals
the same cards" holds across JavaScript, C#, C++ and GDScript alike. The suite runs on every
release, and a release doesn't go out on a runtime that fails it.

Saving is part of the contract too. Loading a save made against **edited** content is checked:
state belonging to something that no longer exists drops harmlessly, never a crash.

## Per-engine differences

Every runtime carries the same API and the same [dev tools](/play/dev-tools/). A few places
differ because the host language differs, and these are the only ones:

- **Godot has no exceptions.** Errors come back as values: `play()`, `load()` and
  `set_property()` return an error string. The state kernel's accessors are `get_value` and
  `set_value`, because `get` and `set` collide with Godot's own `Object` methods.
- **Unbounded slots** are the string `"unbounded"` in JavaScript and positive infinity in the
  native ports. Every engine has a label helper, so a view prints the same text either way.
- **Unreal Blueprint** gets typed property accessors instead of one generic value pin, and
  polls the flow's log instead of subscribing to a trace delegate. Both surfaces are
  available in full from C++.

## What this means for you

You ship on one engine. That's why you can trust **that** engine: it plays your project
exactly as Storyletter's [Board](/storyletter/board/) does, the same cards in the same order,
the same conditions, the same saves, right down to the random draws. There's no "works in the
editor, behaves differently in my game" gap to chase.

It isn't "should match". It's checked, case by case, on every release.

→ Back to [Playing in your game](/play/overview/).
