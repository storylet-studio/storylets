// ---------------------------------------------------------------------------
// The playable export: a single self-contained `.html` that plays the project
// in any browser, with the runtime, the board player and the compiled bundle
// all inlined and nothing fetched. The first block locks the self-containment
// contract on the text; the second opens the page in jsdom and plays it, which
// is also the guard that the committed player blob (playable-player.ts) is
// current enough to drive a real project: a stale blob would fail here, not
// on the stakeholder's laptop.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { loadProject } from "../src/load.js";
import { playableFileName, runExportHtml } from "../src/export-html.js";
import { PLAYABLE_PLAYER_JS } from "../src/playable-player.js";

const exampleDir = fileURLToPath(new URL("../../../examples/the-hamlet.storylets", import.meta.url));
const villageDir = fileURLToPath(new URL("../../../examples/the-village.storylets", import.meta.url));
const meridianDir = fileURLToPath(new URL("../../../examples/port-meridian.storylets", import.meta.url));

/** The maps blob the page carries, parsed back out of the document. */
const mapsOf = (html: string) => {
  const m = /window\.STORYLET_MAPS=(.*?);<\/script>/s.exec(html);
  if (!m) throw new Error("no maps blob");
  return JSON.parse(m[1]!.replace(/\\u003c/g, "<"));
};

