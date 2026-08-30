# The Storylet Studio site

Astro + Starlight. The docs live in `src/content/docs/`, the sidebar in
`astro.config.mjs`, and everything under `public/` is copied out verbatim.

## Running it

```
npm --prefix website run dev
```

Then open `http://localhost:4321`. Editing a page under `src/content/docs/`
reloads it immediately, and changing `astro.config.mjs` restarts the server on
its own.

## Checking it

```
npm --prefix website run build
```

The build ends in `check-docs`, which is the actual gate. Two faults matter here
because Astro reports neither of them and both look exactly like a green build:

- **A blank line inside a raw `<svg>`.** Markdown ends an HTML block at the first
  blank line, so the rest of the diagram is re-parsed as prose. The page renders
  half a picture followed by a paragraph of loose label text.
- **A dead internal link.** Checked against `dist/`, where the routing, the slugs
  and the generated heading ids are all finally true. Anchors are checked too,
  not just pages.

Run it on its own with `npm --prefix website run check`, though it needs a
`dist/` to read, so it only says anything useful after a build.

CI runs exactly this, in `.github/workflows/website.yml`, on any change under
`website/`.

From the repo root the same two commands are `npm run website` (the dev server,
beside `npm run studio`) and `npm run test:website` (the build and its check).

## Two things the dev server cannot show you

- **Search.** Pagefind indexes at build time, so the search box is empty under
  `npm run dev` and works under `npm run preview`.
- **How a page really looks.** `npm --prefix website run preview` serves the
  built site, which is what the two faults above were found in. A page that is
  right in dev can still be wrong in the build.
