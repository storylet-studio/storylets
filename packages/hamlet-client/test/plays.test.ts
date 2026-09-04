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
import { checkPairing, checkWorld } from "../scripts/pairing.mjs";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const dist = join(pkg, "dist");

// Through `npm run build`, never the script directly: the package's `prebuild`
// is what makes the ops/compiler `dist/` this build reads exist, and skipping
// it passes locally and fails on the first clean CI run.
beforeAll(() => {
  // CI tests before it builds, and the client copies the drop-in the play-helpers
  // package builds: build the libraries first when it is missing (local runs skip this).
  const dropIn = join(pkg, "../play-helpers/dist/storyletengine.min.js");
  if (!existsSync(dropIn)) execFileSync("npm", ["run", "build:libs"], { cwd: join(pkg, "../.."), stdio: "pipe" });
  execFileSync("npm", ["run", "build"], { cwd: pkg, stdio: "pipe" });
}, 600_000);

function open(storage?: Record<string, string>): { doc: Document } {
  // No bundle to inline: the page is five classic scripts, each inlined from dist/ in order.
  const html = readFileSync(join(dist, "index.html"), "utf8")
    .replace(/<script src="([^"]+)"><\/script>/g, (_m, src) => `<script>${readFileSync(join(dist, src), "utf8")}</script>`);
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
/** The demo opens with ONE card, the arrival at the gate; playing it moves the act
 *  and the rest of the village deals. Every playthrough starts here. */
const arrive = (doc: Document): void => {
  click(byText(doc, ".place", "The Inn"));
  click(byText(doc, ".card", "Arrive at the Village Gate"));
  click(byText(doc, ".continue", "Continue"));
};

let linesByDay: string[] = [];

