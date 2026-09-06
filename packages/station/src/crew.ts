// ---------------------------------------------------------------------------
// The CREW handset: a performer's phone. The NPC who may be found anywhere.
//
// This is the app most worth finishing properly (spec 12), because a
// performer's needs are the same show to show: one thumb, in the dark, a fast
// handshake, the prompt list, and messages. The look matters less than the
// flow.
//
// The crew station is a PROXY (spec 5.7). It holds a station key and acts on
// behalf of whichever party it last handshook with, so what it deals and plays
// is that party's flow at the NPC's hand, exactly as a kiosk would. What
// differs is what it SHOWS: the beat's title, its `purpose` (the author's note
// about what the beat is for) and a crew-facing field the project declares on
// its card template. None of that is a server concern; it is a content
// convention this view renders.
//
// Two verbs a kiosk does not have. PEEK, to see what might come without
// claiming it. And playing a beat's outcome to mark it DONE when the party's
// answer was improvised rather than chosen, which is most of them.
//
// And the layer around all of that, which is RUNNING THE SHOW rather than
// playing it (5.7, 6.7): sign in to a wall, the clock and the phase in the
// corner, what the control room has said, and one button that tells them it is
// going wrong. None of it is about a party, all of it is live for the whole
// shift, and it is what a performer looks at between visitors.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import { CLOCK_PHASE } from "@storylet-studio/wire";
import type {
  Clocks, GameId, LocationId, MessageId, MessageView, OutcomeViewWire, PartyId, ZoneId,
} from "@storylet-studio/wire";
import { ClientError } from "@storylet-studio/client";
import type { StationConnection, Visit } from "@storylet-studio/client";
import type { ZoneStripLocation } from "@storylet-studio/station-kit";
import {
  el, handPart, handshakePart, helpButtonPart, messageTrayPart, showClockPart, zoneStripPart,
} from "@storylet-studio/station-kit";
import { mountShell, showConnection } from "./shell.js";
import type { Shell } from "./shell.js";
import { tokenFrom } from "./kiosk.js";

/** A party this handset has met, for the recent list. The server holds no
 *  names, so a call sign is the whole of what a performer has to go on, and it
 *  is the same handle the producer reads (spec 7.4). */
interface Recent {
  party: PartyId;
  callSign?: string;
  at: number;
}

/**
 * Where the tray had got to, kept across a reload.
 *
 * The instant of the newest message this handset holds, which is what
 * `GET /v1/messages?since=` takes. In `localStorage` because the case it is
 * for is a handset that came back rather than one that stayed: a performer's
 * phone locks, sleeps, drops off the venue wifi in the scene dock and returns
 * ten minutes later, and what it must not do is ask for the whole run again on
 * a screen the size of a hand.
 */
const SINCE_KEY = "storylet.crew.since";

const readSince = (): string | undefined => {
  try {
    return localStorage.getItem(SINCE_KEY) ?? undefined;
  } catch {
    return undefined; // storage refused: a full read is the safe fallback
  }
};
const writeSince = (at: string): void => {
  try {
    localStorage.setItem(SINCE_KEY, at);
  } catch {
    /* the tray still works; it just asks for more next time */
  }
};

