# Releasing

One repo, several deliverables, each on its own cadence and its own tag family. Everything
here is tag-triggered: push a tag, a workflow builds and publishes it.

**Read [CONTRIBUTING.md](CONTRIBUTING.md) first** for the repo's shape. This file is for
whoever is shipping.

## The tag families

| Tag | Ships | Workflow | State |
|---|---|---|---|
| `vX.Y.Z` | Storyletter, the desktop editor | `storyletter.yml` | built |
| `cli-vX.Y.Z` | the standalone `storyletengine` binaries | `cli.yml` | built |
| `play-<engine>-vX.Y.Z` | one of the four Storylet Engine runtimes | not written yet | see below |
| `village-vX.Y.Z` | the Village browser client | not written yet | see below |

**The seven `@storylet-studio/*` npm packages are deliberately not in that table.** They are
the one deliverable not driven by a tag: Changesets publishes them when it notices a change.
See "The npm packages" below.

**Bare `v*` tags belong to Storyletter alone, and this is load-bearing rather than tidiness.**
electron-builder's GitHub publisher can only target a `v<version>` tag, and electron-updater
walks the releases feed skipping any tag that is not plain semver, so `cli-v*` releases are
invisible to it. That is exactly what we want. Never give another deliverable a bare `v*` tag:
a non-Storyletter release would take GitHub's "Latest" badge, it would have no `latest.yml`,
and Check for Updates would then 404. Patterpad learned this the hard way.

## Before the first release

Five signing secrets must exist on the repo, or the macOS builds fail:

`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

Two more are optional and only affect CI, not releases: `UNITY_LICENSE` with `UNITY_EMAIL` and
`UNITY_PASSWORD`. Without them the Unity demo job skips itself with a notice rather than
failing, so a break there reaches a human by hand instead of going red.

## Storyletter: `vX.Y.Z`

1. Update `packages/studio/package.json`'s version.
2. Write the matching section in `packages/studio/CHANGELOG.md`, headed `## [X.Y.Z]`. **The
   workflow reads this section as the release notes and fails if it is missing**, which is
   deliberate: a release with no notes is not finished.
