// The Village client, built and then PLAYED.
//
// This is the guard a typecheck cannot be. A client that still compiles but no
// longer deals, or draws a map with no pins, or forgets where the player was,
// is broken in exactly the way a sample is worst broken: silently, and only
// for the person reading it to learn from.
//
// So the test builds the thing for real (which makes it the build gate too)
// and then plays a whole turn through the DOM: arrive, open a card, take an
// outcome, watch the world change, close the tab, come back.
//
// The precedent is `packages/ops/test/export-html.test.ts`, which opens the
// published page in jsdom and plays it - Patter's stale-blob guard done end to
// end. Same idea, one product up.

import { describe, expect, it, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const dist = join(pkg, "dist");

/** Build it, exactly as a release would. A build failure is a test failure,
 *  which is the point: the sample and its content are one artefact.
 *
 *  Through `npm run build`, not by running the script directly, and that is
 *  load-bearing: the build reads the project through `@storylet-studio/ops` and
 *  `@storylet-studio/compiler` as BUILT modules, and this suite runs before the
 *  root build does. Calling the file bypassed the package's `prebuild`, which
 *  is what makes those two exist. It passed locally, where their `dist/` was
 *  already there from earlier work, and failed on the first clean CI run - the
 *  green-locally-proves-nothing lesson, collected again. */
beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: pkg, stdio: "pipe" });
}, 180_000);

/** Open the built page with its script running.
 *
 *  Two accommodations, both because jsdom is not a browser: the script tag is
 *  inlined (jsdom loads no external resources by default) and `fetch` is
 *  answered from `dist/`, which is exactly what the static server does. */
function open(storage?: Record<string, string>): { dom: JSDOM; doc: Document } {
  const html = readFileSync(join(dist, "index.html"), "utf8")
    .replace('<script src="village.js"></script>', `<script>${readFileSync(join(dist, "village.js"), "utf8")}</script>`);
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://localhost/village/",
    beforeParse(window) {
      const w = window as unknown as Record<string, unknown>;
      w.structuredClone = structuredClone;
      w.fetch = (url: string) => {
        const file = join(dist, url.replace(/^.*\//, ""));
        if (!existsSync(file)) return Promise.reject(new Error(`no ${url}`));
        const text = readFileSync(file, "utf8");
        return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(text)), text: () => Promise.resolve(text) });
      };
      for (const [k, v] of Object.entries(storage ?? {})) window.localStorage.setItem(k, v);
    },
  });
  return { dom, doc: dom.window.document };
}

/** The client starts asynchronously (it fetches its own bundle), so every test
 *  waits for the first paint rather than guessing at a delay. */
