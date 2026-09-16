// The Storyletter wordmark, as inline SVG.
//
// About is the shell's (`showAbout`), and the shell takes the wordmark as
// MARKUP from the app rather than knowing any product's brand, which is the
// one part of an About box that genuinely cannot be shared. So it lives here,
// as Patterpad's does.
//
// Inline rather than a file so the word renders in the app's own reading face
// and follows the theme's ink. The mark is the Storylet Studio site's: the
// curve in the palette's ink, so it reads on every palette, and the three
// points in the fixed brand gold, exactly as the site's footer draws them.

export const STORYLETTER_WORDMARK =
  '<svg viewBox="0 0 900 220" role="img" aria-label="Storyletter" xmlns="http://www.w3.org/2000/svg">' +
  '<g transform="translate(34,32) scale(1.52)"><g fill="none">' +
  '<path d="M88 12 C5 12 5 50 50 50 C95 50 95 88 12 88" stroke="var(--ink)" stroke-width="12" stroke-linecap="round"/>' +
  '<circle cx="88" cy="12" r="9.5" fill="#c8902f"/><circle cx="12" cy="88" r="9.5" fill="#c8902f"/><circle cx="50" cy="50" r="9.5" fill="#c8902f"/>' +
  "</g></g>" +
  '<text x="232" y="150" font-family="var(--font-read), Georgia, serif" font-weight="500" font-size="120" letter-spacing="-2" fill="var(--ink)">Storyletter</text>' +
  "</svg>";