describe("runExportHtml on the example project", () => {
  const loaded = loadProject(exampleDir);
  const result = runExportHtml(loaded);
  const html = result.html!;

  it("is one complete HTML document, titled from the project", () => {
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html).toContain("<title>The Hamlet</title>");
    expect(html).toContain("<h1>The Hamlet</h1>");
  });

  it("inlines the bundle and the player, and references nothing external", () => {
    expect(html).toContain("window.STORYLET_BUNDLE=");
    expect(html).toContain(PLAYABLE_PLAYER_JS);
    // The SVG namespace IDENTIFIER (the map renderer's createElementNS) is not
    // a request; every other URL-looking thing still is.
    const sansXmlns = html.replaceAll("http://www.w3.org/2000/svg", "");
    expect(sansXmlns).not.toMatch(/\bsrc=/);
    expect(sansXmlns).not.toMatch(/href=/);
    expect(sansXmlns).not.toMatch(/https?:\/\//);
    expect(sansXmlns).not.toMatch(/<link\b/);
  });

  it("carries the bundle with full metadata, so titles show, and escapes every < in it", () => {
    const data = html.match(/<script>window\.STORYLET_BUNDLE=([\s\S]*?);<\/script>/)![1]!;
    expect(data).not.toContain("<");
    const bundle = JSON.parse(data) as { content: { project: string }; metadata: string };
    expect(bundle.content.project).toBe("proj_village");
    expect(bundle.metadata).toBe("full");
    expect(html).toContain("Arrive at the Village Gate");   // a card title, in the data block
  });

  it("suggests <project name>.html", () => {
    expect(playableFileName(loaded.source!)).toBe("The Hamlet.html");
  });

  it("the inlined script parses", () => {
    expect(() => new Function(PLAYABLE_PLAYER_JS)).not.toThrow();
  });

  it("carries the box maps for the page to draw: zones and the placed hands", () => {
    // The playable page is for people who are NOT the designer, exploring the
    // running project - and the map is how a stranger reads the world. Zones
    // and sites are inlined as data beside the bundle; the Hamlet has four
    // drawn zones, three placed hands, and no pictures.
    const { html } = runExportHtml(loadProject(exampleDir));
    expect(html).toContain("window.STORYLET_MAPS=");
    const maps = mapsOf(html!);
    expect(maps).toHaveLength(1);
    expect(maps[0].group).toBe("area");
    expect(maps[0].zones.map((z: { tag: string }) => z.tag).sort()).toEqual(["cave", "forest", "mountain", "village"]);
    expect(maps[0].sites.map((s: { hand: string }) => s.hand).sort()).toEqual(["the-forge", "the-inn", "the-mystic-tree"]);
    expect(maps[0].backgrounds).toEqual([]);
  });

  it("inlines the Village's background pictures as data URIs, so one file carries the whole world", () => {
    const { html } = runExportHtml(loadProject(villageDir));
    const maps = mapsOf(html!);
    const backgrounds = maps.flatMap((m: { backgrounds: { src: string }[] }) => m.backgrounds);
    expect(backgrounds).toHaveLength(5);
    for (const b of backgrounds) expect(b.src.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("draws a shared space ONCE: Meridian's four district boxes, one map, everyone's pins", () => {
    const { html } = runExportHtml(loadProject(meridianDir));
    const maps = mapsOf(html!);
    expect(maps).toHaveLength(1);
    expect(maps[0].boxes).toEqual(["contracts", "encounters", "items", "news"]);
    const siteBoxes = new Set(maps[0].sites.map((s: { box: string }) => s.box));
    expect([...siteBoxes].sort()).toEqual(["contracts", "encounters", "items", "news"]);
  });

  it("reports the load issues, and no page, for a folder with no project", () => {
    const none = runExportHtml(loadProject(fileURLToPath(new URL(".", import.meta.url))));
    expect(none.html).toBeUndefined();
    expect(none.issues[0]!.message).toContain("no .storylets project");
  });
});

describe("the published page plays in a browser", () => {
  const html = runExportHtml(loadProject(exampleDir)).html!;

  /** Open the page with its scripts running, optionally with the localStorage
   *  an earlier visit left (copied in before the page's script runs, as a
   *  browser would have it). localStorage needs a real origin, and jsdom lacks
   *  structuredClone (every browser has had it since 2022), so the window gets
   *  Node's. */
  const open = (storage?: Storage) => {
    const dom = new JSDOM(html, {
      runScripts: "dangerously",
      url: "http://localhost/the-hamlet.html",
      beforeParse(window) {
        (window as unknown as { structuredClone: unknown }).structuredClone = structuredClone;
        for (let i = 0; storage && i < storage.length; i++) {
          const key = storage.key(i)!;
          window.localStorage.setItem(key, storage.getItem(key)!);
        }
      },
    });
    const doc = dom.window.document;
    const texts = (sel: string): string[] => [...doc.querySelectorAll(sel)].map((el) => el.textContent ?? "");
    const control = (label: string): HTMLButtonElement => {
      const b = [...doc.querySelectorAll<HTMLButtonElement>(".bd-control")].find((x) => x.textContent === label);
      if (!b) throw new Error(`no control ${label}`);
      return b;
    };
    return { dom, doc, texts, control };
  };

  it("draws the map large, in its own pane beside the lists - not squeezed into the column", () => {
    // The user's ruling: the map is the page's stage, so it gets the left of
    // the screen with the list content on the right, closer to the Board's
    // own Map view. The pane exists in the skeleton and the player fills it.
    const { doc, texts } = open();
    expect(doc.body.classList.contains("has-map")).toBe(true);
    const pane = doc.getElementById("mappane")!;
    expect(pane.hidden).toBe(false);
    const map = doc.querySelector("#mapview .bd-map");
    expect(map).not.toBeNull();
    expect(map!.tagName.toLowerCase()).toBe("svg");
    // The lists keep the right-hand column to themselves.
    expect(doc.querySelectorAll("#board .bd-map")).toHaveLength(0);
    // One map: a name, nothing to choose (the Board's own grammar).
    expect(texts("#mappicker")[0]).toContain("area");
    expect(doc.querySelectorAll("#mappicker select")).toHaveLength(0);
  });

  it("draws the map: an SVG with the zones, and a clickable pin per placed hand", () => {
    const { doc, texts } = open();
    expect(doc.querySelectorAll(".bd-map .bd-zone")).toHaveLength(4);
    expect(texts(".bd-map .bd-zone-label").sort()).toEqual(["cave", "forest", "mountain", "village"]);
    const pins = [...doc.querySelectorAll(".bd-map .bd-pin")];
    expect(pins.map((p) => p.getAttribute("data-hand")).sort()).toEqual(["the-forge", "the-inn", "the-mystic-tree"]);
    // A pin carries the hand's live card count, and clicking it flashes the
    // HAND SECTION - not the pin, which shares the data-hand attribute and
    // fooled a bare selector (jsdom has no scrollIntoView; the flash is the
    // observable half there).
    expect(texts(".bd-map .bd-pin-count").every((t) => /^\d+$/.test(t))).toBe(true);
    const forgePin = pins.find((p) => p.getAttribute("data-hand") === "the-forge")!;
    forgePin.dispatchEvent(new (doc.defaultView!.window.Event)("click", { bubbles: true }));
    expect(doc.querySelector('section[data-hand="the-forge"]')!.classList.contains("bd-found")).toBe(true);
  });

  it("zooms: the nav buttons and the wheel move the viewBox, and Fit brings it home", () => {
    const { doc, texts } = open();
    const svg = doc.querySelector<SVGSVGElement>("#mapview .bd-map")!;
    const vb = (): number[] => svg.getAttribute("viewBox")!.split(" ").map(Number);
    const fit = vb();
    const btn = (label: string): HTMLButtonElement => {
      const b = [...doc.querySelectorAll<HTMLButtonElement>("#mapnav button")].find((x) => x.textContent === label);
      if (!b) throw new Error(`no map button ${label}; have ${texts("#mapnav button").join(",")}`);
      return b;
    };
    btn("+").click();
    expect(vb()[2]!).toBeLessThan(fit[2]!);
    btn("Fit").click();
    expect(vb()).toEqual(fit);
    svg.dispatchEvent(new (doc.defaultView!.window.WheelEvent)("wheel", { deltaY: -240, bubbles: true, cancelable: true }));
    expect(vb()[2]!).toBeLessThan(fit[2]!);
  });

  it("keeps your zoom when the board moves: a play updates the pin counts in place", () => {
    const { doc } = open();
    const svg = doc.querySelector<SVGSVGElement>("#mapview .bd-map")!;
    [...doc.querySelectorAll<HTMLButtonElement>("#mapnav button")].find((x) => x.textContent === "+")!.click();
    const zoomed = svg.getAttribute("viewBox");
    doc.querySelector<HTMLButtonElement>(".bd-card")!.click();
    doc.querySelector<HTMLButtonElement>(".bd-outcome:enabled")!.click();
    // The same SVG, the same viewBox: the counts changed under it, the world did not jump.
    expect(doc.querySelector<SVGSVGElement>("#mapview .bd-map")).toBe(svg);
    expect(svg.getAttribute("viewBox")).toBe(zoomed);
  });

  it("stays a single quiet column when the project has no map", () => {
    const flat = html.replace(/window\.STORYLET_MAPS=.*?;<\/script>/s, "window.STORYLET_MAPS=[];</script>");
    const dom = new JSDOM(flat, { runScripts: "dangerously", url: "http://localhost/flat.html",
      beforeParse(window) { (window as unknown as { structuredClone: unknown }).structuredClone = structuredClone; } });
    const doc = dom.window.document;
    expect(doc.body.classList.contains("has-map")).toBe(false);
    expect(doc.getElementById("mappane")!.hidden).toBe(true);
    expect(doc.querySelectorAll(".bd-card").length).toBeGreaterThan(0);   // still plays
  });

  it("opens dealt: every hand is a labelled group, the first hands are out, the transcript says so", () => {
    const { texts } = open();
    expect(texts(".bd-hand-label")).toEqual(["The Forge", "The Inn", "The Mystic Tree"]);
    expect(texts(".bd-card").length).toBeGreaterThan(0);
    expect(texts(".bd-control")).toEqual(["Deal all hands", "Next turn", "Restart"]);
    expect(texts("#header-line")[0]).toBe("v0.1.0 - Village turn 0");
    const transcript = texts(".tr-line");
    expect(transcript.length).toBe(3);
    expect(transcript[0]).toMatch(/^dealt: The (Forge|Inn|Mystic Tree) <- /);
  });

  it("a card opens to its outcomes, playing one moves the board and the place is kept in that browser", () => {
    const page = open();
    const first = page.doc.querySelector<HTMLButtonElement>(".bd-card")!;
    const cardTitle = first.textContent;
    first.click();
    expect(page.doc.querySelector(".bd-card-open")?.textContent).toBe(cardTitle);
    const outcome = page.doc.querySelector<HTMLButtonElement>(".bd-outcome:enabled")!;
    expect(outcome).toBeTruthy();
    outcome.click();
    const lines = page.texts(".tr-line");
    expect(lines[lines.length - 1]).toMatch(new RegExp(`^played "${cardTitle}" -> `));
    expect(page.doc.querySelector(".bd-card-open")).toBeNull();   // the open card closes on play
    // The saved place is in localStorage, under the project's content hash:
    // the engine's envelope AND the page's own @world container (the page is
    // the host; the envelope never carries @world - design/flows.md).
    const keys = Object.keys(page.dom.window.localStorage);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^storylets\.play\.proj_village\.[0-9a-z]+$/);
    const saved = JSON.parse(page.dom.window.localStorage.getItem(keys[0]!)!) as {
      engine: { schema: string; content: { project: string }; flows: Record<string, unknown> };
      world: Record<string, unknown>;
    };
    expect(saved.engine.schema).toBe("storylets/save@1");
    expect(saved.engine.content.project).toBe("proj_village");
    expect(Object.keys(saved.engine.flows)).toEqual(["main"]);
    expect(saved.world).toBeDefined();

    // A second visit resumes from the saved place rather than dealing afresh.
    const again = open(page.dom.window.localStorage);
    expect(again.texts(".tr-line")).toEqual(["(resumed where you left off)"]);
    expect(again.texts(".bd-card")).toEqual(page.texts(".bd-card"));

    // Next turn advances every clock and is kept too; Restart forgets the place.
    const turn = (): number => Number(again.texts("#header-line")[0]!.match(/turn (\d+)$/)![1]);
    const before = turn();
    again.control("Next turn").click();
    expect(turn()).toBe(before + 1);
    again.control("Restart").click();
    expect(again.texts("#header-line")[0]).toContain("Village turn 0");
    expect(again.texts(".tr-line")[0]).toBe("restarted (seed 7)");
    expect(Object.keys(again.dom.window.localStorage)).toEqual([]);
  });

  it("deals afresh when the saved place is not a save", () => {
    const first = open();
    first.dom.window.localStorage.setItem("storylets.play.proj_village.x", "{not json");
    const keys = Object.keys(first.dom.window.localStorage);
    // Put the junk under the real key, whatever the hash is.
    first.control("Next turn").click();
    const real = Object.keys(first.dom.window.localStorage).find((k) => !keys.includes(k))!;
    first.dom.window.localStorage.setItem(real, JSON.stringify({ schema: "something-else" }));
    const again = open(first.dom.window.localStorage);
    expect(again.texts(".tr-line")[0]).toMatch(/^dealt: /);
    expect(again.dom.window.localStorage.getItem(real)).toBeNull();
  });
});
