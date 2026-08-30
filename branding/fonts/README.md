# Fonts

All type in the SVGs is **converted to curves** — no font is required to render them, and
nothing shifts on a machine that lacks Newsreader or IBM Plex Mono.

The outlines were drawn from:

- **Newsreader 72pt Medium** — wordmarks. The 72pt optical size is what a browser picks
  when Newsreader variable is set at 120 px with `font-optical-sizing: auto`, so the
  outlines match the live web type exactly.
- **IBM Plex Mono Medium** — icon tags, engine initials, file-extension labels.

Both are SIL Open Font License 1.1; the licences are alongside this file. Use the live
webfonts (Google Fonts) for HTML — `social/social-card.html` does — and the outlined SVGs
everywhere else.

To re-cut a label, set the text in the same font, size and tracking, convert to outlines,
and place it: icon tags right-aligned so the ink ends at x=934 on baseline y=940;
wordmarks from x=232 on baseline y=150 at 120 px with `letter-spacing: -2`.
