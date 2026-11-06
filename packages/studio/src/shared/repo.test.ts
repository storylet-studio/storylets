// What's New's "Full release notes" link did nothing: main let out only the About links, and the release page
// wasn't one. This pins the link What's New builds to the rules main opens by, and the About links with it.

import { describe, it, expect } from "vitest";
import { externalLinkAllowed, releaseNotesUrl } from "@wildwinter/app-shell/external-links";
import { EXTERNAL_LINKS, STORYLETS_REPO } from "./repo.js";

describe("the links main lets out", () => {
  it("includes What's New's full release notes for any version", () => {
    expect(externalLinkAllowed(releaseNotesUrl(STORYLETS_REPO, "0.28.1"), EXTERNAL_LINKS)).toBe(true);
  });

  it("still includes every About link, and a page on either of our sites", () => {
    for (const link of EXTERNAL_LINKS.links) expect(externalLinkAllowed(link, EXTERNAL_LINKS)).toBe(true);
    expect(externalLinkAllowed("https://storylets.dev/play/live-link/", EXTERNAL_LINKS)).toBe(true);
    expect(externalLinkAllowed("https://storylet.studio/storyletter/maps/", EXTERNAL_LINKS)).toBe(true);
  });

  it("still refuses anywhere else", () => {
    expect(externalLinkAllowed("https://example.com/", EXTERNAL_LINKS)).toBe(false);
    expect(externalLinkAllowed("https://github.com/someone/else/releases/tag/v1.0.0", EXTERNAL_LINKS)).toBe(false);
    expect(externalLinkAllowed("http://storylets.dev/", EXTERNAL_LINKS)).toBe(false);
    expect(externalLinkAllowed("https://github.com/storylet-studio/storylets/releases/tag/v0.28.1/../../settings", EXTERNAL_LINKS)).toBe(false);
  });
});
