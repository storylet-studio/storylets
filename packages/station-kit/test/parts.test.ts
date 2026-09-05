// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Every part, rendered and updated.
//
// The guard a typecheck cannot be: a part that still compiles but draws an
// empty hand, hides a gated outcome, or leaves an interval running after
// `dispose` is broken in exactly the way a kit is worst broken - quietly, in
// somebody else's venue.
//
// jsdom, per file, through the docblock above, so no shared config has to know
// this package exists.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DealtCardView, LocationView, MessageView, VenueView } from "@storylet-studio/wire";
import {
  connectionBannerPart, defaultTemplate, handPart, handshakePart, helpButtonPart, installKitStyles,
  messageTrayPart, onlyFields, qrPart, showClockPart, showTime, venueMapPart, zoneStripPart,
} from "../src/index.js";
import type { Part } from "../src/index.js";

const mounted: { dispose(): void }[] = [];
/** Mount a part and have it disposed after the test, whatever it is: the
 *  return type is the part's own, so a `QrPart`'s `ready` survives. */
const keep = <P extends { dispose(): void }>(part: P): P => {
  mounted.push(part);
  return part;
};
afterEach(() => {
  for (const part of mounted.splice(0, mounted.length)) part.dispose();
  document.body.replaceChildren();
});

const CARDS: DealtCardView[] = [
  {
    id: "who-let-you-in",
    title: "Who let you in?",
    purpose: "Establish that somebody is expected.",
    fields: { prompt: "Look them up and down.", cue: "house-lights-half" },
  },
  { id: "the-key-under-the-mat", title: "The key under the mat" },
];

