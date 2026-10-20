// Every palette declares its --color-scheme (app-shell 0.56): the shell's tokens.css sets `color-scheme` from
// it, so native controls draw for the palette, not the OS (Linen under a dark OS drew unticked checkboxes as
// dark filled squares). The bare :root leaves it unset, so follow-OS still works through the shell's fallback.
// A source scan, as chrome-scale.test.ts: a new palette block is one rule in one file.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./src/theme.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Each rule's selector and body, at any depth (the follow-OS block sits in a media query). */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
const scheme = (selector: string): string | undefined =>
  /--color-scheme:\s*(\w+)/.exec(rules.find((r) => r.selector === selector)?.body ?? "")?.[1];

describe("each palette declares its colour scheme", () => {
  it("light for Chambray and Linen, dark for Indigo and Baize, by their grounds", () => {
    expect(scheme(':root[data-theme="chambray"]')).toBe("light");
    expect(scheme(':root[data-theme="linen"]')).toBe("light");
    expect(scheme(':root[data-theme="indigo"]')).toBe("dark");
    expect(scheme(':root[data-theme="baize"]')).toBe("dark");
  });

  it("dark for the follow-OS block under a dark OS, and nothing on the bare :root", () => {
    expect(scheme(":root:not([data-theme])")).toBe("dark");
    expect(rules.find((r) => r.selector === ":root")?.body).not.toContain("--color-scheme");
  });

  it("misses no palette: every block that sets a ground sets the scheme too", () => {
    const grounds = rules.filter((r) => r.selector.startsWith(":root") && r.selector !== ":root" && /--bg:/.test(r.body));
    expect(grounds.length).toBe(4);
    for (const r of grounds) expect(r.body, r.selector).toMatch(/--color-scheme:\s*(light|dark)/);
  });
});
