// ---------------------------------------------------------------------------
// The "Story shaped with Storylet Studio" credit badges.
//
// Everything downloadable here is CURVES. A badge lands in someone else's
// credits screen, readme or itch.io page, where Newsreader and IBM Plex Mono
// are not installed; an SVG carrying <text> would render in whatever that
// machine happens to have. So:
//
//   - the wordmark is lifted verbatim from branding/wordmarks/storylet-studio.svg,
//     which is already outlined (Newsreader 72pt Medium, the display cut)
//   - the small labels are cut here from IBM Plex Mono Medium via fontkit
//   - the thread is geometry, so it needs nothing
//
// The two optical sizes are deliberate, not a compromise: the wordmark is
// display type and uses the 72pt cut; the labels are small and use the sturdier
// text cut, which is what an optical-size axis is for.
//
//   node scripts/make-badges.mjs
//
// Writes website/public/badges/. Re-run after any change to the branding
// wordmark: an asset you cannot regenerate is an asset you cannot correct.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openSync as openFont } from "fontkit";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "website/public/badges");
mkdirSync(out, { recursive: true });

const CREDIT = "Story shaped with Storylet Studio";
const URL_TEXT = "storylet.studio";

// --- the palette (branding/README.md) ------------------------------------------
const PLUM = "#36284A";
const PLUM_DEEP = "#241A33";
const PLUM_MID = "#4A3866";
const PLUM_TINT = "#9A89B5";
const AMBER = "#C8902F";
const CREAM = "#F3EDE2";
const INK = "#2A2431";

/** The three colour ways. `edge` is the hairline; a mono badge has no ground,
 *  so it drops onto whatever it is placed on. */
const WAYS = {
  cream: { ground: CREAM, edge: "#DCD0BC", thread: PLUM, beat: AMBER, name1: INK, name2: PLUM, label: PLUM_MID, url: "#6B6256", wash: PLUM },
  plum: { ground: PLUM_DEEP, edge: "#3D3054", thread: CREAM, beat: AMBER, name1: CREAM, name2: PLUM_TINT, label: PLUM_TINT, url: PLUM_TINT, wash: CREAM },
  mono: { ground: "none", edge: "currentColor", thread: "currentColor", beat: "currentColor", name1: "currentColor", name2: "currentColor", label: "currentColor", url: "currentColor", wash: "currentColor" },
};

// --- the wordmark, lifted from the branding source -----------------------------
const wordmarkSvg = readFileSync(join(root, "branding/wordmarks/storylet-studio.svg"), "utf8");
const wordmarkPaths = [...wordmarkSvg.matchAll(/<path\s+transform="translate\(([\d.]+),([\d.]+)\)"\s+fill="([^"]+)"\s+d="([^"]+)"/g)]
  .map((m) => ({ tx: Number(m[1]), ty: Number(m[2]), d: m[4] }));
if (wordmarkPaths.length !== 2) throw new Error(`expected 2 wordmark paths, found ${wordmarkPaths.length}`);

// Measured from the source (getBBox in a browser, recorded so this stays
// headless): the ink spans x 236.68..1036.08 with the baseline at y=150.
const WM = { x: 236.68, width: 799.4, baseline: 150 };

/** The wordmark placed with its baseline at (x, y) and its ink `width` wide. */
function wordmark(x, y, width, way) {
  const s = width / WM.width;
  const fills = [way.name1, way.name2];
  // The offsets sit INSIDE the scaled group, so they must stay in the source's
  // own units: pre-multiplying by `s` here would scale them twice and stack the
  // two halves of the wordmark on top of each other.
  const parts = wordmarkPaths.map((p, i) =>
    `<path transform="translate(${p.tx - WM.x},${p.ty - WM.baseline})" fill="${fills[i]}" d="${p.d}"/>`);
  return `<g transform="translate(${x},${y}) scale(${s.toFixed(5)})">${parts.join("")}</g>`;
}

