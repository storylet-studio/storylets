# Third-party notices

Storylet Studio is licensed under the MIT License (see [`LICENSE`](./LICENSE)). It ships with, or
builds on, the third-party components below. Each is used under its own licence.

Audited 2026-08-30 against the resolved dependency trees and the three engine ports. Section 6
says how to reproduce the audit rather than trusting this file.

## 1. Runtime ports

- **Json.NET (Newtonsoft.Json)** - the Unity package
  (`com.storylet-studio.storyletengine`) depends on Unity's
  `com.unity.nuget.newtonsoft-json` (3.2.1) for bundle and save parsing. MIT License,
  (c) James Newton-King. Full text:
  <https://github.com/JamesNK/Newtonsoft.Json/blob/master/LICENSE.md>. The library is
  delivered by the Unity Package Manager, not bundled inside the Storylet Engine zip.

- **The Unreal plugin has no third-party dependency.** It uses only Unreal Engine's own
  modules (`Core`, `CoreUObject`, `Engine`, `Json`, `Slate`, `SlateCore`, `InputCore`,
  `UnrealEd`, `PropertyEditor`, `DesktopPlatform`, `ApplicationCore`, and `WebSockets`
  outside Shipping builds). Those are Epic's, delivered with the engine, and are not
  redistributed here.

- **The Godot addon has no third-party dependency.** It is pure GDScript.

- **The JavaScript runtime has no third-party dependency** beyond three small MIT packages by
  the same author: `@wildwinter/expr`, `@wildwinter/expr-specificity` and
  `@wildwinter/scoperegistry`.

Each of the three engine ports carries a copy of the MIT `LICENSE` inside its own package.

## 2. Bundled npm dependencies

The CLI and Storyletter resolve to **99 production packages**. All are permissive: 76 MIT, 12
ISC, 2 Apache-2.0, 2 BSD-3-Clause, 2 MIT/X11, 1 Unlicense, plus the mixed and dual licences
called out below. Nothing copyleft is redistributed.

The direct ones worth naming:

- **Electron** - the desktop app shell for Storyletter (MIT).
- **Konva** - the map and node canvases (MIT).
- **ws** - the Live Link websocket server (MIT).
- **json5** - reading the source shard format (MIT).
- **ExcelJS** - the spreadsheet export in `@storylet-studio/ops` (MIT).
- **JSZip** - reading and writing `.storyletpack` archives (see the dual licence below).
- **`@wildwinter/app-shell`, `@wildwinter/expr`, `@wildwinter/expr-editor`,
  `@wildwinter/expr-specificity`, `@wildwinter/scoperegistry`,
  `@wildwinter/simple-vc-lib`** - the shared editor shell, the expression language and the
  version-control layer, all MIT and by the same author.

Three entries in that tree are not plain MIT and are recorded here deliberately:

- **JSZip** is dual-licensed **(MIT OR GPL-3.0-or-later)**. It is used here **under the MIT
  option**, which its licence expressly offers.
- **pako** is **(MIT AND Zlib)**, both permissive. It arrives under JSZip.
- **big-integer** is released under the **Unlicense** (public domain dedication). It arrives
  under ExcelJS.

Also present and permissive: `crc-32` and `readdir-glob` (Apache-2.0), `duplexer2` and
`ieee754` (BSD-3-Clause), `chainsaw` and `traverse` (MIT/X11), and twelve ISC packages.

### One package declares no licence

**`buffers@0.1.1`** (c) James Halliday, states no licence: there is no `license` field in its
`package.json`, no licence file in the package, and no licence sentence in its README. It is a
transitive dependency four levels down, reached only as
`@storylet-studio/ops -> exceljs -> unzipper -> binary -> buffers`, and it ships inside
Storyletter and the CLI because ExcelJS loads `unzipper` on import.

This is recorded rather than resolved. It is flagged here so it is a known, stated fact rather
than something a reader discovers for themselves.

## 3. The documentation website

The site is built with **Astro**, **Starlight** and **Pagefind** (all MIT) and deployed as
static files.

Its build-time tree is larger and less uniform than the app's: it includes **`lightningcss`**
(MPL-2.0) and the **`@img/sharp-libvips-*`** binaries (LGPL-3.0-or-later), among 460 packages.
**None of these is redistributed.** They are tools that run on a build machine and produce
static HTML, CSS and images; no part of them is copied into what the site serves, so their
copyleft terms attach to nothing we publish.

## 4. Fonts and the badge artwork

The brand's typefaces are **Newsreader** and **IBM Plex Mono**, both under the **SIL Open Font
License 1.1**. Their licence texts are at
[`branding/fonts/Newsreader-OFL.txt`](./branding/fonts/Newsreader-OFL.txt) and
[`branding/fonts/IBMPlexMono-OFL.txt`](./branding/fonts/IBMPlexMono-OFL.txt).

**No font binary is stored in this repository and none ships in any build.** All type in the
marks, icons and badges is converted to outlines, so nothing needs a font installed to render.

The badge and icon labels are cut from **IBM Plex Mono Medium** at build time by
`scripts/make-badges.mjs`, which reads the face from the `@fontsource/ibm-plex-mono` package
using `fontkit` and emits outlines. The resulting SVG and PNG badges, distributed in the badge
kit, therefore contain artwork derived from an OFL font. The OFL permits this: the outlines
are not a font, are not sold as one, and carry no reserved font name.

## 5. Reproducing this audit

```sh
# every production package and its licence, from the lockfile
npm ls --omit=dev --all

# the same for the website, which has its own lockfile
cd website && npm ls --omit=dev --all

# a full machine-generated report including transitive licences
npx license-checker --summary
```

The complete resolved trees, with every transitive dependency, are in `package-lock.json` and
`website/package-lock.json`.
