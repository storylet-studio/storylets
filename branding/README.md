# Storylet Studio brand assets

Sibling system to PatterKit. Same construction discipline: one primitive, transformed,
never redrawn. Newsreader for wordmarks and headings, IBM Plex Mono for tags, extensions
and CLI. This folder is the source for every shipped icon, mark and wordmark: the apps,
the website and the runtimes all build from it.

## The mark

One **thread**: an S-path on a 100×100 grid, 12-unit stroke, round caps, three
9.5-radius beats at `88,12`, `50,50` and `12,88`. Three beats, not two: a trail
continues past the beat you are on, and the middle beat is what says so.

    M88 12 C5 12 5 50 50 50 C95 50 95 88 12 88

The outer beats set the extents, so the mark spans **2.5–97.5**, symmetric about centre.
It fills its box: never place a glyph inside it.

## The differentiation rule

Products do not get their own marks. The thread carries the whole ecosystem; a product is
the thread on **its own ground**, with a lowercase monospace tag in the bottom-right
corner. This is the rule PatterKit uses for its runtime plugins; here it runs
family-wide, so a new tool is a colour and a word, not a new drawing.

| Product | Ground | Tag |
| --- | --- | --- |
| Storylet Studio (umbrella) | cream `#F3EDE2`, plum thread | *none* |
| Storyletter (authoring) | plum `#36284A` | `author` |
| Storylet Engine (runtimes) | amber `#C8902F` | `play` |
| Storylets (CLI) | ink `#2A2431` | `cli` |

Below 48 px the tag is illegible, so drop it and ship the bare thread. The ground colour
still says which app it is.

## Palette

| | hex | use |
| --- | --- | --- |
| Plum | `#36284A` | primary ink |
| Plum Deep | `#241A33` | compiled / dark surfaces |
| Plum Mid | `#4A3866` | body copy, document folds |
| Plum Tint | `#9A89B5` | tags on dark |
| Amber | `#C8902F` | accent, beats |
| Amber Light | `#E0B463` | band highlight |
| Cream | `#F3EDE2` | ink and marks ON plum deep |
| Paper | `#FAF6EE` | documents |
| Ink | `#2A2431` | wordmark text |

Cream is no longer the light PAGE ground. Light surfaces, on the website and in Storyletter
alike, are Storyletter's default light theme, Chambray, whose blue-grey neutrals are listed
below; cream stays as the ink and mark colour on every plum-deep band, and as the umbrella
badge fill in the differentiation rule above. The reason is family legibility: PatterKit's
site takes its light neutrals from Patterpad's default Paper theme, and cream `#F3EDE2` sits
within a hair of that parchment `#F1EBE0`, so the two sites read as one. Warm is Patter's;
cool is ours.

| Chambray | hex | use |
| --- | --- | --- |
| Ground | `#E6EAEF` | the light page |
| Surface | `#F4F6F9` | panels, sidebars |
| Card | `#FBFCFE` | card faces, the top bar |
| Ink | `#161E28` | headings, strong text |
| Muted | `#4D5B6B` | secondary text |
| Line | `#C6CEDA` | hairlines |

Storyletter's own `theme.css` is the source of truth for those six; this table is a copy for
anyone working outside the app.

## Type

- **Newsreader** 400, 500, 600 and italic: wordmarks, headings, body.
  Wordmarks are 500 at 120 px, `letter-spacing: -2`.
- **IBM Plex Mono** 400 and 500: icon tags, file extensions, labels, CLI output.

**Every label in the SVGs is converted to curves.** No SVG here depends on a font being
installed. See `fonts/README.md` for which cuts the outlines came from and how to re-cut
a label.

This holds for **anything anyone downloads**, not just the SVGs in this folder: badges,
credit marks, press assets. A downloadable SVG carrying `<text>` and a `font-family`
renders in whatever the viewer happens to have, which for Newsreader usually means it
does not. Curves, always.

The HTML sources (the brand board and the social card, kept privately) are the exception, because they
are *sources* rather than downloads: they pull the two faces from Google Fonts and are
rendered to PNG. That makes their output silently dependent on the fonts arriving, so
every render recipe for them passes a virtual-time budget and the result is eyeballed
against the previous one before it replaces it.

## Layout

- **App and plugin icons:** 1024 square. Mark 600 px at `translate(196.21,196.21) scale(6.3158)`,
  landing on 212–812. Tag baseline `y=940`, right edge `x=934`.
- **Document icons:** 96×116 page, folded corner, monospace extension label at `y=99`.
- **Wordmarks:** mark at `translate(34,32) scale(1.52)`, text from `x=232`, baseline `y=150`.

## Contents

    marks/            thread (plum / reversed / mono / flat) + favicon
    icons/svg         four product icons + mono fallback
    icons/png         1024 PNG of each
    document-icons/   .storyletproj, the authored shards, .storyletsc, .storyletpack
                      svg, 1024 png, and 1024 square png (for OS icon slots)
    plugin-icons/     Storylet Engine badges: Godot, Unreal, Unity, JavaScript
                      svg + 1024 png
    wordmarks/        Storylet Studio, Storyletter, Storylet Engine, Storylets
    fonts/            OFL licences + notes on the outlined type

## File extensions

The shipped set, as of 2026-08-02. A project is a FOLDER named `.storylets`
holding shards; the icons below are for the files inside it and the artefacts it
produces. Nothing in the artwork depends on the names except each SVG's `<title>`.

| ext | what | icon |
| --- | --- | --- |
| `.storylets` | project folder: the thing you open | `doc-storyletproj` |
| `.storyletproj` | the project shard inside it | `doc-storyletproj` |
| `.storyletbox` | a box: its card template, ranking, fields | `doc-storyletshard` |
| `.storyletdeck` | a deck of cards | `doc-storyletshard` |
| `.storylethands` | a box's hand templates and hands | `doc-storyletshard` |
| `.storylettags` | a box's tag groups and tags | `doc-storyletshard` |
| `.storyletsc` | compiled: drops into the engine | `doc-storyletsc` |
| `.storyletpack` | the send envelope: the whole project zipped into one file, for handing to someone without shared version control | `doc-storyletpack` |
| `.storyletsave` | a saved run, from the Board or a game | *none yet* |

The four authored shards share one icon: they are the same kind of thing to the
eye, and only the extension distinguishes them.

## Still to cut

- A document icon for `.storyletsave` (a saved run). The four cut so far cover
  the project, the authored shards, the compiled bundle and the send envelope.
- Rows (and Windows file/icon association at packaging time) for the two
  planned sidecars, `.storyletview` (canvas arrangement) and `.storyletnotes`
  (threaded comments), planned in design/graphical-views.md. Both are authored-shard-
  shaped, so they likely share `doc-storyletshard` rather than needing a cut.

`.icns` and `.ico` bundles, and the favicon PNG size set. Build them from the 1024 PNGs:

    # macOS
    mkdir icon.iconset && for s in 16 32 64 128 256 512; do
      sips -z $s $s icons/png/icon-storyletter-1024.png --out icon.iconset/icon_${s}x${s}.png
      sips -z $((s*2)) $((s*2)) icons/png/icon-storyletter-1024.png --out icon.iconset/icon_${s}x${s}@2x.png
    done && iconutil -c icns icon.iconset

    # Windows
    magick icons/png/icon-storyletter-1024.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