describe("the Hamlet client", () => {
  it("pairs every card with a scene, and every scene with a card", () => {
    const storylets = JSON.parse(readFileSync(join(dist, "hamlet.storyletsc"), "utf8"));
    const patter = JSON.parse(readFileSync(join(dist, "hamlet.patterc"), "utf8"));
    expect(checkPairing(storylets, patter, ["village"])).toEqual([]);   // the box the host performs, as the build checks it
  });

  it("deals a hand, hands the card to Patter, and plays what the scene reports back", async () => {
    const { doc } = open();
    await settled(doc);
    // The demo opens where there is something to do: the first hand that deals a card.
    expect(doc.querySelector(".place.here")?.textContent).toBe("The Inn");
    expect(buttons(doc, ".card").map((b) => b.textContent)).toEqual(["Arrive at the Village Gate"]);
    arrive(doc);

    // The Storylet Engine's part: arriving at a place deals that place's hand.
    click(byText(doc, ".place", "The Inn"));
    const dealt = buttons(doc, ".card").map((b) => b.textContent);
    expect(dealt).toContain("Get Settled at the Inn");

    // The handoff: the card's gameId names a Patter scene, with no field
    // anywhere saying so. If this renders nothing, the convention is broken.
    click(byText(doc, ".card", "Get Settled at the Inn"));
    expect(doc.querySelector("#stage p")?.textContent, "the scene of that name rendered a line").toBeTruthy();
    const options = buttons(doc, ".option").map((b) => b.textContent);
    expect(options).toEqual(["Ask warmly about the village's history", "Ask only about the road north"]);

    // The return path: choosing in Patter fires a gameEvent, whose outcome id
    // the host plays through the Storylet Engine. THE WORLD MUST MOVE.
    click(byText(doc, ".option", "Ask warmly about the village's history"));

    click(byText(doc, ".continue", "Continue"));   // the scene has ended; the outcome plays when the player continues
    expect(doc.getElementById("log")!.textContent).toContain("ask-about-history");
    const after = buttons(doc, ".card").map((b) => b.textContent);
    expect(after).not.toContain("Get Settled at the Inn");   // redraw: never
    expect(after).not.toEqual(dealt);                        // the hand really changed
  });

  it("restores both engines and the world from ONE save", async () => {
    const first = open();
    await settled(first.doc);
    arrive(first.doc);
    click(byText(first.doc, ".place", "The Inn"));
    click(byText(first.doc, ".card", "Get Settled at the Inn"));
    click(byText(first.doc, ".option", "Ask only about the road north"));

    click(byText(first.doc, ".continue", "Continue"));   // the scene has ended; the outcome plays when the player continues
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
    arrive(doc);
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
    arrive(first.doc);
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

    click(byText(second.doc, ".continue", "Continue"));   // the scene has ended; the outcome plays when the player continues
    expect(second.doc.getElementById("log")!.textContent).toContain("ask-about-the-road-north");
    expect(buttons(second.doc, ".card").map((b) => b.textContent)).not.toContain("Get Settled at the Inn");
  });

  // @world in BOTH directions. Until this test the sharing was proven one way
  // only: the host moved time and storylet content re-gated. Here a Patter
  // scene READS the world (a night-only line) and WRITES it (knows_road), and
  // the Storylet Engine deals a card because of what was said in dialogue.
  it("lets a Patter scene read @world, and write a value a storylet card then gates on", async () => {
    const { doc } = open();
    await settled(doc);
    arrive(doc);
    // "The Road North" is a forest beat gated ONLY on @world.knows_road. The tree
    // hand has one slot and the card outranks the ambient, so it is unmissable.
    const forest = () => { click(byText(doc, ".place", "The Mystic Tree")); return buttons(doc, ".card").map((b) => b.textContent); };
    expect(forest()).not.toContain("The Road North");   // nobody has asked about the road yet

    // READ: by day the inn scene has no night line; at night it does.
    click(byText(doc, ".place", "The Inn"));
    click(byText(doc, ".card", "Get Settled at the Inn"));
    const byDay = [...doc.querySelectorAll("#stage p")].map((p) => p.textContent ?? "");
    linesByDay = byDay;   // the night test below compares against these
    // WRITE: asking about the road sets @world.knows_road from inside Patter...
    click(byText(doc, ".option", "Ask only about the road north"));

    click(byText(doc, ".continue", "Continue"));   // the scene has ended; the outcome plays when the player continues
    expect(doc.getElementById("clock")!.textContent).toContain("knows_road");
    // ...and the Storylet Engine, holding the same resolver, can now deal the card
    // gated on it. NOT yet at the tree, though: that hand has one slot, and the
    // ambient already holding it is still eligible, so it keeps its seat. A
    // refresh evicts the ineligible and fills empty slots; it never displaces a
    // survivor. That is the engine's rule, and it is easy to read as "the
    // dialogue did nothing", so it is pinned here on purpose.
    expect(forest()).toEqual(["Wind in the Leaves"]);
    // Act there (play the ambient), and the seat frees: the road card lands.
    click(byText(doc, ".card", "Wind in the Leaves"));
    click(byText(doc, ".continue", "Continue"));   // one outcome, no choice: its lines still wait to be read
    expect(doc.getElementById("log")!.textContent).toContain("Wind in the Leaves");
    expect(forest()).toContain("The Road North");
  });

  it("shows the night line when the world says night (the read direction, on its own)", async () => {
    const { doc } = open();
    await settled(doc);
    arrive(doc);
    doc.getElementById("wait")!.click();                     // day -> night, by the HOST
    click(byText(doc, ".place", "The Inn"));
    click(byText(doc, ".card", "Get Settled at the Inn"));
    const lines = [...doc.querySelectorAll("#stage p")].map((p) => p.textContent ?? "");
    // The inn says one thing by day and another by night, each gated on
    // @world.time_of_day: the two runs differ by exactly one line each way,
    // whatever the words are.
    expect(lines.filter((l) => !linesByDay.includes(l))).toHaveLength(1);
    expect(linesByDay.filter((l) => !lines.includes(l))).toHaveLength(1);
  });

  it("refuses a @world declaration the two projects disagree on", () => {
    const s = JSON.parse(readFileSync(join(dist, "hamlet.storyletsc"), "utf8"));
    const p = JSON.parse(readFileSync(join(dist, "hamlet.patterc"), "utf8"));
    expect(checkWorld(s, p)).toEqual([]);
    const drifted = structuredClone(p);
    drifted.scopeRegistry.scopes[0].declarations.find((d: { name: string }) => d.name === "time_of_day").values = ["day", "dusk", "night"];
    expect(checkWorld(s, drifted).join("\n")).toMatch(/time_of_day has values/);
    delete drifted.scopeRegistry.scopes[0].declarations[1];
    drifted.scopeRegistry.scopes[0].declarations = drifted.scopeRegistry.scopes[0].declarations.filter(Boolean);
    expect(checkWorld(s, drifted).join("\n")).toMatch(/knows_road is declared by the storylet project and not/);
    // The Hamlet declares nothing read-only (both projects let a scene or a card move
    // time), so the read-only rules are checked against a STRICT copy of Patter's side.
    const strict = structuredClone(p);
    strict.scopeRegistry.scopes[0].declarations.find((d: { name: string }) => d.name === "time_of_day").writable = false;
    // The two promises must match: writable on one side and read-only on the other is drift.
    expect(checkWorld(s, strict).join("\n")).toMatch(/time_of_day is writable in the storylet project and read-only in the Patter project/);
    // A card writing a property Patter holds read-only: legal on our side, so only this catches it.
    const writes = structuredClone(s);
    writes.world.properties.find((d: { name: string }) => d.name === "time_of_day").writable = false;
    writes.boxes[0].decks[0].cards[0].outcomes[0].changes = { "@world.time_of_day": { src: "\"night\"", ast: ["s", "night"] } };
    expect(checkWorld(writes, strict).join("\n")).toMatch(/writes @world\.time_of_day, which the Patter project declares read-only/);
  });

  it("keeps what the scene said on stage until the player continues, and resumes there", async () => {
    const first = open();
    await settled(first.doc);
    arrive(first.doc);
    click(byText(first.doc, ".place", "The Mystic Tree"));
    // One outcome and no choice: the whole scene is its closing lines. Before
    // this test they were played and redealt over in the same click, unread.
    click(byText(first.doc, ".card", "Wind in the Leaves"));
    const said = [...first.doc.querySelectorAll("#stage p")].map((p) => p.textContent);
    expect(said.length).toBeGreaterThan(0);
    expect(buttons(first.doc, ".continue")).toHaveLength(1);
    expect(first.doc.getElementById("log")!.textContent, "not played yet").not.toContain("Wind in the Leaves");
    const saved = (first.doc.defaultView as unknown as Window).localStorage.getItem("the-hamlet/save@1")!;
    expect(JSON.parse(saved).performing.done, "an ended, unread scene is in the envelope").toBe(true);

    // Come back: the same lines, still waiting, and continuing plays the outcome.
    const second = open({ "the-hamlet/save@1": saved });
    await settled(second.doc);
    expect([...second.doc.querySelectorAll("#stage p")].map((p) => p.textContent)).toEqual(said);
    click(byText(second.doc, ".continue", "Continue"));
    expect(second.doc.getElementById("log")!.textContent).toContain("Wind in the Leaves");
    expect(JSON.parse((second.doc.defaultView as unknown as Window).localStorage.getItem("the-hamlet/save@1")!).performing).toBeNull();
  });

  it("restarts: forgets the save and boots fresh", async () => {
    const first = open();
    await settled(first.doc);
    arrive(first.doc);
    click(byText(first.doc, ".place", "The Inn"));
    click(byText(first.doc, ".card", "Get Settled at the Inn"));
    click(byText(first.doc, ".option", "Ask only about the road north"));

    click(byText(first.doc, ".continue", "Continue"));   // the scene has ended; the outcome plays when the player continues
    const w = first.doc.defaultView as unknown as Window & { location: { reload: () => void } };
    expect(w.localStorage.getItem("the-hamlet/save@1")).not.toBeNull();
    // jsdom's reload is a no-op, so assert the half the handler owns: the save is gone.
    first.doc.getElementById("restart")!.click();
    expect(w.localStorage.getItem("the-hamlet/save@1")).toBeNull();
    const second = open();
    await settled(second.doc);
    expect(second.doc.getElementById("clock")!.textContent).toBe("day");
    // A fresh boot opens where there is something to do: the gate card, at the inn.
    expect(buttons(second.doc, ".card").map((b) => b.textContent)).toEqual(["Arrive at the Village Gate"]);
  });
});
