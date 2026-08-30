# Changelog

**The Village**, the playable browser client, released by tagging `village-vX.Y.Z`. Its own
family: not one of the four runtimes, and not versioned in lockstep with them, because it is a
worked example rather than a thing a game depends on.

The release workflow reads the section for the tagged version out of this file and uses it as
the release notes, and refuses a tag with no dated section for it.

## [Unreleased]

## [0.1.0] - 2026-08-30

The first release, alongside the toolkit going public.

### Added

- **The Village as a playable browser game.** The full 86-card example: five drawn regions,
  thirteen places, and a hand dealt wherever you stand. Click a place, read a card, play an
  outcome, watch the world change around you.
- **The map is the interface.** Each region is its own picture with its places marked on it, and
  a place carrying something to do wears a count. Playing a card in one place can light up two
  others, which is the storylet model made visible rather than described.
- **The real runtime, unmodified.** It plays the same compiled `.storyletsc` bundle a shipped
  game would, through `@storylet-studio/runtime`, with no engine-side special cases. That is
  the point of it: it is evidence the API is usable, not a bespoke demo.
- **A journal and a state panel**, so a reader can see what a play wrote to `@story` and why a
  card became available.

### The distribution

Two deliveries from one build, which is why they are described together:

- **Playable at [storylet.studio/village/](https://storylet.studio/village/)**, deployed with
  the documentation site. Most people will meet it as a link.
- **A zip**, for keeping and for reading: `dist/` to open and play offline, and `src/` to read.
  About 900 lines of framework-free TypeScript over the runtime's public API.
