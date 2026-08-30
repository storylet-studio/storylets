---
title: Licensing
description: What is MIT-licensed and open, what is not, and who owns your content and your saves.
sidebar:
  label: Licensing
---

## MIT and open

Everything you need to design storylets and ship them in a game:

- the model, the compiler and the runtime;
- the `storyletengine` CLI;
- **Storyletter**, the desktop editor;
- all four **Storylet Engine** runtimes, and the shared state kernel;
- the shared [conformance test suite](/compatibility/).

The repo is MIT-licensed, and every runtime zip carries its LICENSE.

## Third-party

### The runtimes

The Unity runtime takes one dependency, `com.unity.nuget.newtonsoft-json`
([Json.NET](https://www.newtonsoft.com/json), MIT). Unity's Package Manager delivers it; it
isn't bundled inside the zip.

The other runtimes have no third-party dependency. The Unreal plugin uses only Unreal's own
modules, the Godot addon is pure GDScript, and the JavaScript runtime depends only on small
MIT-licensed expression and state packages by the same author. Each runtime zip carries its
LICENSE.

### Storyletter and the CLI

These resolve to 99 packages, all permissive: mostly MIT, with some ISC, Apache-2.0, BSD and
one public-domain dedication. Nothing copyleft is redistributed. The ones you'd recognise are
Electron, Konva, ExcelJS and JSZip.

Two are worth naming directly. **JSZip** is dual-licensed and is used here under its MIT
option. **`buffers@0.1.1`**, four levels down under ExcelJS, declares no licence at all: no
field, no file, no README line. It's listed rather than hidden.

### The website

Built with Astro, Starlight and Pagefind (MIT) and served as static files. Its build tools
include MPL and LGPL components; none is redistributed, because a build tool doesn't end up in
the HTML it produces.

### Fonts

The brand's typefaces are **Newsreader** and **IBM Plex Mono**, both under the SIL Open Font
Licence. No font binary is in the repo and none ships in a build: all type in the marks, icons
and badges is converted to outlines, so nothing needs a font installed to render.

The full audit, with every licence named and instructions for reproducing it, is in
[THIRD-PARTY-NOTICES.md](https://github.com/storylet-studio/storylets/blob/main/THIRD-PARTY-NOTICES.md).

## Not open

A hosted tier (accounts, a hosted project store, online editing, a server-side runtime) may
come later, and it won't be MIT. It will never fork the core: every online piece would be a
shell around the same MIT packages. Nothing of the kind exists today, and there's nothing to
sign up for.

## A credit is a favour, never a requirement

Nothing obliges you to credit anything. There's no attribution clause on a shipped game and
nothing checks. This section is the part that's a favour, and it genuinely helps: every
project using these tools is a set of real-world edge cases nobody would hit alone.

If a graphic doesn't fit, a line of text is plenty. Copy any of these; no approval needed.

For in-game credits or a readme:

```text
Story shaped with Storylet Studio - storylet.studio
```

As a credits block:

```text
NARRATIVE TOOLS
Story shaped with Storylet Studio
storylet.studio
```

For a website or itch.io footer:

```html
<a href="https://storylet.studio">Story shaped with Storylet Studio</a>
```

## Or use a badge

Scale them freely. Please don't recolour or redraw them.

**The badge** (360 × 112) suits credits screens, splash pages and press kits:

<div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start;margin:1rem 0;">
  <figure style="margin:0;">
    <img src="/badges/storylet-studio-badge-cream.svg" width="360" height="112" alt="Story shaped with Storylet Studio badge, cream colour way" style="display:block;border-radius:8px;" />
    <figcaption style="font-size:0.8rem;margin-top:0.3rem;"><a href="/badges/storylet-studio-badge-cream.svg">SVG</a> · <a href="/badges/storylet-studio-badge-cream.png">PNG</a></figcaption>
  </figure>
  <figure style="margin:0;">
    <img src="/badges/storylet-studio-badge-plum.svg" width="360" height="112" alt="Story shaped with Storylet Studio badge, deep plum colour way" style="display:block;border-radius:8px;" />
    <figcaption style="font-size:0.8rem;margin-top:0.3rem;"><a href="/badges/storylet-studio-badge-plum.svg">SVG</a> · <a href="/badges/storylet-studio-badge-plum.png">PNG</a></figcaption>
  </figure>
  <figure style="margin:0;">
    <img src="/badges/storylet-studio-badge-mono.svg" width="360" height="112" alt="Story shaped with Storylet Studio badge, one colour" style="display:block;border-radius:8px;" />
    <figcaption style="font-size:0.8rem;margin-top:0.3rem;"><a href="/badges/storylet-studio-badge-mono.svg">SVG</a> · <a href="/badges/storylet-studio-badge-mono.png">PNG</a></figcaption>
  </figure>
</div>

**The line** suits footers, itch.io pages and readmes:

<div style="display:flex;flex-direction:column;gap:0.8rem;align-items:flex-start;margin:1rem 0;">
  <figure style="margin:0;">
    <img src="/badges/storylet-studio-line-cream.svg" width="298" height="38" alt="Story shaped with Storylet Studio line badge, cream colour way" style="display:block;" />
    <figcaption style="font-size:0.8rem;margin-top:0.3rem;"><a href="/badges/storylet-studio-line-cream.svg">SVG</a> · <a href="/badges/storylet-studio-line-cream.png">PNG</a></figcaption>
  </figure>
  <figure style="margin:0;">
    <img src="/badges/storylet-studio-line-plum.svg" width="298" height="38" alt="Story shaped with Storylet Studio line badge, deep plum colour way" style="display:block;" />
    <figcaption style="font-size:0.8rem;margin-top:0.3rem;"><a href="/badges/storylet-studio-line-plum.svg">SVG</a> · <a href="/badges/storylet-studio-line-plum.png">PNG</a></figcaption>
  </figure>
  <figure style="margin:0;">
    <img src="/badges/storylet-studio-line-mono.svg" width="298" height="38" alt="Story shaped with Storylet Studio line badge, one colour" style="display:block;" />
    <figcaption style="font-size:0.8rem;margin-top:0.3rem;"><a href="/badges/storylet-studio-line-mono.svg">SVG</a> · <a href="/badges/storylet-studio-line-mono.png">PNG</a></figcaption>
  </figure>
</div>

The mono badge inherits the colour of whatever it sits in, so it works in one-colour print and
on any ground. Every badge is outlines, not live text, so none of them needs a font installed.

Or take the whole set: both shapes, all three colour ways, SVG and 2× PNG, plus these credit
lines as a text file. **[Download the badge kit (zip)](/badges/storylet-studio-badges.zip)**

## The name and the mark

The MIT licence covers the code. The Storylet Studio, Storyletter and Storylet Engine names,
the thread mark and these badges aren't covered by it, so here is the plain-English version.

### Yes, please do

- Say your game's story was shaped with Storylet Studio, in credits, marketing, a blog or a talk.
- Use these badges unmodified, at any size, in game, on your site, or in a press kit.
- Name Storylet Studio in a list of tools and middleware alongside your engine.
- Use the wordmark in an article, tutorial or video about the tools.

### Please don't

- Recolour, redraw, stretch or rebuild the thread, or set the wordmark in another typeface.
- Use the mark as your own product, studio or app icon.
- Imply that Storylet Studio endorses, sponsors or has reviewed your project.
- Put Storylet Studio, Storyletter or Storylet Engine in your product name, company name or domain.
- Sell the badges, or the tools, as a product of your own.

## Your content

Your project files, your compiled bundles and your saves are yours. There's no runtime
licence, no attribution requirement on shipped games, no telemetry, and no server involved in
authoring or playing.

The format is plain text you can read, and every artefact is produced by MIT-licensed tools
you can run yourself.
