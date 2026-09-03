# Changelog

The Hamlet client is released by tagging `hamlet-vX.Y.Z`, which builds it and
attaches one zip to the matching GitHub Release, with `make_latest: false` so
it never takes Storyletter's Latest badge from electron-updater. The release
job reads the section for the tagged version out of this file.

## [Unreleased]

### Added

- **The joint demo.** The Storylet Engine choosing the beat, Patter performing
  it, one host, one `@world` resolver handed to both, one save that restores
  both engines and a scene paused mid-choice. The handoff is by name and
  validated in the build. Seventeen cards, seventeen stub scenes.