const settled = async (doc: Document): Promise<void> => {
  for (let i = 0; i < 200; i++) {
    if (doc.querySelector(".mapsvg .site") !== null) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("the client never drew its map");
};

const click = (doc: Document, node: Element | null): void => {
  if (node === null) throw new Error("nothing to click");
  node.dispatchEvent(new doc.defaultView!.Event("click", { bubbles: true }));
};

const site = (doc: Document, label: string): Element | null =>
  [...doc.querySelectorAll(".mapsvg .site")].find((g) => g.querySelector(".sitename")?.textContent === label) ?? null;

const text = (doc: Document, sel: string): string => doc.querySelector(sel)?.textContent ?? "";

describe("the Village client", () => {
  it("draws the world the project describes: five zones, thirteen places, the art", async () => {
    const { doc } = open();
    await settled(doc);
    // Derived from the Village's own view shard, not written here. If the
    // example gains a zone, this number is meant to move with it.
    expect(doc.querySelectorAll(".mapsvg .zone")).toHaveLength(5);
    expect(doc.querySelectorAll(".mapsvg .site")).toHaveLength(13);
    expect([...doc.querySelectorAll(".mapsvg .zonename")].map((z) => z.textContent).sort())
      .toEqual(["cave", "forest", "lair", "mountain", "village"]);
    // The pictures travel as files beside the page, not as data URIs.
    const art = [...doc.querySelectorAll(".mapsvg image")].map((i) => i.getAttribute("href"));
    expect(art.length).toBeGreaterThan(0);
    expect(art.every((h) => h!.startsWith("assets/"))).toBe(true);
    // And the bundle says which build this is, which is what a bug report needs.
    expect(text(doc, "#build")).toMatch(/^v\d+\.\d+\.\d+ · \w+ · 13 places$/);
  });

  it("plays a turn: arrive, choose, and the world moves", async () => {
    const { doc } = open();
    await settled(doc);
    expect(text(doc, "#turn")).toBe("Turn 0");

    // The Village opens closed: the Wishing Well is the one place with
    // anything at it until you arrive. Going there deals its hand.
    click(doc, site(doc, "The Wishing Well"));
    expect(text(doc, "#place h2")).toBe("The Wishing Well");
    const card = doc.querySelector(".card-face");
    expect(card?.textContent).toBe("Arrive in the Village");

    // Opening a card fills the overlay OVER THE MAP and asks for its outcomes,
    // evaluated now. The choices live outside the scrolling text on purpose:
    // a long storylet used to push its own outcomes off the bottom of the
    // sidebar, which is the one thing a player must always be able to reach.
    click(doc, card);
    expect((doc.getElementById("cardview") as HTMLElement).hidden).toBe(false);
    expect(text(doc, "#cardview-title")).toBe("Arrive in the Village");
    expect(text(doc, "#cardview-purpose").length).toBeGreaterThan(40);
    const choices = [...doc.querySelectorAll("#cardview-choices .choice")];
    expect(choices.length).toBeGreaterThan(1);

    const chosen = choices[0]!.textContent!;
    click(doc, choices[0]!);
    // Taking one STAYS in the card and says what happened. Closing straight
    // back to the map made every choice feel inert (the author's report): the
    // world had moved and the only word about it was a line in the journal
    // behind you. The outcome's own purpose is the designer's account of the
    // consequence, and this is where it is read.
    const view = doc.getElementById("cardview") as HTMLElement;
    expect(view.hidden).toBe(false);
    expect(text(doc, "#cardview-title")).toBe(chosen);
    expect(text(doc, "#cardview-purpose").length).toBeGreaterThan(40);
    // One way onward, and it is not another choice: the card is spent.
    const onward = [...doc.querySelectorAll("#cardview-choices .choice")];
    expect(onward).toHaveLength(1);
    expect(onward[0]!.textContent).toBe("Onwards");
    click(doc, onward[0]!);
    expect(view.hidden).toBe(true);
    // One played outcome, one turn - the PROJECT's playAdvancesTurns, not a
    // turn the client spends itself. Two would mean the client is double-
    // counting, which silently breaks every redraw the designer tuned.
    expect(text(doc, "#turn")).toBe("Turn 1");
    // The journal records the outcome's own words, written by the designer.
    expect(doc.querySelectorAll("#journal p").length).toBeGreaterThan(1);
    // And the world opened: somewhere that was empty now has something.
    click(doc, site(doc, "The Inn"));
    expect(doc.querySelectorAll(".card-face").length).toBeGreaterThan(0);
  });

  it("says on the MAP where something is waiting, and keeps saying it", async () => {
    // The bug this pins, reported by the author: the Village opens with one
    // place holding anything at all, so a map of identical pins reads as a
    // game that does not work. Worse, the first cut re-dealt only where the
    // player was standing, so after the opening move the map claimed the whole
    // valley was empty while three sites had cards waiting on it.
    const { doc } = open();
    await settled(doc);
    const waiting = (): string[] => [...doc.querySelectorAll(".mapsvg .site.waiting")]
      .map((g) => g.querySelector(".sitename")!.textContent!);

    expect(waiting()).toEqual(["The Wishing Well"]);
    expect(text(doc, "#place")).toContain("1 place has something waiting");

    click(doc, site(doc, "The Wishing Well"));
    click(doc, doc.querySelector(".card-face"));
    click(doc, doc.querySelector(".choice"));

    // Back out to the map: the world has opened, and the map knows.
    click(doc, doc.querySelector(".leave"));
    expect(waiting().length).toBeGreaterThan(1);
    expect(text(doc, "#place")).toContain("places have something waiting");
  });

  it("lets you back out of a card without playing it", async () => {
    const { doc } = open();
    await settled(doc);
    click(doc, site(doc, "The Wishing Well"));
    click(doc, doc.querySelector(".card-face"));
    const view = doc.getElementById("cardview") as HTMLElement;
    expect(view.hidden).toBe(false);

    // Escape, the backdrop and the Close button: the three ways out everyone
    // already knows, and none of them may cost a turn.
    doc.dispatchEvent(new doc.defaultView!.KeyboardEvent("keydown", { key: "Escape" }));
    expect(view.hidden).toBe(true);
    expect(text(doc, "#turn")).toBe("Turn 0");

    click(doc, doc.querySelector(".card-face"));
    click(doc, view);                       // the backdrop itself
    expect(view.hidden).toBe(true);

    click(doc, doc.querySelector(".card-face"));
    click(doc, doc.getElementById("cardview-close"));
    expect(view.hidden).toBe(true);
    expect(text(doc, "#turn")).toBe("Turn 0");
  });

  it("lets time pass on its own, which is the game spending it", async () => {
    const { doc } = open();
    await settled(doc);
    click(doc, doc.getElementById("wait"));
    expect(text(doc, "#turn")).toBe("Turn 1");
    expect(text(doc, "#journal")).toContain("Time passes");
  });

  it("comes back where you left it, through the engine's own save", async () => {
    const first = open();
    await settled(first.doc);
    click(first.doc, site(first.doc, "The Wishing Well"));
    click(first.doc, first.doc.querySelector(".card-face"));
    click(first.doc, first.doc.querySelector(".choice"));
    const saved = { ...first.dom.window.localStorage } as Record<string, string>;
    expect(Object.keys(saved)).toHaveLength(1);

    // A new tab, with only what the browser kept.
    const { doc } = open(saved);
    await settled(doc);
    expect(text(doc, "#turn")).toBe("Turn 1");
    expect(text(doc, "#place h2")).toBe("The Wishing Well");
    expect(text(doc, "#journal")).toContain("where you left off");
  });

  it("shows the player their own state", async () => {
    const { doc } = open();
    await settled(doc);
    click(doc, site(doc, "The Wishing Well"));
    click(doc, doc.querySelector(".card-face"));
    click(doc, doc.querySelector(".choice"));
    // The Village marks you on arrival, so the sheet has something in it.
    expect(doc.querySelectorAll("#sheet .prop").length).toBeGreaterThan(0);
    // That the client never WRITES state is not asserted here: it is one of the
    // declared omissions in scripts/check-sample-coverage.mjs, which fails if a
    // `setProperty` call ever appears. One rule, one place.
  });
});
