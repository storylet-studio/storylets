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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { createFakeServer } from "../../client/test/fake-server.js";
import type { FakeServer } from "../../client/test/fake-server.js";
import { arrivalFrom } from "../src/companion.js";
import { templateFrom } from "../src/shell.js";
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
  // Asynchronous on purpose: a synchronous child process blocks this worker's
  // event loop for the whole build, and on a slow runner vitest then times out
  // talking to the worker ("Timeout calling onTaskUpdate") with every test
  // green. Seen on CI 2026-09-05.
  await new Promise<void>((resolve, reject) => {
    execFile("npm", ["run", "build"], { cwd: pkg }, (err, _out, stderr) => (err ? reject(new Error(String(stderr || err))) : resolve()));
  });
}, 180_000);

interface Opened {
  dom: JSDOM;
  doc: Document;
  server: FakeServer;
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
        return server.fetch(url, init ?? { method: "GET", headers: {} });
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
    const { doc, server } = open("kiosk");
    await until(doc, ".sk-handshake");
    doc.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      if (b.textContent === "Start without a code") b.click();
    });
    await until(doc, ".sk-card");
    expect(doc.body.textContent).toContain("Who let you in?");
    expect(server.requests.some((r) => r.path === "/v1/parties")).toBe(true);
    expect(server.requests.some((r) => r.path.endsWith("/deal"))).toBe(true);
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

  it("shows the prompt list, with the purpose and the crew field", async () => {
    const server = createFakeServer({ base: BASE });
    const party = server.seedParty({});
    const { doc } = open("crew", { server });
    await until(doc, ".sk-handshake");
    const input = doc.querySelector<HTMLInputElement>(".sk-code-entry input")!;
    input.value = party.token;
    doc.querySelector<HTMLButtonElement>(".sk-code-entry button")!.click();
    await until(doc, ".sk-card");
    expect(doc.body.textContent).toContain("Who let you in?");
    expect(doc.body.textContent).toContain("establish that somebody is expected");
    // The shipped crew template shows `prompt` and `cue`, and nothing else.
    expect(doc.body.textContent).toContain("Look them up and down");
    expect(doc.body.textContent).toContain("Done with this party");
    expect(doc.body.textContent).toContain("What might come?");
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

  it("turns station.json's field list into a template", () => {
    const template = templateFrom([{ field: "prompt" }, { field: "cue", label: "Cue" }])!;
    expect(template({ id: "c", fields: { prompt: "Look up.", cue: "storm", note: "ignored" } })).toEqual([
      { key: "prompt", value: "Look up." },
      { key: "cue", label: "Cue", value: "storm" },
    ]);
    expect(templateFrom(undefined)).toBeUndefined();
  });
});