// --- the thread ----------------------------------------------------------------
/** The mark at `size` px, top-left at (x, y). Geometry, so no font involved. */
function thread(x, y, size, way) {
  const s = size / 100;
  return `<g transform="translate(${x},${y}) scale(${s.toFixed(5)})" fill="none">`
    + `<path d="M88 12 C5 12 5 50 50 50 C95 50 95 88 12 88" stroke="${way.thread}" stroke-width="12" stroke-linecap="round"/>`
    + `<circle cx="88" cy="12" r="9.5" fill="${way.beat}"/>`
    + `<circle cx="12" cy="88" r="9.5" fill="${way.beat}"/>`
    + `<circle cx="50" cy="50" r="9.5" fill="${way.beat}"/>`
    + `</g>`;
}

// --- small labels, cut to curves ------------------------------------------------
const mono = openFont(join(root, "node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2"));

/** Set `text` in Plex Mono Medium as OUTLINES, tracked like the brand's labels.
 *  Returns the path markup and the advance, so callers can centre or stack. */
function label(text, x, y, size, tracking, fill) {
  const run = mono.layout(text);
  const scale = size / mono.unitsPerEm;
  const track = size * tracking;
  let pen = 0;
  const parts = [];
  for (const glyph of run.glyphs) {
    const d = glyph.path.toSVG();
    if (d) parts.push(`<path transform="translate(${(x + pen).toFixed(2)},${y}) scale(${scale.toFixed(6)},${(-scale).toFixed(6)})" d="${d}"/>`);
    pen += glyph.advanceWidth * scale + track;
  }
  const width = pen - track;
  return { markup: `<g fill="${fill}">${parts.join("")}</g>`, width };
}

const labelWidth = (text, size, tracking) => {
  const run = mono.layout(text);
  const scale = size / mono.unitsPerEm;
  return run.glyphs.reduce((w, g) => w + g.advanceWidth * scale + size * tracking, 0) - size * tracking;
};

