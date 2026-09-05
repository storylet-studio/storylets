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
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import type { GameId, LocationId, LocationView, OutcomeViewWire, PartyId } from "@storylet-studio/wire";
import { ClientError } from "@storylet-studio/client";
import type { StationConnection, Visit } from "@storylet-studio/client";
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

  const clock = showClockPart();
  shell.head.append(clock.el);

  const locations: LocationView[] = [];
  let here: LocationId | undefined;
  const recents: Recent[] = [];
  let current: Visit | undefined;

  // --- the furniture, all of it live for the whole shift ---------------------

  const zones = zoneStripPart({
    clearText: "Nowhere",
    onPick: (location) => {
      here = location;
      zones.update({ locations, here, busy: true });
      void station.setPresence(location !== undefined ? { location } : {})
        .catch(() => { /* held: presence goes out with everything else */ })
        .finally(() => zones.update({ locations, here }));
    },
  });

  const tray = messageTrayPart({ onAck: (id) => { void station.messages.ack(id).catch(() => {}); } });
  station.messages.subscribe((messages) => tray.update({ messages }));

  const help = helpButtonPart({
    onHelp: () => {
      help.update({ busy: true });
      void station.messages.send({
        body: `help wanted${here !== undefined ? ` at ${here}` : ""}`,
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
    clock.update({});
    here = hello.station?.presence?.location ?? hello.station?.location;
  }
  // The venue's locations are the console's to provision; a handset that has
  // not been told them shows none, and the performer scans the code on the
  // wall instead, which is the same fact by the other route (spec 5.7).
  zones.update({ locations, here });
  void station.messages.list().catch(() => { /* the stream will bring them */ });

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
            .then(({ visit }) => prompts(visit))
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
      recents.push({
        party: response.partyId,
        ...(response.callSign !== undefined ? { callSign: response.callSign } : {}),
        at: Date.now(),
      });
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
            // The crew template is the whole point of this view: title,
            // purpose, and the project's own crew-facing field.
            ...(shell.template !== undefined ? { template: shell.template } : {}),
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
          list.append(el("section", { className: "app-section" },
            el("p", { className: "sk-label", text: hand }), part.el));
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