export async function startCrew(root: HTMLElement): Promise<void> {
  // Named in two steps because the screens below are hoisted function
  // declarations: TypeScript will not carry a narrowing from `if (!maybe)`
  // into a function whose declaration is hoisted above it, and an app that
  // reads `shell!` in twenty places is an app one refactor from a null.
  const maybe = await mountShell(root, "crew");
  if (!maybe) return;
  const shell: Shell = maybe;
  const key = shell.config.stationKey;
  if (key === undefined) {
    shell.say("This handset has no station key.", "Add \"stationKey\" to station.json and reload.");
    return;
  }
  const station = shell.client.connectStation(key);
  showConnection(shell, station);

  // --- the show clock, in the corner ----------------------------------------
  //
  // The clocks are DERIVED and never ticked (10.2), so they arrive as a
  // reading the part counts on from: one from `GET /v1/world` when this
  // handset wakes and after every outage, and the phase again whenever a
  // producer or a cue moves it, which is a `world` event on `world.time_phase`
  // like any other.

  const clock = showClockPart();
  let clocks: Clocks | undefined;
  let paused = false;
  const drawClock = (): void => {
    clock.update({ ...(clocks !== undefined ? { clocks } : {}), paused });
  };
  drawClock();
  shell.head.append(clock.el);

  const readClocks = (): void => {
    void station.world().then((got) => { clocks = got.clocks; drawClock(); }).catch(() => {
      // Away. The part keeps counting from the last reading, which is the one
      // place in the family a screen may be ahead of the server: a frozen
      // clock reads as a dead screen (10.2).
    });
  };

  const locations: ZoneStripLocation[] = [...(shell.config.locations ?? [])];
  let here: LocationId | undefined;
  let zone: ZoneId | undefined;
  const recents: Recent[] = [];
  let current: Visit | undefined;
  /** Who this handset is standing with, for the help call. */
  let withParty: Recent | undefined;

  // --- the furniture, all of it live for the whole shift ---------------------

  const zones = zoneStripPart({
    clearText: "Nowhere",
    onPick: (location) => {
      here = location;
      drawZones(true);
      // A LOCATION goes out and a zone comes back: the device knows where it
      // is, and the zone is the story's word for it, derived by the server for
      // whichever installation this handset is signed in to (4a, 5.7). It is
      // worth showing, because it is the word a producer addresses.
      void station.setPresence(location !== undefined ? { location } : {})
        .then((res) => { here = res.presence.location; zone = res.presence.zone; })
        .catch(() => { /* held: presence goes out with everything else */ })
        .finally(() => drawZones());
    },
  });

  function drawZones(busy = false): void {
    zones.update({
      locations,
      ...(here !== undefined ? { here } : {}),
      ...(zone !== undefined ? { zone } : {}),
      busy,
    });
  }

  // --- the control room ------------------------------------------------------

  /** The tray's own copy, so degraded mode has something to keep: the client
   *  holds these across a drop, and nothing here empties them on the way past
   *  a banner (spec 17 item 2). */
  let inbox: MessageView[] = [];
  /** Acked on this handset. Held here as well as on the server so the button
   *  goes the moment a thumb lands, and so a second thumb sends nothing. */
  let acked: MessageId[] = [];

  const tray = messageTrayPart({
    onAck: (id) => {
      if (acked.includes(id)) return;
      acked = [...acked, id];
      drawTray();
      void station.messages.ack(id).catch(() => {
        // It did not go. Put the button back rather than leaving a performer
        // believing the control room has been told.
        acked = acked.filter((one) => one !== id);
        drawTray();
      });
    },
  });
  function drawTray(): void {
    tray.update({ messages: inbox, acked });
  }
  station.messages.subscribe((messages) => {
    inbox = messages;
    drawTray();
    const newest = messages[messages.length - 1];
    if (newest !== undefined) writeSince(newest.at);
  });

  /** Where this handset says it is, in the words a producer would use. */
  const whereWord = (): string => {
    if (here === undefined) return "nowhere signed in";
    const label = locations.find((l) => l.location === here)?.label ?? here;
    return zone === undefined ? `at ${label}` : `at ${label}, in ${zone}`;
  };

  const help = helpButtonPart({
    onHelp: () => {
      help.update({ busy: true });
      // ONE TAP. The body is the whole of what a producer reads, and there is
      // no second field on the wire to put the rest in, so it carries the two
      // facts that decide who is sent and where: this handset's presence, and
      // the party it is standing with (6.7).
      void station.messages.send({
        body: `Help. ${whereWord()}. With ${withParty?.callSign ?? withParty?.party ?? "nobody"}.`,
        priority: "urgent",
        audience: { to: "producers" },
        ackRequired: true,
      }).then(() => help.update({ sent: true }))
        .catch(() => help.update({}));
    },
  });
  help.update({});

  const recentStrip = el("nav", { className: "app-row", attrs: { "aria-label": "Recent parties" } });
  const screen = el("div", { className: "app-section" });

  shell.main.replaceChildren(
    el("section", { className: "app-section" }, el("p", { className: "sk-label", text: "Where you are" }), zones.el),
    recentStrip,
    screen,
    el("section", { className: "app-section" }, el("p", { className: "sk-label", text: "Control room" }), tray.el, help.el),
  );

  // --- what the venue is ------------------------------------------------------

  const hello = await station.hello().catch(() => undefined);
  if (hello) {
    here = hello.station?.presence?.location ?? hello.station?.location;
    zone = hello.station?.presence?.zone;
  }
  // The walls this handset offers are `station.json`'s: listing the venue's
  // locations is a console route and a station key is not a producer (6.5).
  // A handset that has been told none shows none, and the performer scans the
  // code on the wall instead, which is the same fact by the other route (5.7).
  drawZones();

  // --- what happened while it was away ---------------------------------------
  //
  // The stream going live is the signal. It fires once on waking and again
  // after every drop, and both want the same two reads: what the control room
  // said, from the cursor this handset kept, and a fresh clock reading,
  // because the clocks are derived and the local count has been guessing.
  //
  // The tray is NOT emptied in between. What a performer had on screen stays
  // there through the outage and the catch-up merges into it (spec 17 item 2).

  const catchUp = (): void => {
    void station.messages.list(readSince()).catch(() => { /* the stream will bring them */ });
    readClocks();
  };
  let away = false;
  station.subscribe((state) => {
    if (state === "held" || state === "disconnected") { away = true; return; }
    if (state === "live" && away) { away = false; catchUp(); }
  });
  // The first one is unconditional, and deliberately not waiting on the
  // stream: a handset that can reach the server over HTTP and cannot open a
  // socket should show the tray it has rather than an empty one.
  catchUp();

  paused = hello?.run?.state === "paused";
  drawClock();

  station.on((event) => {
    // The phase is a `@world` property like any other, so it arrives as a
    // `world` event and not as a clock of its own (10.1): "act two" reaching
    // the corner of a handset is the same push that reaches a wall.
    if (event.type === "world" && event.path === CLOCK_PHASE && clocks !== undefined) {
      clocks = { ...clocks, time_phase: String(event.value) };
      drawClock();
    }
    // A HOLD holds everything about the show, `time_wall` excepted, which is
    // why the part is told rather than hidden (the ruling, 10.1).
    if (event.type === "run") {
      if (event.phase === "paused") paused = true;
      if (event.phase === "resumed" || event.phase === "started") paused = false;
      drawClock();
    }
  });

  const drawRecents = (): void => {
    recentStrip.replaceChildren();
    for (const recent of [...recents].sort((a, b) => b.at - a.at).slice(0, 6)) {
      recentStrip.append(el("button", {
        className: "sk-button",
        type: "button",
        text: recent.callSign ?? recent.party,
        attrs: { "data-party": recent.party },
        onClick: () => {
          void station.openVisit({ party: recent.party, attach: true })
            .then(({ visit }) => { withParty = recent; prompts(visit); })
            .catch(() => door());
        },
      }));
    }
  };

  // --- the two screens --------------------------------------------------------

  function door(): void {
    const handshake = handshakePart({
      title: "Who is this?",
      onCode: (code) => {
        handshake.update({ busy: true });
        void meet(station.handshake({ credential: "token", token: tokenFrom(code) }), handshake);
      },
      onCallSign: (callSign) => {
        handshake.update({ busy: true });
        void meet(station.handshake({ credential: "callsign", callSign }), handshake);
      },
      onFilter: () => { /* the pick list is the run's; a console route fills it */ },
    });
    // A crew or sign-in station is the only place a call sign may be presented
    // at all: a person in the loop is what makes low entropy safe (spec 7.1).
    handshake.update({ callSigns: [] });
    screen.replaceChildren(handshake.el);
  }

  async function meet(
    shaking: ReturnType<StationConnection["handshake"]>,
    handshake: ReturnType<typeof handshakePart>,
  ): Promise<void> {
    try {
      const { response, visit } = await shaking;
      const met: Recent = {
        party: response.partyId,
        ...(response.callSign !== undefined ? { callSign: response.callSign } : {}),
        at: Date.now(),
      };
      recents.push(met);
      withParty = met;
      drawRecents();
      prompts(visit);
    } catch (err) {
      handshake.update({ error: err instanceof ClientError ? err.message : String(err) });
    }
  }

  function prompts(visit: Visit): void {
    current?.close();
    current = visit;
    const outcomes: Record<GameId, OutcomeViewWire[]> = {};
    const hands = new Map<GameId, ReturnType<typeof handPart>>();
    const list = el("div", { className: "app-section" });
    const who = el("p", { className: "sk-label", text: visit.state.party ?? "" });

    const done = el("button", {
      className: "sk-button",
      type: "button",
      text: "Done with this party",
      onClick: () => {
        void visit.detach().catch(() => { /* already detached */ });
        withParty = undefined;
        door();
      },
    });

    const peeked = el("div", { className: "sk-quiet" });
    const peek = el("button", {
      className: "sk-button",
      type: "button",
      text: "What might come?",
      onClick: () => {
        const box = shell.config.installation ?? "";
        // A peek is a READ: it never claims, and it advances nothing (5.7).
        void visit.peek(box, undefined, 3).then((res) => {
          peeked.textContent = res.cards.length === 0
            ? "Nothing waiting in that box."
            : res.cards.map((c) => c.title ?? c.id).join(" - ");
        }).catch((err: unknown) => {
          peeked.textContent = err instanceof ClientError ? err.message : "Could not look.";
        });
      },
    });

    screen.replaceChildren(who, list, el("div", { className: "app-row" }, peek, done), peeked);

    const render = (): void => {
      const state = visit.state;
      for (const [hand, cards] of Object.entries(state.board)) {
        let part = hands.get(hand);
        if (part === undefined) {
          part = handPart({
            // The crew face is the whole point of this view: title, purpose,
            // the project's own crew-facing field, and each outcome's purpose
            // as a hint beside the button. The one screen written for a
            // reader of the author's notes (5.7).
            face: shell.face,
            heading: shell.handName(hand),
            emptyText: "Nothing to offer here.",
            onWantOutcomes: (card, from) => {
              void visit.outcomes(card, from).then((got) => { outcomes[card] = got; render(); }).catch(() => {});
            },
            // Playing an outcome here RECORDS what happened: the party's answer
            // was usually improvised, and the performer marks which way it went.
            onPlay: (card, outcome, from) => {
              void visit.play(card, outcome, from).catch(() => {});
            },
          });
          hands.set(hand, part);
          list.append(el("section", { className: "app-section" }, part.el));
        }
        part.update({ hand, cards, outcomes, busy: state.held });
      }
      if (state.closed) {
        for (const part of hands.values()) part.dispose();
        hands.clear();
        door();
      }
    };
    visit.subscribe(render);
    void visit.deal().catch(() => {});
  }

  drawRecents();
  door();
}
