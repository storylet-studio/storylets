// ---------------------------------------------------------------------------
// The five reference stations, BUILT and then opened.
//
// The guard a typecheck cannot be, and the same one the Village client keeps:
// an app that still compiles but shows a blank screen, or a kiosk that boots
// straight past its handshake, is broken in the way a reference is worst
// broken - silently, and only for the venue copying it.
//
// So this builds them for real (which makes it the build gate too) and then
// opens each page in jsdom against the client's own fake server, and asserts
// the first screen. No server exists yet; the fake is the whole of what can be
// exercised, and it speaks the wire's types rather than a second copy of them.
//
// The precedents are `packages/village-client/test/plays.test.ts` and
// `packages/ops/test/export-html.test.ts`: build, open, drive, assert.
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
// @ts-expect-error a plain module beside the scripts, typed by use
import { withBuildLock } from "../../../scripts/test-build-lock.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { createFakeServer } from "../../client/test/fake-server.js";
import type { FakeServer } from "../../client/test/fake-server.js";
import { arrivalFrom } from "../src/companion.js";
import { faceFrom } from "../src/shell.js";
import { tokenFrom } from "../src/kiosk.js";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const dist = join(pkg, "dist");
const BASE = "http://venue.local";

/** Build them, exactly as a release would. A build failure is a test failure,
 *  which is the point: the apps and their page are one artefact.
 *
 *  Through `npm run build`, not by running the script directly: that is the
 *  Village client's lesson, collected the hard way on a clean CI runner. */
beforeAll(async () => {
  await withBuildLock(async () => {
    // Asynchronous on purpose: a synchronous child process blocks this worker's
    // event loop for the whole build, and on a slow runner vitest then times out
    // talking to the worker ("Timeout calling onTaskUpdate") with every test
    // green. Seen on CI 2026-09-05.
    await new Promise<void>((resolve, reject) => {
      execFile("npm", ["run", "build"], { cwd: pkg }, (err, _out, stderr) => (err ? reject(new Error(String(stderr || err))) : resolve()));
    });
  });
}, 180_000);

interface Opened {
  dom: JSDOM;
  doc: Document;
  server: FakeServer;
}

/**
 * The demo's own card, on the way past.
 *
 * The fake server's caretaker deck carries a `prompt` and nothing else, and it
 * is the wire fixture's content as well as this suite's, so it is not the place
 * to invent vocabulary. The content the stations actually meet (16.1) carries
 * three fields with three audiences - `text` is what the phone shows, `prompt`
 * is for the crew, `cue` is for a bridge - and outcomes written with purposes.
 * This dresses every card and every outcome in a response with exactly that, so
 * a face that leaks one audience's material onto another's screen fails here.
 */
function dress(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dress);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = dress(inner);
  const id = typeof out["id"] === "string" ? out["id"] : undefined;
  if (id !== undefined && typeof out["available"] === "boolean") {
    out["purpose"] = `Crew note: what ${id} is for.`;
  }
  if (id !== undefined && typeof out["fields"] === "object" && out["fields"] !== null) {
    out["fields"] = { text: `The story of ${id}.`, cue: "warm", ...(out["fields"] as object) };
  }
  return out;
}

/**
 * Open a built app with its script running, against the fake server.
 *
 * Two accommodations, both because jsdom is not a browser: the script tag is
 * inlined (jsdom loads no external resources), and `fetch` is answered from
 * `dist/` for the config and from the fake server for everything else, which
 * is exactly what a real static server plus a real Storylet Server do.
 */
