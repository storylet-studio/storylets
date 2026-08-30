# Contributing to Storylet Studio

Thanks for looking. This is young and moving quickly, so before building anything substantial,
please open an issue first: it may already be underway, or there may be a design reason it
looks the way it does.

## Getting set up

```sh
git clone https://github.com/storylet-studio/storylets.git
cd storylets
npm install
npm test               # the full suite, including the cross-runtime conformance corpus
npm run typecheck
```

That is all of it. A plain clone runs everything against the published `@wildwinter/expr`
expression-engine packages.

If you are working on the expression engine itself, clone
[wildwinter/expr](https://github.com/wildwinter/expr) as a **sibling** of this repo (`../expr`).
The tsconfig paths and vitest aliases prefer its source automatically when that checkout exists.

### Running Storyletter from source

```sh
npm run studio         # launches the editor in dev mode (electron-vite)
```

### The website

```sh
npm run website        # dev server
npm run test:website   # the build, which is the gate CI runs
```

Two things `npm run website` cannot show you: Pagefind search only exists in a build, and a
diagram with a blank line inside its `<svg>` renders correctly in dev and breaks in the built
page. `website/README.md` has the detail.

### The port suites

None of the engines are on `$PATH`, so `which godot` finding nothing means nothing.

```sh
ports/unreal/TestHost/build.sh                 # Unreal, via clang: no Unreal install needed
cd ports/unity/TestHost && dotnet run           # Unity: the standalone corpus host
# Godot: see ports/godot/README.md for the import step and all five scripts
```

## The shape of the repo

- `packages/` - the `@storylet-studio/*` workspaces, layered bottom-up (`model` -> `dialect` ->
  `compiler` -> `runtime` -> `ops` -> `cli` / `studio`). See the README table.
- `ports/` - the native Storylet Engine runtimes (Unity C#, Unreal C++, Godot GDScript). Each
  must pass `packages/conformance/corpus.json`, the cross-language parity contract. If you
  change runtime behaviour, the corpus and all four runtimes move together.
- `website/` - the [storylet.studio](https://storylet.studio) docs (Astro + Starlight).
- `examples/` - worked example projects the app ships and the docs teach from.

## House rules

- **Contract first.** New engine behaviour lands in the conformance corpus, with hand-written
  expectations, **before** any implementation. This is the rule that keeps four runtimes in
  agreement, and it is not negotiable: a corpus case written after the code tends to describe
  what the code does rather than what was intended.
- **Tests are first-class.** New behaviour comes with tests, and `npm test` stays green.
- **Match the local style.** Look at the file you are editing and keep its idiom, naming and
  comment density.
- **Small PRs travel faster.** One change per PR, with a note on why.

## Releases (maintainers)

Tag-driven, and each family has its own workflow:

| Tag | Ships |
|---|---|
| `v*` | Storyletter, the desktop editor (bare `v*` tags are the editor's alone) |
| `cli-v*` | the standalone `storyletengine` CLI binaries |
| `play-<engine>-v*` | the four Storylet Engine runtimes |

The workflows refuse a tag that does not match the manifest it ships, so a mismatched tag fails
loudly rather than publishing the wrong version.

## Licence

MIT. By contributing, you agree your contributions are licensed under the same terms. See
[LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
