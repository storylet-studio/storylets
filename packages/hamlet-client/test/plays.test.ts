// The Hamlet client, built and then PLAYED, with both engines running.
//
// The Village's `plays.test.ts` is the model and the reasoning there applies
// unchanged. What this suite adds is the thing this sample exists to prove:
// that a choice made in PATTER moves the world the STORYLET ENGINE deals from,
// and that one save restores both.
//
// It builds for real, which makes it the build gate too - and the build runs
// the pairing cross-check, so a card whose scene went missing fails here.

import { describe, expect, it, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { checkPairing } from "../scripts/pairing.mjs";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const dist = join(pkg, "dist");

// Through `npm run build`, never the script directly: the package's `prebuild`
// is what makes the ops/compiler `dist/` this build reads exist, and skipping
// it passes locally and fails on the first clean CI run.
beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: pkg, stdio: "pipe" });
}, 300_000);

function open(storage?: Record<string, string>): { doc: Document } {
  const html = readFileSync(join(dist, "index.html"), "utf8")
    .replace('<script src="hamlet.js"></script>', `<script>${readFileSync(join(dist, "hamlet.js"), "utf8")}</script>`);
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://localhost/hamlet/",
    beforeParse(window) {
      const w = window as unknown as Record<string, unknown>;
      w.structuredClone = structuredClone;
      w.fetch = (url: string) => {
        const file = join(dist, url.replace(/^.*\//, ""));
        if (!existsSync(file)) return Promise.reject(new Error(`no ${url}`));
        const text = readFileSync(file, "utf8");
        return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(text)) });
      };
      for (const [k, v] of Object.entries(storage ?? {})) window.localStorage.setItem(k, v);
    },
  });
  return { doc: dom.window.document };
}

const settled = async (doc: Document): Promise<void> => {
  for (let i = 0; i < 200; i++) {
    if (doc.querySelector(".place") !== null) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("the client never painted");
};

const buttons = (doc: Document, sel: string): HTMLButtonElement[] =>
  [...doc.querySelectorAll<HTMLButtonElement>(sel)];
const click = (b: HTMLButtonElement | undefined): void => {
  expect(b, "a button to click").toBeDefined();
  b!.click();
};
const byText = (doc: Document, sel: string, text: string): HTMLButtonElement | undefined =>
  buttons(doc, sel).find((b) => b.textContent === text);

describe("the Hamlet client", () => {
  it("pairs every card with a scene, and every scene with a card", () => {
    const storylets = JSON.parse(readFileSync(join(dist, "hamlet.storyletsc"), "utf8"));
    const patter = JSON.parse(readFileSync(join(dist, "hamlet.patterc"), "utf8"));
    expect(checkPairing(storylets, patter)).toEqual([]);
  });

  it("deals a hand, hands the card to Patter, and plays what the scene reports back", async () => {
    const { doc } = open();
    await settled(doc);

    // The Storylet Engine's part: arriving at a place deals that place's hand.
    click(byText(doc, ".place", "The Inn"));
    const dealt = buttons(doc, ".card").map((b) => b.textContent);
    expect(dealt).toContain("Get Settled at the Inn");

    // The handoff: the card's gameId names a Patter scene, with no field
    // anywhere saying so. If this renders nothing, the convention is broken.
    click(byText(doc, ".card", "Get Settled at the Inn"));
    expect(doc.querySelector("p.text")?.textContent).toMatch(/Get Settled at the Inn/);
    const options = buttons(doc, ".option").map((b) => b.textContent);
    expect(options).toEqual(["Ask warmly about the village's history", "Ask only about the road north"]);

    // The return path: choosing in Patter fires a gameEvent, whose outcome id
    // the host plays through the Storylet Engine. THE WORLD MUST MOVE.
    click(byText(doc, ".option", "Ask warmly about the village's history"));
    expect(doc.getElementById("log")!.textContent).toContain("ask-about-history");
    const after = buttons(doc, ".card").map((b) => b.textContent);
    expect(after).not.toContain("Get Settled at the Inn");   // redraw: never
    expect(after).not.toEqual(dealt);                        // the hand really changed
  });

  it("restores both engines and the world from ONE save", async () => {
    const first = open();
    await settled(first.doc);
    click(byText(first.doc, ".place", "The Inn"));
    click(byText(first.doc, ".card", "Get Settled at the Inn"));
    click(byText(first.doc, ".option", "Ask only about the road north"));
    const hand = buttons(first.doc, ".card").map((b) => b.textContent);
    const saved = (first.doc.defaultView as unknown as Window).localStorage.getItem("the-hamlet/save@1")!;

    // One envelope: each engine's own state, plus @world, which the HOST saves
    // because neither engine puts it in its own envelope.
    const envelope = JSON.parse(saved);
    expect(Object.keys(envelope).sort()).toEqual(["at", "patter", "performing", "storylets", "world"]);
    expect(envelope.performing, "nothing in flight between cards").toBeNull();
    expect(envelope.world).toMatchObject({ time_of_day: expect.any(String) });

    const second = open({ "the-hamlet/save@1": saved });
    await settled(second.doc);
    expect(buttons(second.doc, ".card").map((b) => b.textContent)).toEqual(hand);
  });

  it("shares one @world between the two engines", async () => {
    const { doc } = open();
    await settled(doc);
    const clock = () => doc.getElementById("clock")!.textContent;
    expect(clock()).toBe("day");
    doc.getElementById("wait")!.click();
    expect(clock()).toBe("night");
    // The storylet side gates on @world.time_of_day, so night content is now
    // reachable: proof the resolver the host handed to BOTH engines is live.
    click(byText(doc, ".place", "The Mystic Tree"));
    expect(buttons(doc, ".card").length).toBeGreaterThan(0);
  });

  // THE save test that matters. A save taken between cards is the easy case:
  // nothing is in flight, so nothing can be lost. This one is taken with a
  // choice on screen, and the first cut of the client failed it - the player
  // came back to the hand with the conversation gone.
  it("resumes a scene that was mid-performance when the tab closed", async () => {
    const first = open();
    await settled(first.doc);
    click(byText(first.doc, ".place", "The Inn"));
    click(byText(first.doc, ".card", "Get Settled at the Inn"));
    const spoken = [...first.doc.querySelectorAll("p")].map((p) => p.textContent);
    const options = buttons(first.doc, ".option").map((b) => b.textContent);
    expect(options).toHaveLength(2);
    const saved = (first.doc.defaultView as unknown as Window).localStorage.getItem("the-hamlet/save@1")!;
    expect(JSON.parse(saved).performing, "the in-flight card belongs in the envelope").toBeTruthy();

    // Come back: the same conversation, at the same point, still answerable.
    const second = open({ "the-hamlet/save@1": saved });
    await settled(second.doc);
    expect([...second.doc.querySelectorAll("p")].map((p) => p.textContent)).toEqual(spoken);
    expect(buttons(second.doc, ".option").map((b) => b.textContent)).toEqual(options);

    // And finishing it still moves the storylet world, which is the whole point:
    // a resumed performance is not a cosmetic redraw.
    click(byText(second.doc, ".option", "Ask only about the road north"));
    expect(second.doc.getElementById("log")!.textContent).toContain("ask-about-the-road-north");
    expect(buttons(second.doc, ".card").map((b) => b.textContent)).not.toContain("Get Settled at the Inn");
  });
});
