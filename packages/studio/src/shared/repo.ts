// The storylets repository, and the external addresses the renderer can open (the family's rule, app-shell's
// external-links): the About dialog's links, Storyletter's own release pages (What's New's "Full release notes"),
// and pages on our own sites (a changelog announcement's links). Main lets out only these (shell:openExternal).

export const STORYLETS_REPO = "storylet-studio/storylets";

/** The About dialog's links, as it shows them. */
export const ABOUT_LINKS = [
  { label: "storylets.dev", url: "https://storylets.dev" },
  { label: "ian.wildwinter.net", url: "https://ian.wildwinter.net" },
];

export const EXTERNAL_LINKS = {
  links: ABOUT_LINKS.map((l) => l.url),
  repo: STORYLETS_REPO,
  sites: ["https://storylets.dev", "https://storylet.studio"],
};