function open(kind: string, opts: {
  url?: string;
  config?: Record<string, unknown>;
  storage?: Record<string, string>;
  server?: FakeServer;
  /** Dress every card and outcome as the demo's content does: `text`, `cue`,
   *  a purpose on the card and a purpose on each outcome. */
  rich?: boolean;
} = {}): Opened {
  const server = opts.server ?? createFakeServer({ base: BASE });
  const html = readFileSync(join(dist, kind, "index.html"), "utf8")
    .replace('<script src="app.js"></script>', `<script>${readFileSync(join(dist, kind, "app.js"), "utf8")}</script>`);
  const shipped = JSON.parse(readFileSync(join(dist, kind, "station.json"), "utf8")) as Record<string, unknown>;
  // The shipped config with the test's own server and key: a venue edits
  // exactly these fields and nothing else, which is the provisioning story.
  const config = { ...shipped, base: BASE, stationKey: "station-key", ...opts.config };

  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: opts.url ?? `${BASE}/${kind}/`,
    pretendToBeVisual: true,
    beforeParse(window) {
      const w = window as unknown as Record<string, unknown>;
      // jsdom gives a window no `TextEncoder`, and the QR encoder needs one to
      // turn a URL into bytes. Node has it; handing it over is the same
      // accommodation the Village client makes for `structuredClone`.
      w.TextEncoder = TextEncoder;
      w.TextDecoder = TextDecoder;
      w.EventSource = server.EventSource;
      w.fetch = (url: string, init?: { method: string; headers: Record<string, string>; body?: string }) => {
        if (url.endsWith("station.json")) {
          return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(config)) });
        }
        const answered = server.fetch(url, init ?? { method: "GET", headers: {} });
        if (opts.rich !== true) return answered;
        return answered.then((res) => ({
          ...res,
          text: () => res.text().then((body) => JSON.stringify(dress(JSON.parse(body)))),
        }));
      };
      for (const [k, v] of Object.entries(opts.storage ?? {})) window.localStorage.setItem(k, v);
    },
  });
  return { dom, doc: dom.window.document, server };
}

/** Wait for the page to draw something. The apps boot asynchronously (config,
 *  then hello, then the first screen), so every assertion waits for the thing
 *  it is about rather than for a fixed number of ticks. */
async function until(doc: Document, selector: string, timeoutMs = 3000): Promise<Element> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = doc.querySelector(selector);
    if (found !== null) return found;
    if (Date.now() > deadline) {
      throw new Error(`nothing matched ${selector} within ${timeoutMs}ms.\n${doc.body.innerHTML.slice(0, 1200)}`);
    }
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
}

describe("the build", () => {
  it("makes one self-contained folder per station kind", () => {
    for (const kind of ["kiosk", "crew", "companion", "sign-in", "house"]) {
      const page = readFileSync(join(dist, kind, "index.html"), "utf8");
      expect(page).toContain('<div id="app">');
      expect(page).toContain('<script src="app.js"></script>');
      const config = JSON.parse(readFileSync(join(dist, kind, "station.json"), "utf8")) as { kind: string };
      expect(config.kind).toBeTruthy();
    }
    // The companion holds a party token, never a key: a phone HOLDS and a
    // station VOUCHES (spec 7.1), and the shipped config must not suggest
    // otherwise.
    const companion = JSON.parse(readFileSync(join(dist, "companion", "station.json"), "utf8")) as Record<string, unknown>;
    expect(companion["stationKey"]).toBeUndefined();
  });
});

describe("the kiosk", () => {
  it("opens on the handshake, with a typed code and a walk-up", async () => {
    const { doc } = open("kiosk");
    await until(doc, ".sk-handshake");
    expect(doc.querySelector(".sk-code-entry input")).toBeTruthy();
    expect(doc.body.textContent).toContain("Start without a code");
    // Degraded mode is on screen from the first frame, not bolted on later.
    expect(doc.querySelector(".sk-banner")).toBeTruthy();
  });

  it("mints a walk-up party and deals its hands", async () => {
    const { doc, server } = open("kiosk", { rich: true });
    await until(doc, ".sk-handshake");
    doc.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      if (b.textContent === "Start without a code") b.click();
    });
    await until(doc, ".sk-card");
    expect(doc.body.textContent).toContain("Who let you in?");
    expect(server.requests.some((r) => r.path === "/v1/parties")).toBe(true);
    expect(server.requests.some((r) => r.path.endsWith("/deal"))).toBe(true);
    // A kiosk is a party's screen, so it wears the companion's face: the story
    // and nothing written for anybody behind the scenes.
    const page = doc.querySelector(".app-main")!.textContent ?? "";
    expect(page).toContain("The story of who-let-you-in.");
    expect(page).not.toContain("The opening beat");
    expect(page).not.toContain("Look them up and down");
  });

  it("says so when it has not been provisioned", async () => {
    const { doc } = open("kiosk", { config: { stationKey: undefined } });
    await until(doc, ".app-say");
    expect(doc.querySelector(".app-say")?.textContent).toContain("no station key");
    expect(doc.body.textContent).toContain("station.json");
  });

  it("refuses a config for another kind rather than half-working", async () => {
    const { doc } = open("kiosk", { config: { kind: "crew" } });
    await until(doc, ".sk-error");
    expect(doc.querySelector(".sk-error")?.textContent).toContain("this page is the fixed app");
  });
});