describe("the hand", () => {
  it("draws a card per entry, with its title, purpose and fields", () => {
    const part = keep(handPart({ onPlay: () => {} }));
    part.update({ hand: "at-the-door", cards: CARDS });
    expect(part.el.querySelectorAll(".sk-card")).toHaveLength(2);
    expect(part.el.querySelector(".sk-card-title")?.textContent).toBe("Who let you in?");
    expect(part.el.querySelector(".sk-card-purpose")?.textContent).toContain("expected");
    // `prompt` comes first: it is what a performer reads first (spec 5.7).
    const values = [...part.el.querySelectorAll(".sk-field-value")].map((n) => n.textContent);
    expect(values).toEqual(["Look them up and down.", "house-lights-half"]);
  });

  it("shows a gated outcome DISABLED, never hidden", () => {
    const part = keep(handPart({ onPlay: () => {} }));
    part.update({
      hand: "at-the-door",
      cards: [CARDS[0]!],
      outcomes: {
        "who-let-you-in": [
          { id: "say-nothing", title: "Say nothing", available: true },
          { id: "show-the-key", title: "Show the key", available: false },
        ],
      },
    });
    const buttons = [...part.el.querySelectorAll<HTMLButtonElement>(".sk-outcome")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Say nothing", "Show the key"]);
    expect(buttons.map((b) => b.disabled)).toEqual([false, true]);
  });

  it("plays once, however many times a thumb lands on it", () => {
    const plays: string[] = [];
    const part = keep(handPart({ onPlay: (card, outcome) => plays.push(`${card}/${outcome}`) }));
    part.update({
      hand: "at-the-door",
      cards: [CARDS[0]!],
      outcomes: { "who-let-you-in": [{ id: "say-nothing", available: true }] },
    });
    const button = part.el.querySelector<HTMLButtonElement>(".sk-outcome")!;
    button.click();
    button.click();
    button.click();
    expect(plays).toEqual(["who-let-you-in/say-nothing"]);
  });

  it("disables everything while held, and says so when the hand is empty", () => {
    const part = keep(handPart({ onPlay: () => {}, emptyText: "Nothing here yet." }));
    part.update({
      hand: "at-the-door",
      cards: [CARDS[0]!],
      outcomes: { "who-let-you-in": [{ id: "say-nothing", available: true }] },
      busy: true,
    });
    expect(part.el.querySelector<HTMLButtonElement>(".sk-outcome")?.disabled).toBe(true);
    part.update({ hand: "at-the-door", cards: [] });
    expect(part.el.querySelector(".sk-hand-empty")?.textContent).toBe("Nothing here yet.");
  });

  it("asks for outcomes it has not been given, once per card", () => {
    const asked: string[] = [];
    const part = keep(handPart({ onPlay: () => {}, onWantOutcomes: (card) => asked.push(card) }));
    part.update({ hand: "at-the-door", cards: CARDS });
    part.update({ hand: "at-the-door", cards: CARDS });
    expect(asked).toEqual(["who-let-you-in", "the-key-under-the-mat"]);
  });
});

describe("the field template", () => {
  it("is the venue's, and can drop everything", () => {
    const part = keep(handPart({ onPlay: () => {}, template: onlyFields({ cue: "Lighting" }) }));
    part.update({ hand: "at-the-door", cards: [CARDS[0]!] });
    expect([...part.el.querySelectorAll(".sk-field-label")].map((n) => n.textContent)).toEqual(["Lighting"]);
    expect(part.el.querySelector(".sk-field-value")?.textContent).toBe("house-lights-half");
  });

  it("labels from the field name, and shows a false flag rather than hiding it", () => {
    const rows = defaultTemplate({ id: "c", fields: { time_phase: "evening", lit: false } });
    expect(rows).toEqual([
      { key: "time_phase", label: "Time phase", value: "evening" },
      { key: "lit", label: "Lit", value: "no" },
    ]);
  });
});

describe("the handshake screen", () => {
  it("offers the typed code when there is no camera, which is jsdom and most kiosks", () => {
    const codes: string[] = [];
    const part = keep(handshakePart({ onCode: (code) => codes.push(code) }));
    part.update({});
    expect(part.el.querySelector(".sk-scanner")?.hasAttribute("hidden")).toBe(true);
    const input = part.el.querySelector<HTMLInputElement>(".sk-code-entry input")!;
    input.value = "  token-7  ";
    part.el.querySelector<HTMLButtonElement>(".sk-code-entry button")!.click();
    expect(codes).toEqual(["token-7"]);
    expect(input.value).toBe("");
  });

  it("shows a refusal in the server's own words", () => {
    const part = keep(handshakePart({ onCode: () => {} }));
    part.update({ error: "that credential is not known here" });
    expect(part.el.querySelector(".sk-error")?.textContent).toBe("that credential is not known here");
    part.update({});
    expect(part.el.querySelector(".sk-error")?.hasAttribute("hidden")).toBe(true);
  });

  it("draws the call-sign pick list only when it is given one", () => {
    const picked: string[] = [];
    const part = keep(handshakePart({ onCode: () => {}, onCallSign: (c) => picked.push(c) }));
    part.update({});
    expect(part.el.querySelector<HTMLElement>(".sk-callsign-block")?.hidden).toBe(true);
    part.update({ callSigns: [{ callSign: "quiet otter", hint: "arrived 14:02" }] });
    const button = part.el.querySelector<HTMLButtonElement>("[data-callsign]")!;
    expect(button.textContent).toBe("quiet otter (arrived 14:02)");
    button.click();
    expect(picked).toEqual(["quiet otter"]);
  });

  it("reads a QR when the browser has a detector, and stops the camera on dispose", async () => {
    const stop = vi.fn();
    const codes: string[] = [];
    vi.useFakeTimers();
    const part = handshakePart({
      onCode: (c) => codes.push(c),
      BarcodeDetector: class {
        detect(): Promise<{ rawValue: string }[]> {
          return Promise.resolve([{ rawValue: "http://venue.local/p/token-9" }]);
        }
      } as never,
      getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream),
    });
    part.update({});
    await vi.advanceTimersByTimeAsync(0);
    expect(part.el.querySelector(".sk-scanner")?.hasAttribute("hidden")).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(codes).toEqual(["http://venue.local/p/token-9"]);
    // The same code again is not a second handshake.
    await vi.advanceTimersByTimeAsync(2000);
    expect(codes).toHaveLength(1);
    part.dispose();
    expect(stop).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("the zone strip", () => {
  const locations: LocationView[] = [
    { location: "the-door", venue: "v", label: "The door", x: 0, y: 0, code: "c1" },
    { location: "the-window", venue: "v", label: "The window", x: 1, y: 1, code: "c2" },
  ];

  it("marks where the device is, and does not re-send it", () => {
    const picks: (string | undefined)[] = [];
    const part = keep(zoneStripPart({ onPick: (l) => picks.push(l), clearText: "Nowhere" }));
    part.update({ locations, here: "the-door" });
    const buttons = [...part.el.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    buttons[0]!.click();
    expect(picks).toEqual([]);
    buttons[1]!.click();
    expect(picks).toEqual(["the-window"]);
    buttons[2]!.click();
    expect(picks).toEqual(["the-window", undefined]);
  });
});

describe("the message tray and the help button", () => {
  const message = (over: Partial<MessageView>): MessageView => ({
    id: "m1",
    body: "five minutes",
    sender: { kind: "producer" },
    priority: "note",
    audience: { to: "everyone" },
    at: "2026-09-05T14:32:00.000Z",
    ...over,
  });

  it("shows newest first, colours by priority, and acks only what asked", () => {
    const acked: string[] = [];
    const part = keep(messageTrayPart({ onAck: (id) => acked.push(id) }));
    part.update({
      messages: [
        message({ id: "m1", body: "five minutes" }),
        message({ id: "m2", body: "hold", priority: "urgent", ackRequired: true }),
      ],
    });
    const rows = [...part.el.querySelectorAll(".sk-message")];
    expect(rows.map((r) => r.getAttribute("data-message"))).toEqual(["m2", "m1"]);
    expect(rows[0]?.className).toContain("sk-message-urgent");
    expect(rows[0]?.querySelector("button")).toBeTruthy();
    expect(rows[1]?.querySelector("button")).toBeNull();
    rows[0]!.querySelector("button")!.click();
    expect(acked).toEqual(["m2"]);
    part.update({ messages: [message({ id: "m2", ackRequired: true })], acked: ["m2"] });
    expect(part.el.querySelector(".sk-message button")).toBeNull();
  });

  it("says so when nothing has come from the control room", () => {
    const part = keep(messageTrayPart({ onAck: () => {} }));
    part.update({ messages: [] });
    expect(part.el.querySelector(".sk-tray-empty")).toBeTruthy();
  });

  it("calls for help once, and then says it has", () => {
    const calls: number[] = [];
    const part = keep(helpButtonPart({ onHelp: () => calls.push(1) }));
    part.update({});
    const button = part.el.querySelector<HTMLButtonElement>("button")!;
    button.click();
    part.update({ sent: true });
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Help is called");
    button.click();
    expect(calls).toHaveLength(1);
  });
});

describe("the show clock", () => {
  it("formats show time, negative before GO", () => {
    expect(showTime(0)).toBe("00:00");
    expect(showTime(-30)).toBe("-00:30");
    expect(showTime(134)).toBe("02:14");
    expect(showTime(3734)).toBe("1:02:14");
  });

  it("counts on between readings, stops on a hold, and resets to a fresh one", () => {
    let tick = (): void => {};
    const part = keep(showClockPart({
      setInterval: (fn) => { tick = fn; return 1; },
      clearInterval: () => {},
    }));
    part.update({ clocks: { time_wall: "2026-09-05T14:32:00.000Z", time_show: 100, time_phase: "evening" } });
    expect(part.el.querySelector(".sk-clock-show")?.textContent).toBe("01:40");
    expect(part.el.querySelector(".sk-clock-phase")?.textContent).toBe("evening");
    tick();
    tick();
    expect(part.el.querySelector(".sk-clock-show")?.textContent).toBe("01:42");
    // A Hold holds the show clock, and the local count with it (spec 10.1).
    part.update({ clocks: { time_wall: "2026-09-05T14:32:00.000Z", time_show: 102, time_phase: "evening" }, paused: true });
    tick();
    tick();
    expect(part.el.querySelector(".sk-clock-show")?.textContent).toBe("01:42");
  });
});

describe("the connection banner", () => {
  it("is silent when live and speaks the moment it is not", () => {
    const part = keep(connectionBannerPart());
    part.update({ connection: "live" });
    expect(part.el.hidden).toBe(true);
    part.update({ connection: "held", held: true });
    expect(part.el.hidden).toBe(false);
    expect(part.el.textContent).toContain("Holding what you had");
    expect(part.el.className).toContain("sk-banner-held");
  });

  it("says how much is waiting to send, even while live", () => {
    const part = keep(connectionBannerPart({ words: { held: "Back in a moment." } }));
    part.update({ connection: "live", queued: 2 });
    expect(part.el.hidden).toBe(false);
    expect(part.el.textContent).toContain("2 waiting to send");
    part.update({ connection: "held", held: true, queued: 1 });
    expect(part.el.textContent).toContain("Back in a moment.");
    expect(part.el.textContent).toContain("1 waiting to send");
  });
});

describe("the QR display", () => {
  it("draws an SVG square and a caption", async () => {
    const part = keep(qrPart());
    part.update({ text: "http://venue.local/at/this-room/the-door", caption: "Scan me" });
    await part.ready();
    const square = part.el.querySelector("svg");
    expect(square).toBeTruthy();
    expect(square?.getAttribute("viewBox")).toMatch(/^0 0 \d+ \d+$/);
    expect(part.el.querySelector(".sk-qr-caption")?.textContent).toBe("Scan me");
  });

  it("falls back to the URL rather than a blank square when the encoder fails", async () => {
    const part = keep(qrPart({ encode: () => Promise.reject(new Error("no")) }));
    part.update({ text: "http://venue.local/p/token-1" });
    await part.ready();
    expect(part.el.querySelector(".sk-qr-fallback")?.textContent).toBe("http://venue.local/p/token-1");
  });
});

describe("the map", () => {
  const venue: VenueView = { venue: "this-room", name: "This Room", plan: { width: 800, height: 520 } };
  const locations: LocationView[] = [
    { location: "the-door", venue: "this-room", label: "The door", x: 80, y: 260, code: "c1" },
    { location: "the-window", venue: "this-room", label: "The window", x: 400, y: 90, code: "c2" },
  ];

  it("draws the plan, a pin per location and a zone when one is given", () => {
    const part = keep(venueMapPart({
      venue,
      locations,
      zones: [{ tag: "inside", polygon: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 520 }], label: { x: 400, y: 40 } }],
    }));
    part.update({});
    const svg = part.el.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("-16 -16 832 552");
    expect(svg.querySelectorAll(".sk-map-pin")).toHaveLength(2);
    expect(svg.querySelectorAll(".sk-map-zone")).toHaveLength(1);
    expect(svg.querySelector(".sk-map-zone-label")?.textContent).toBe("inside");
    expect([...svg.querySelectorAll(".sk-map-pin-name")].map((n) => n.textContent))
      .toEqual(["The door", "The window"]);
  });

  it("moves the marks, not the scenery, on update", () => {
    const part = keep(venueMapPart({ venue, locations }));
    part.update({});
    const svg = part.el.querySelector("svg")!;
    const door = svg.querySelector<SVGElement>('[data-location="the-door"]')!;
    expect(door.querySelector(".sk-map-pin-count")?.textContent).toBe("");

    part.update({ counts: { "the-door": 3 }, here: "the-door", stations: { "the-window": 2 } });
    expect(part.el.querySelector("svg")).toBe(svg); // drawn once, never redrawn
    expect(door.querySelector(".sk-map-pin-count")?.textContent).toBe("3");
    expect(door.classList.contains("sk-here")).toBe(true);
    expect(door.classList.contains("sk-waiting")).toBe(true);
    expect(svg.querySelector('[data-location="the-window"] .sk-map-pin-mark')?.textContent).toBe("**");
  });

  it("is a display, not a control, when nothing wants the tap", () => {
    const picks: string[] = [];
    const control = keep(venueMapPart({ venue, locations, onPick: (l) => picks.push(l) }));
    control.update({});
    control.el.querySelector<SVGElement>('[data-location="the-door"]')!.dispatchEvent(new MouseEvent("click"));
    expect(picks).toEqual(["the-door"]);

    const display = keep(venueMapPart({ venue, locations }));
    display.update({});
    display.el.querySelector<SVGElement>('[data-location="the-door"]')!.dispatchEvent(new MouseEvent("click"));
    expect(picks).toEqual(["the-door"]);
  });
});

describe("the stylesheet", () => {
  it("installs once, whatever a page asks for", () => {
    installKitStyles(document);
    installKitStyles(document);
    expect(document.querySelectorAll("#storylet-station-kit")).toHaveLength(1);
    expect(document.getElementById("storylet-station-kit")?.textContent).toContain("--accent");
  });
});