// --- the badge (360 x 112) --------------------------------------------------------
function badge(wayName) {
  const way = WAYS[wayName];
  const W = 360, H = 112, R = 10;
  const eyebrow = "STORY SHAPED WITH";
  const EY_SIZE = 9.5, EY_TRACK = 0.14;
  const URL_SIZE = 9.5, URL_TRACK = 0.14;

  const ground = way.ground === "none"
    ? `<rect x="0.75" y="0.75" width="${W - 1.5}" height="${H - 1.5}" rx="${R - 0.5}" fill="none" stroke="${way.edge}" stroke-width="1.5" opacity="0.45"/>`
    : `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${R - 0.5}" fill="${way.ground}" stroke="${way.edge}"/>`;

  // No watermark. Patter's badge carries a faint oversized drop, but the thread
  // is a long thin stroke rather than a solid shape: blown up and faded it reads
  // as a smudge across the type instead of a ghost behind it.

  const TEXT_X = 78;
  const ey = label(eyebrow, TEXT_X, 34, EY_SIZE, EY_TRACK, way.label);
  const url = label(URL_TEXT.toUpperCase(), TEXT_X, 92, URL_SIZE, URL_TRACK, way.url);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${CREDIT} - ${URL_TEXT}">
  <title>${CREDIT} - ${URL_TEXT}</title>
  ${ground}
  ${thread(24, 38, 38, way)}
  ${ey.markup}
  ${wordmark(TEXT_X, 72, 244, way)}
  ${url.markup}
</svg>
`;
}

// --- the line (330 x 38) ----------------------------------------------------------
function line(wayName) {
  const way = WAYS[wayName];
  const H = 38, R = 7, PAD = 14;
  const SIZE = 9, TRACK = 0.1;
  const lead = "STORY SHAPED WITH";
  const markSize = 20, GAP_MARK = 11, GAP_TEXT = 9, wmWidth = 124;
  // Fitted, not forced to a round number: a one-line strip with 40px of dead
  // air at one end reads as a mistake.
  const W = Math.round(PAD + markSize + GAP_MARK + labelWidth(lead, SIZE, TRACK) + GAP_TEXT + wmWidth + PAD);

  const ground = way.ground === "none"
    ? `<rect x="0.75" y="0.75" width="${W - 1.5}" height="${H - 1.5}" rx="${R - 0.5}" fill="none" stroke="${way.edge}" stroke-width="1.5" opacity="0.45"/>`
    : `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${R - 0.5}" fill="${way.ground}" stroke="${way.edge}"/>`;

  // One line, laid out left to right and measured as it goes.
  let x = PAD;
  const markup = [ground, thread(x, (H - markSize) / 2, markSize, way)];
  x += markSize + GAP_MARK;
  const lead1 = label(lead, x, 24, SIZE, TRACK, way.label);
  markup.push(lead1.markup);
  x += lead1.width + GAP_TEXT;
  markup.push(wordmark(x, 24, wmWidth, way));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${CREDIT}">
  <title>${CREDIT}</title>
  ${markup.join("\n  ")}
</svg>
`;
}

const written = [];
for (const way of Object.keys(WAYS)) {
  const b = badge(way), l = line(way);
  writeFileSync(join(out, `storylet-studio-badge-${way}.svg`), b);
  writeFileSync(join(out, `storylet-studio-line-${way}.svg`), l);
  written.push({ name: `storylet-studio-badge-${way}`, svg: b, w: 360, h: 112, way });
  written.push({ name: `storylet-studio-line-${way}`, svg: l, w: sizeOf(l).w, h: 38, way });
}

// --- the copyable credit lines ------------------------------------------------------
writeFileSync(join(out, "credit-lines.txt"), `Storylet Studio credit lines
https://storylet.studio/licensing/

Voluntary, but appreciated! Use whichever fits.

1. Single line (credits, readme)
${CREDIT} - ${URL_TEXT}

2. Credits block
NARRATIVE TOOLS
${CREDIT}
${URL_TEXT}

3. HTML (website, itch.io footer)
<a href="https://${URL_TEXT}">${CREDIT}</a>

Storylet Studio is free and MIT-licensed. The name, the thread mark and these
badges are not covered by that licence; see https://${URL_TEXT}/licensing/ for
what you can and can't do with them.
`);

// --- PNGs at 2x -----------------------------------------------------------------
// Rendered from the SVG through Chrome, on a TRANSPARENT ground: a badge dropped
// on a dark credits screen must not arrive with a white box around it. The mono
// way has no ground of its own and inherits `currentColor`, so the page pins a
// colour for it; that is what "mono" means at raster.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (existsSync(CHROME)) {
  const tmp = join(out, ".render");
  mkdirSync(tmp, { recursive: true });
  for (const item of written) {
    const page = join(tmp, `${item.name}.html`);
    writeFileSync(page, `<!doctype html><html><body style="margin:0;color:${INK}">${item.svg}</body></html>`);
    execFileSync(CHROME, [
      "--headless", `--screenshot=${join(tmp, item.name)}.png`,
      `--window-size=${item.w},${item.h}`, "--hide-scrollbars",
      "--force-device-scale-factor=2", "--default-background-color=00000000", page,
    ], { stdio: "ignore" });
    execFileSync("cp", [`${join(tmp, item.name)}.png`, join(out, `${item.name}.png`)]);
  }
  rmSync(tmp, { recursive: true, force: true });
  console.log(`  ${written.length} PNGs rendered at 2x`);
} else {
  console.log("  Chrome not found: PNGs not rendered (SVGs are the source of truth)");
}

// --- the download bundle -------------------------------------------------------
const stage = join(out, "storylet-studio-badges");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const item of written) {
  for (const ext of ["svg", "png"]) {
    const from = join(out, `${item.name}.${ext}`);
    if (existsSync(from)) execFileSync("cp", [from, join(stage, `${item.name}.${ext}`)]);
  }
}
execFileSync("cp", [join(out, "credit-lines.txt"), join(stage, "credit-lines.txt")]);
const zip = join(out, "storylet-studio-badges.zip");
rmSync(zip, { force: true });
// -X drops the resource forks that otherwise ride along as __MACOSX entries.
execFileSync("zip", ["-r", "-q", "-X", zip, "storylet-studio-badges"], { cwd: out });
rmSync(stage, { recursive: true, force: true });

/** The declared size of a generated SVG, for the raster pass. */
function sizeOf(svg) {
  const m = svg.match(/width="(\d+)" height="(\d+)"/);
  return { w: Number(m[1]), h: Number(m[2]) };
}

console.log(`badges written to ${out}`);
console.log(`  eyebrow width: ${labelWidth("STORY SHAPED WITH", 9.5, 0.14).toFixed(1)}px`);