3. Tag and push:

   ```sh
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

The pipeline runs three jobs:

- **`notes`** creates the release as a **draft**, with that changelog section as its body.
- **`build`** runs the OS matrix, checks the tag matches the app version (a mismatch fails
  here rather than publishing the wrong thing), then builds, signs, notarises and uploads the
  installers plus the updater feeds (`latest-mac.yml`, `latest.yml`, `latest-linux.yml`).
- **`publish`** flips the draft live once every OS has uploaded.

The draft is a staging area, so a half-built release is never visible. If one OS fails, fix it
and re-run: the draft is still there and electron-builder reuses a draft whose tag matches.

## The CLI: `cli-vX.Y.Z`

```sh
git tag cli-vX.Y.Z && git push origin cli-vX.Y.Z
```

Two jobs: macOS builds and signs the two Darwin binaries, Ubuntu cross-compiles the Linux and
Windows ones, and both upload to the release for that tag. The CLI bundle inlines the
expression engine's source, so both jobs check out `@wildwinter/expr` alongside.

## The npm packages: not set up yet, and here is the plan

Seven packages are publishable and **none is published**. The scope is unclaimed.

| Publishable | Private, never published |
|---|---|
| `model`, `dialect`, `compiler`, `runtime`, `ops`, `cli`, `play-helpers` | `conformance`, `studio`, `village-client` |

That split already matches Patter's (its eight, minus a `core` layer we do not have as a
separate package). Only the machinery is missing: no `.changeset` directory, no
`@changesets/cli`, no `release.yml`.

**The npm libraries are the one deliverable NOT driven by a tag.** Everything above ships
because you pushed a tag; the packages ship because Changesets noticed a change. Keeping that
distinction is the point of the arrangement rather than an accident of it.

### How it works, once it is set up

`release.yml` runs on **every push to main** and hands to `changesets/action`, which does one
of two things:

- Changesets are pending, so it opens or updates a **"Version Packages" PR** that consumes
  them, bumps the versions and writes the changelogs.
- That PR has just been merged, so it builds and publishes the bumped packages.

There is no publish tag and no manual version bump. The obligation on ordinary work is one
command beside it:

```sh
npm run changeset      # describe the change and which packages it affects
```

**A change to a published package that ships without a changeset publishes nothing at all.**
That is the failure mode to watch for, and it is silent.

### Authentication: no npm token, anywhere

Publish over **npm trusted publishing (OIDC)**. Each package trusts this repo and this specific
workflow file on npmjs.com, so no secret is stored and provenance is attested automatically.
The job needs `id-token: write`, and an OIDC-aware npm.

**Pin npm to the 11.x line.** npm 12.0.0 ships a broken provenance path
(`Cannot find module 'sigstore'`, npm/cli#9722) which aborts every publish once `@latest` rolls
over to it. Patter hit this.

### The lockstep pair and a model bump

`@storylet-studio/runtime` and `@storylet-studio/play-helpers` depend on `@storylet-studio/model`
through the wide range `>=0.1.0 <1.0.0`, not a caret, so a model MINOR does not cascade a patch
bump into them: their versions are the four runtimes' version and come only from `npm run
bump:play`. A caret let the first Version Packages PR (2026-09-04) propose runtime 0.4.1 with an
empty changelog, which the lockstep forbids. Patter's `packages/runtime` carries the same range
for the same reason. Their other internal dependencies are caret ranges, which patch bumps stay
inside, and the exact pin of the helpers on the runtime is rewritten by `bump:play`.

### Three settings that are not optional

- **Allow GitHub Actions to create and approve pull requests**, under Settings > Actions >
  General > Workflow permissions. The changesets action opens the Version Packages PR, and
  without this the first changeset fails the Release run with "GitHub Actions is not permitted
  to create or approve pull requests" (2026-09-04, the model's `writable` changeset).

- **`createGithubReleases: false`** in the changesets action. Its default creates an empty
  GitHub Release per published package, and those releases take GitHub's "Latest" badge. That
  badge is what electron-updater reads, so a package release becoming "Latest" leaves Check for
  Updates fetching a release with no `latest.yml`, which 404s. This is the same hazard the tag
  families section describes, arriving by a different route. Patterpad broke this way.
- **An `ignore` list** covering `@storylet-studio/studio` and `@storylet-studio/village-client`.
  They are `private: true` so they will never publish, but `ignore` also stops Changesets
  bumping their versions, and both are versioned by their own tag families instead.

A starting `.changeset/config.json`, from Patter's with our names:

```json
{
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["@storylet-studio/studio", "@storylet-studio/village-client"]
}
```

### The first publish needs hand-work on the registry

This is the part that is not "copy the workflow across", and it is worth knowing before
committing to the approach.

**Trusted publishing must be registered per package on npmjs.com before that package's first
publish**, or its publish step fails to authenticate. With seven unpublished packages that is
seven registrations, done by hand, and none of them can happen until the public repo exists to
point them at. So this lands **after** the split, not before it.

Until then the scope is unclaimed, which is worth a thought of its own: the first publish is
what claims `@storylet-studio` on the registry.

## Not built yet

These are written down so nobody has to rediscover them.

- **The four runtime workflows (`play-<engine>-v*`).** `ports.yml` today is a CI gate only:
  it runs the corpus against Godot, the Unity C# runtime and the Unreal C++ core on every push,
  and releases nothing. The release half lands with the public repo. Until a family has tagged
  once, its card on the Downloads page reads "coming soon", which is why the page can ship
  before the workflows do.
- **The Village client (`village-v*`).** Built, tested and gated, waiting on the same thing.

## Checking a release afterwards

- The release exists, is not a draft, and carries every OS's installers.
- For a `v*` release only: `latest-mac.yml`, `latest.yml` and `latest-linux.yml` are attached.
  Without them Check for Updates cannot work.
- GitHub's "Latest" badge is on the Storyletter release, not on a `cli-v*` one.

**npm caches package metadata**, so if you ever do publish to the registry, a plain `npm view`
can report the version you just replaced for a few minutes afterwards. Use `--prefer-online`
when checking by hand. This has twice made a successful publish look like a failed one on the
Patter side.
