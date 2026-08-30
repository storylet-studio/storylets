# Changelog

All notable changes to **Storyletter**, the Storylets desktop editor, are documented here.
Storyletter is released by tagging `vX.Y.Z`, which drives `.github/workflows/storyletter.yml`:
its own pipeline, separate from the CLI's `cli-v*` tags and from the engine ports.

The release job reads the section for the tagged version out of this file and uses it as the
GitHub Release notes, and it FAILS if there is no dated section matching the tag. So a heading
here is part of shipping, not a courtesy.

## [Unreleased]

### Added

- **Packaging.** electron-builder configuration, the macOS and Windows icon pipelines, hardened
  runtime entitlements, and a tag-driven release workflow, all following Patterpad's shape
  (`design/release-shape.md`). macOS builds are signed and notarised; Windows is deliberately
  unsigned, because a signed Windows build writes its publisher into `app-update.yml` and every
  auto-update then fails verification.
- **File associations.** On macOS a `.storylets` project is a PACKAGE, so Finder opens it as one
  document rather than a folder to wander into; `.storyletsc` and `.storyletpack` get their own
  document icons. On Windows and Linux, where there is no package concept, the `.storyletproj`
  file inside the folder is associated instead, along with the shard types.