describe("the crew handset", () => {
  it("opens on where you are, who this is, and the control room", async () => {
    const { doc } = open("crew");
    await until(doc, ".sk-handshake");
    expect(doc.body.textContent).toContain("Where you are");
    expect(doc.body.textContent).toContain("Who is this?");
    expect(doc.querySelector(".sk-tray")).toBeTruthy();
    // The help call is the first thing a crew view needs after the prompt
    // list (spec 6.7).
    expect(doc.body.textContent).toContain("Call for help");
    expect(doc.querySelector(".sk-clock")).toBeTruthy();
    // A call sign may be presented from a crew station and nowhere else, so
    // the pick list is drawn even before there is anything in it.
    expect(doc.querySelector(".sk-callsign-block")?.hasAttribute("hidden")).toBe(false);
  });

  it("signs in to a wall and shows the zone the server derived from it", async () => {
    const { doc, server } = open("crew");
    await until(doc, "[data-location=\"the-door\"]");
    // The walls are the handset's own provisioning: a station key may not read
    // the venue's locations, so `station.json` names them (6.5).
    const walls = [...doc.querySelectorAll<HTMLButtonElement>(".sk-zone[data-location]")]
      .map((b) => b.textContent)
      // The last button is "Nowhere in particular", which is a real answer and
      // not a wall.
      .slice(0, -1);
    expect(walls).toEqual(["The door", "The window", "The table"]);

    doc.querySelector<HTMLButtonElement>("[data-location=\"the-door\"]")!.click();
    await until(doc, "[data-zone=\"the-threshold\"]");
    // A LOCATION went out; a ZONE came back. The device knows where it is and
    // the story's map is what names it (4a, 5.7).
    const sent = server.requests.find((r) => r.path === "/v1/stations/me/presence");
    expect(sent?.method).toBe("POST");
    expect(sent?.body).toEqual({ location: "the-door" });
    expect(doc.querySelector(".sk-zone-derived")?.textContent).toBe("the-threshold");
  });

  it("shows a broadcast addressed to the zone it is standing in", async () => {
    const server = createFakeServer({ base: BASE });
    const { doc } = open("crew", { server });
    await until(doc, ".sk-tray");
    expect(doc.querySelector(".sk-tray")?.textContent).toContain("Nothing from the control room");

    // Where this handset stands, and what the caretaker's map calls it.
    expect(server.presence.zone).toBe("the-parlour");
    server.seedMessage({ body: "Everyone inside, please", audience: { to: "zone", zone: "the-parlour" }, priority: "cue" });
    server.seedMessage({ body: "Not for this zone", audience: { to: "zone", zone: "the-threshold" } });

    await until(doc, ".sk-message-cue");
    const tray = doc.querySelector(".sk-tray")!.textContent ?? "";
    expect(tray).toContain("Everyone inside, please");
    expect(tray).not.toContain("Not for this zone");
  });

  it("acks once, however many times a thumb lands on it", async () => {
    const server = createFakeServer({ base: BASE });
    const { doc } = open("crew", { server });
    await until(doc, ".sk-tray");
    const message = server.seedMessage({ body: "Places", audience: { to: "everyone" }, ackRequired: true, priority: "urgent" });

    const seen = await until(doc, ".sk-message-urgent button") as HTMLButtonElement;
    seen.click();
    seen.click();
    seen.click();
    await until(doc, ".sk-tray");
    // The button goes the moment a thumb lands, so a second thumb has nothing
    // to press and a second ack is never sent.
    for (let i = 0; i < 10 && doc.querySelector(".sk-message-urgent button") !== null; i++) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    expect(doc.querySelector(".sk-message-urgent button")).toBeNull();
    const acks = server.requests.filter((r) => r.path === `/v1/messages/${message.id}/ack`);
    expect(acks).toHaveLength(1);
  });

  it("calls for help with where it is and who it is standing with", async () => {
    const server = createFakeServer({ base: BASE });
    const party = server.seedParty({ callSign: "quiet otter 9" });
    const { doc } = open("crew", { server });
    await until(doc, ".sk-handshake");
    const input = doc.querySelector<HTMLInputElement>(".sk-code-entry input")!;
    input.value = party.token;
    doc.querySelector<HTMLButtonElement>(".sk-code-entry button")!.click();
    await until(doc, ".sk-card");

    doc.querySelector<HTMLButtonElement>(".sk-help-button")!.click();
    await until(doc, ".sk-help-button[disabled]");
    const posted = (): typeof server.requests[number] | undefined =>
      server.requests.find((r) => r.path === "/v1/messages" && r.method === "POST");
    for (let i = 0; i < 40 && posted() === undefined; i++) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    const call = posted()!;
    const body = call.body as { body: string; priority: string; audience: { to: string }; ackRequired?: boolean };
    expect(body.priority).toBe("urgent");
    expect(body.audience).toEqual({ to: "producers" });
    expect(body.ackRequired).toBe(true);
    expect(body.body).toContain("Help");
    // Presence, and the party. There is no second field on the wire to put
    // them in, and a producer deciding who to send needs both (6.7).
    expect(body.body).toContain("The table");
    expect(body.body).toContain("the-parlour");
    expect(body.body).toContain("quiet otter 9");

    // The confirmation is the button itself, which is the one thumb-sized
    // thing on the screen: it says so rather than inviting a fourth press.
    const button = doc.querySelector<HTMLButtonElement>(".sk-help-button")!;
    for (let i = 0; i < 40 && button.textContent !== "Help is called"; i++) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    expect(button.textContent).toBe("Help is called");
    expect(button.disabled).toBe(true);
    // A help call goes TO the control room, so it does not land in this
    // handset's own tray.
    expect(doc.querySelector(".sk-tray")?.textContent).toContain("Nothing from the control room");
  });

  // DEGRADED MODE (spec 17 item 2): a crew handset keeps its prompt list, and
  // its tray with it. The catch-up asks what it MISSED, from the cursor it
  // kept, and merges: a performer who reconnected must not watch the control
  // room's last half hour disappear.
  it("keeps the tray across a drop, and catches up from the cursor it kept", async () => {
    const server = createFakeServer({ base: BASE });
    const { doc, dom } = open("crew", { server });
    await until(doc, ".sk-tray");

    const first = server.seedMessage({ body: "Houses open", audience: { to: "everyone" } });
    await until(doc, "[data-message]");
    expect(dom.window.localStorage.getItem("storylet.crew.since")).toBe(first.at);

    // The blip, and a message sent while nobody was listening.
    server.drop();
    server.seedMessage({ body: "Act two", audience: { to: "everyone" } });
    expect(doc.querySelector(".sk-tray")?.textContent).toContain("Houses open");

    for (let i = 0; i < 200 && !(doc.querySelector(".sk-tray")?.textContent ?? "").includes("Act two"); i++) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    const tray = doc.querySelector(".sk-tray")?.textContent ?? "";
    expect(tray).toContain("Act two");
    // Both, once each: the old one was never thrown away, and the new one
    // arrived exactly once.
    expect(tray).toContain("Houses open");
    expect(doc.querySelectorAll("[data-message]")).toHaveLength(2);
    // The catch-up asked from the cursor rather than for the whole run.
    expect(server.requests.some((r) => r.path === `/v1/messages?since=${encodeURIComponent(first.at)}`)).toBe(true);
  });

  it("shows the show clock and the phase, and follows the phase when it moves", async () => {
    const server = createFakeServer({ base: BASE });
    const { doc } = open("crew", { server });
    await until(doc, ".sk-clock-phase");
    for (let i = 0; i < 60 && doc.querySelector(".sk-clock-wall")?.textContent === ""; i++) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    // Minutes for the wall, as `time_wall` is: 872 is 14:32 (10.1).
    expect(doc.querySelector(".sk-clock-wall")?.textContent).toBe("14:32");
    expect(doc.querySelector(".sk-clock-phase")?.textContent).toBe("afternoon");

    server.emit({
      type: "world",
      path: "world.time_phase",
      value: "act-two",
      actor: { kind: "producer", label: "Priya (producer)" },
    } as never);
    for (let i = 0; i < 60 && doc.querySelector(".sk-clock-phase")?.textContent !== "act-two"; i++) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    expect(doc.querySelector(".sk-clock-phase")?.textContent).toBe("act-two");
  });

  it("shows the prompt list, with the purpose and the crew field", async () => {
    const server = createFakeServer({ base: BASE });
    const party = server.seedParty({});
    const { doc } = open("crew", { server, rich: true });
    await until(doc, ".sk-handshake");
    const input = doc.querySelector<HTMLInputElement>(".sk-code-entry input")!;
    input.value = party.token;
    doc.querySelector<HTMLButtonElement>(".sk-code-entry button")!.click();
    await until(doc, ".sk-outcome");
    const page = doc.querySelector(".app-main")!.textContent ?? "";
    expect(page).toContain("Who let you in?");
    expect(page).toContain("establish that somebody is expected");
    // The shipped crew face shows `prompt` and `cue`, and nothing else.
    expect(page).toContain("Look them up and down");
    expect(page).toContain("warm");
    expect(page).toContain("Done with this party");
    expect(page).toContain("What might come?");
    // A performer chooses BY the purpose: it is the author's note about what
    // the beat is for, and this is the one view written for a reader of it.
    expect(page).toContain("Crew note: what say-nothing is for.");
    // The button still SAYS the title. The purpose is a hint beside it, not
    // the label, so a performer reads one line and taps another.
    const buttons = [...doc.querySelectorAll<HTMLButtonElement>("[data-card=\"who-let-you-in\"] .sk-outcome")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Say nothing", "Give a name", "Show the key"]);
    // The party's own prose is not a stage direction, and a handset in the
    // dark shows the performer what to DO with the beat, not what the phone
    // in the visitor's hand already says.
    expect(doc.querySelector(".sk-card")?.textContent).not.toContain("The story of who-let-you-in.");
  });
});

describe("the companion page", () => {
  it("scans a placard and shows the hand at that place", async () => {
    const server = createFakeServer({ base: BASE });
    const party = server.seedParty({});
    const { doc } = open("companion", {
      url: `${BASE}/at/this-room/the-door`,
      storage: { "storylet.party.token": party.token },
      server,
    });
    await until(doc, ".sk-card");
    expect(doc.body.textContent).toContain("Who let you in?");
    expect(doc.body.textContent).toContain("Keep this story");
    expect(server.requests.some((r) => r.path === "/v1/at/this-room/the-door")).toBe(true);
  });

  // THE RULE (spec 5.7, 12): a card face is built by the station KIND, and a
  // party's screen shows a party's material. The title, the story, the
  // outcomes. Not the author's purpose, not the crew's prompt, not the
  // bridge's cue, and never an outcome's purpose smuggled in as the button's
  // accessible name, which a screen reader would read out loud.
  it("shows a visitor the story and the outcome titles, and nothing written for the crew", async () => {
    const server = createFakeServer({ base: BASE });
    const party = server.seedParty({});
    const { doc } = open("companion", {
      url: `${BASE}/at/this-room/the-door`,
      storage: { "storylet.party.token": party.token },
      server,
      rich: true,
    });
    await until(doc, ".sk-outcome");
    const face = doc.querySelector(".sk-card")!.textContent ?? "";
    expect(face).toContain("Who let you in?");
    expect(face).toContain("The story of who-let-you-in.");
    expect(face).toContain("Say nothing");
    expect(face).toContain("Give a name");

    // Author-facing, crew-facing and bridge-facing material, all off. Read
    // off the screen rather than off `document.body`, which in jsdom holds
    // the inlined script and would match half the app's own source.
    const page = doc.querySelector(".app-main")!.textContent ?? "";
    expect(page).not.toContain("The opening beat");
    expect(page).not.toContain("Look them up and down");
    expect(page).not.toContain("Crew note");
    expect(page).not.toMatch(/cue/i);
    expect(page).not.toContain("warm");
    // The body is prose, not a labelled row: a visitor is reading, not
    // consulting a table of the venue's vocabulary.
    expect(doc.querySelector(".sk-field-label")).toBeNull();

    // The accessible name is the title too. A `title` or `aria-label` carrying
    // the purpose is the same leak, said out loud instead of drawn.
    const buttons = [...doc.querySelectorAll<HTMLButtonElement>("[data-card=\"who-let-you-in\"] .sk-outcome")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Say nothing", "Give a name", "Show the key"]);
    for (const button of doc.querySelectorAll<HTMLButtonElement>(".sk-outcome")) {
      expect(button.getAttribute("aria-label") ?? "").not.toContain("Crew note");
      expect(button.getAttribute("title") ?? "").not.toContain("Crew note");
    }
  });

  it("heads a hand with what the venue calls it, and shouts at nobody", async () => {
    const server = createFakeServer({ base: BASE });
    const party = server.seedParty({});
    const { doc } = open("companion", {
      url: `${BASE}/at/this-room/the-door`,
      storage: { "storylet.party.token": party.token },
      server,
      config: { hands: { "at-the-door": "The door" } },
    });
    await until(doc, ".sk-card");
    expect(doc.querySelector(".sk-hand-title")?.textContent).toBe("The door");
    // The gameId is the fallback and nothing else: a visitor never reads one.
    expect(doc.body.textContent).not.toContain("at-the-door");
  });

  it("falls back to the gameId when the venue has named no hand", async () => {
    const server = createFakeServer({ base: BASE });
    const party = server.seedParty({});
    const { doc } = open("companion", {
      url: `${BASE}/at/this-room/the-door`,
      storage: { "storylet.party.token": party.token },
      server,
    });
    await until(doc, ".sk-card");
    expect(doc.querySelector(".sk-hand-title")?.textContent).toBe("at-the-door");
  });

  it("offers the chooser when the walls carry two stories and the phone holds nothing", async () => {
    const server = createFakeServer({ base: BASE, twoStories: true });
    const { doc } = open("companion", { url: `${BASE}/at/this-room/the-door`, server });
    await until(doc, "[data-installation]");
    expect(doc.body.textContent).toContain("Which story?");
    const buttons = [...doc.querySelectorAll<HTMLButtonElement>("[data-installation]")];
    expect(buttons.map((b) => b.textContent)).toEqual(["The Caretaker", "After Dark"]);
    buttons[1]!.click();
    await until(doc, ".sk-card");
    expect(doc.body.textContent).toContain("Not tonight");
  });

  it("keeps the token a walk-up scan minted, and makes the next call as that party", async () => {
    // The phone has never been here: no stored token, one story open, and the
    // scan is what mints the party (spec 7.1). Storing only the `/p/<token>`
    // form loses exactly this case.
    const server = createFakeServer({ base: BASE });
    const { doc, dom } = open("companion", { url: `${BASE}/at/this-room/the-door`, server });
    await until(doc, ".sk-card");

    const stored = dom.window.localStorage.getItem("storylet.party.token");
    expect(stored).toBeTruthy();

    const scan = server.requests.find((r) => r.path === "/v1/at/this-room/the-door");
    expect(scan?.bearer).toBe("none");
    // Everything after the scan carries the minted token. Before the fix this
    // was the phone still holding nothing, and a real server 401s.
    const after = server.requests.slice(server.requests.indexOf(scan!) + 1);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((r) => r.bearer === "party")).toBe(true);
  });

  // THE DEFECT, from a walk-up party on 2026-09-05. They pressed "Keep this
  // story", the keepsake QR came up, and the phone went on holding the day
  // pass: at the next run's first code it was a stranger again, and the pocket
  // it had just decided to keep was on the other side of a refusal.
  //
  // Issuing a permanent credential IS the claim (spec 7.1). So the keepsake is
  // what the phone holds from that moment, under the same key: one credential,
  // one place, replacing the one that dies with the run (7.3).
  it("keeps the keepsake the claim minted, in place of the day pass", async () => {
    const server = createFakeServer({ base: BASE });
    const dayPass = server.seedParty({ claimed: false });
    const { doc, dom } = open("companion", {
      url: `${BASE}/at/this-room/the-door`,
      storage: { "storylet.party.token": dayPass.token },
      server,
    });
    await until(doc, ".sk-card");

    const keep = [...doc.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Keep this story")!;
    keep.click();
    await until(doc, ".sk-qr svg");

    const stored = dom.window.localStorage.getItem("storylet.party.token");
    expect(stored).toBeTruthy();
    expect(stored).not.toBe(dayPass.token);

    // The run ends. The day pass goes with it, as a day pass does, and the
    // phone is holding the one thing that outlives it.
    server.endRun();
    const as = (token: string): Promise<{ ok: boolean; status: number }> =>
      server.fetch(`${BASE}/v1/hello`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{}" });
    expect((await as(stored!)).ok).toBe(true);
    expect((await as(dayPass.token)).status).toBe(401);
  });

  // THE SECOND DEFECT, on the same page: the refusal was drawn under a red
  // banner reading "No connection. Come back to this spot in a moment."
  //
  // A 4xx is an ANSWER. The server heard the phone and said which credential
  // it was holding; the banner is for a connection that is gone, and putting
  // it over the answer tells a visitor to wait at a wall for something that is
  // never coming (spec 17 item 2).
  it("shows a refusal as the answer it is, with no banner over the top", async () => {
    const server = createFakeServer({ base: BASE });
    const dayPass = server.seedParty({ claimed: false });
    server.endRun();
    const { doc } = open("companion", {
      url: `${BASE}/at/this-room/the-door`,
      storage: { "storylet.party.token": dayPass.token },
      server,
    });
    await until(doc, ".app-say");

    expect(doc.querySelector(".app-say")?.textContent).toContain("day pass for a run that has ended");
    const banner = doc.querySelector<HTMLElement>(".sk-banner")!;
    expect(banner.textContent).not.toContain("No connection");
    // The element stays in the page, as it does from the first frame; what it
    // must not do is say anything.
    expect(banner.hidden).toBe(true);
  });

  it("holds its token, so a reload is the same party", async () => {
    const { doc, dom } = open("companion", { url: `${BASE}/p/token-party-1` });
    await until(doc, ".sk-qr");
    expect(dom.window.localStorage.getItem("storylet.party.token")).toBe("token-party-1");
  });
});

describe("the sign-in station", () => {
  it("mints, shows the QR and the call sign, and only then offers the claim", async () => {
    const { doc, server } = open("sign-in");
    const mint = await until(doc, "button");
    expect(doc.body.textContent).toContain("New party");
    const claim = [...doc.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Claim (keepsake)")!;
    expect(claim.disabled).toBe(true);

    (mint as HTMLButtonElement).click();
    await until(doc, ".sk-qr svg");
    expect(claim.disabled).toBe(false);
    expect(doc.querySelector(".app-say")?.textContent).toMatch(/quiet otter/);
    expect(server.requests.some((r) => r.path === "/v1/parties")).toBe(true);
  });
});

describe("the house display", () => {
  it("draws the venue plan and the clock, and mirrors a cue", async () => {
    const { doc, server } = open("house");
    await until(doc, ".sk-map");
    expect(doc.querySelector(".sk-clock")).toBeTruthy();
    server.emit({
      type: "cue",
      flow: "house",
      bridge: "desk-lamp",
      verb: "play",
      card: "the-weather-outside",
      fields: { cue: "storm" },
    } as never);
    await until(doc, ".sk-quiet");
    expect(doc.body.textContent).toContain("cue: storm");
  });

  it("keeps three cues, newest first, and the phase in the corner", async () => {
    const { doc, server } = open("house");
    await until(doc, ".sk-map");
    // The phase is what a room reads at a glance, and it arrives as a `world`
    // event like any other `@world` write (10.1).
    for (let i = 0; i < 60 && doc.querySelector(".sk-clock-phase")?.textContent !== "afternoon"; i++) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    expect(doc.querySelector(".sk-clock-phase")?.textContent).toBe("afternoon");
    expect(doc.querySelector(".sk-clock-wall")?.textContent).toBe("14:32");

    server.emit({
      type: "world",
      path: "world.time_phase",
      value: "act-two",
      actor: { kind: "producer", label: "Priya (producer)" },
    } as never);
    for (let i = 0; i < 60 && doc.querySelector(".sk-clock-phase")?.textContent !== "act-two"; i++) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    expect(doc.querySelector(".sk-clock-phase")?.textContent).toBe("act-two");

    for (const cue of ["one", "two", "three", "four"]) {
      server.emit({ type: "cue", flow: "house", bridge: "desk-lamp", verb: "deal", card: cue } as never);
    }
    await until(doc, ".sk-quiet");
    for (let i = 0; i < 60 && !(doc.body.textContent ?? "").includes("four"); i++) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    // A wall is read at a glance or not at all: three deep, newest at the top.
    const lines = [...doc.querySelectorAll(".sk-quiet")].map((p) => p.textContent);
    expect(lines).toEqual(["deal four", "deal three", "deal two"]);
  });
});

// The companion is a PARTY, and there is no party audience on the wire (6.7).
// What the control room says to the floor is said to the venue's own devices;
// a visitor's phone is not one, and a party audience reaches it only through
// the stations standing with it. So: nothing in a message ever reaches this
// page, whoever it was addressed to.
describe("the companion and the control room", () => {
  it("ignores every message, however it is addressed", async () => {
    const server = createFakeServer({ base: BASE });
    const party = server.seedParty({});
    const { doc } = open("companion", {
      url: `${BASE}/at/this-room/the-door`,
      storage: { "storylet.party.token": party.token },
      server,
    });
    await until(doc, ".sk-card");

    server.seedMessage({ body: "Places, everyone", audience: { to: "everyone" }, priority: "urgent" });
    server.seedMessage({ body: "Crew only", audience: { to: "kind", kind: "crew" } });
    server.seedMessage({ body: "The parlour", audience: { to: "zone", zone: "the-parlour" } });
    server.seedMessage({ body: "Control room only", audience: { to: "producers" } });
    for (let i = 0; i < 20; i++) await new Promise((resolve) => { setTimeout(resolve, 10); });

    const page = doc.querySelector(".app-main")!.textContent ?? "";
    for (const said of ["Places, everyone", "Crew only", "The parlour", "Control room only"]) {
      expect(page).not.toContain(said);
    }
    // And it never asked, either: a companion has no tray to fill.
    expect(server.requests.some((r) => r.path.startsWith("/v1/messages"))).toBe(false);
  });
});

describe("the pieces a rebuild always needs", () => {
  it("reads both QR routes off a path", () => {
    expect(arrivalFrom("/p/token-9")).toEqual({ at: "party", token: "token-9" });
    expect(arrivalFrom("/at/this-room/the-door")).toEqual({ at: "location", venue: "this-room", location: "the-door" });
    expect(arrivalFrom("/at/this-room/the-door/")).toEqual({ at: "location", venue: "this-room", location: "the-door" });
    expect(arrivalFrom("/kiosk/")).toEqual({ at: "nowhere" });
  });

  it("takes a token from a QR URL or from a bare token typed in", () => {
    expect(tokenFrom("http://venue.local/p/token-9")).toBe("token-9");
    expect(tokenFrom("  token-9  ")).toBe("token-9");
  });

  it("builds a card face from the station KIND, and lets station.json say the rest", () => {
    // The author-facing switches are the KIND's and not the venue's: a
    // companion that could be talked into showing a purpose by an edit to
    // station.json is one typo from putting the author's notes on a phone.
    for (const kind of ["companion", "fixed", "house"] as const) {
      const face = faceFrom(kind, { body: "text", show: [{ field: "cue", label: "Cue" }] });
      expect(face.purpose).toBe(false);
      expect(face.outcomePurpose).toBe(false);
    }
    const crew = faceFrom("crew", { show: [{ field: "prompt" }] });
    expect(crew.purpose).toBe(true);
    expect(crew.outcomePurpose).toBe(true);
    expect(crew.body).toBeUndefined();
    expect(crew.show).toEqual([{ field: "prompt" }]);
  });
});
