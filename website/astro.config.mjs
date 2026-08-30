// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// A fully STATIC build (Astro's default; no SSR adapter), served at the custom domain
// storylet.studio from the site root. Nothing here talks to a server at build time or at
// runtime: the whole site is files.
export default defineConfig({
  site: "https://storylet.studio",
  base: "/",
  // Pages that moved when the docs were reshaped into user-facing topics: the CLI, licensing
  // and conformance pages became top-level, merging became the version-control page in the new
  // setup track, and the editor's coverage window joined the production track. Old URLs were
  // already published, so keep every one of them alive as a redirect.
  redirects: {
    "/production/cli": "/cli",
    "/production/licensing": "/licensing",
    "/production/conformance": "/compatibility",
    "/production/merging": "/setup/version-control",
    "/storyletter/coverage": "/production/coverage-testing",
  },
  integrations: [
    starlight({
      title: "Storylet Studio",
      tagline: "Design playable stories.",
      customCss: ["./src/styles/storylets.css"],
      // Every docs page ends with the licence / author / home credit line. The landing page
      // carries the same credit separately, because it does not use Starlight chrome.
      components: { Footer: "./src/components/Footer.astro" },
      // Code blocks sit on the plum-deep ground in BOTH site themes (the "compiled" surface in
      // the brand palette). Force one dark syntax theme so the tokens always suit that ground,
      // and pin the exact fill + hairline.
      expressiveCode: {
        themes: ["github-dark"],
        styleOverrides: { codeBackground: "#241a33", borderColor: "#3b2d52" },
      },
      // Storylet Studio brand: the thread on plum as the favicon, the wordmark as the header
      // logo (light/dark variants, because the wordmark's ink is fixed dark and needs
      // lightening on the dark theme). replacesTitle swaps the plain title text for the mark.
      favicon: "/favicon.svg",
      logo: {
        light: "./src/assets/storylet-studio-wordmark.svg",
        dark: "./src/assets/storylet-studio-wordmark-dark.svg",
        replacesTitle: true,
        alt: "Storylet Studio",
      },
      head: [
        // Newsreader for headings (the brand reading face), IBM Plex Mono for tags, extensions
        // and CLI. Loaded from Google Fonts; the OFL licences live in branding/fonts.
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap",
          },
        },
        // Favicon fallbacks beside the SVG above: Safari doesn't do SVG favicons at
        // all, and stray agents request /favicon.ico directly. Same mark, rasterised.
        { tag: "link", attrs: { rel: "icon", href: "/favicon.ico", sizes: "48x48" } },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" } },
        // Link-preview card for every docs page (Starlight emits per-page title/description but
        // no image). og:image must be an ABSOLUTE url; the landing page sets its own.
        { tag: "meta", attrs: { property: "og:image", content: "https://storylet.studio/social-card.png" } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1280" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "640" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: "https://storylet.studio/social-card.png" } },
      ],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/storylet-studio/storylets" }],
      // Audience-routed: everyone starts at the top, then the three products get a track each
      // (write it, ship it in your game, run the project), with the file format between them
      // because it is the thing all three share. Setting up a project, the CLI and the
      // reference pages sit at the end, the way the sibling Patter site orders them.
      sidebar: [
        {
          label: "Start here",
          items: ["getting-started", "download", "concepts", "why"],
        },
        {
          label: "The format",
          items: ["format/overview", "format/property-types", "format/shards", "format/bundle"],
        },
        {
          label: "Designing in Storyletter",
          items: [
            "storyletter/overview",
            "storyletter/workspace",
            "storyletter/cards",
            "storyletter/node-canvas",
            "storyletter/box-setup",
            "storyletter/maps",
            "storyletter/board",
            "storyletter/reviewing",
            "storyletter/shortcuts",
          ],
        },
        {
          label: "Playing in your game",
          items: [
            "play/overview",
            "play/world-state",
            "play/dealing",
            "play/javascript",
            "play/unity",
            "play/unreal",
            "play/godot",
            "play/dev-tools",
            "play/live-link",
            "compatibility",
          ],
        },
        {
          label: "Running the project",
          items: ["production/overview", "production/coverage-testing"],
        },
        {
          label: "Setting up a project",
          items: ["setup/overview", "setup/version-control"],
        },
        { label: "Automation: the CLI", items: ["cli-walkthrough", "cli"] },
        { label: "Reference", items: ["licensing"] },
      ],
    }),
  ],
});
