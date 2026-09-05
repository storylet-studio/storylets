// ---------------------------------------------------------------------------
// The KIOSK: a fixed station, its own screen, a party in front of it.
//
// Handshake, then the hand. Idle parks the visit after N minutes, which is the
// one thing a kiosk in a foyer must do that nothing else does: a party walks
// away mid-beat and the next person to touch the screen must not inherit their
// story (spec 5.4, and the reason `visit.idleMinutes` exists at all).
//
// Bones, by design (spec 12): the kiosk IS the set dressing, so this is
// expected to be reskinned or rebuilt. What a rebuild keeps is everything in
// the two layers below; what it replaces is every line of this file.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import type { GameId, OutcomeViewWire } from "@storylet-studio/wire";
import { ClientError } from "@storylet-studio/client";
import type { StationConnection, Visit } from "@storylet-studio/client";
import { el, handPart, handshakePart, qrPart } from "@storylet-studio/station-kit";
import { mountShell, showConnection } from "./shell.js";
import type { Shell } from "./shell.js";

/** A token URL from a QR, or a bare token typed in. Both reach the same
 *  credential, and a performer should not have to know which they are holding. */
export const tokenFrom = (code: string): string => {
  const match = /\/p\/([^/?#]+)/.exec(code);
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : code.trim();
};

export async function startKiosk(root: HTMLElement): Promise<void> {
  const shell = await mountShell(root, "fixed");
  if (!shell) return;
  const key = shell.config.stationKey;
  if (key === undefined) {
    shell.say("This kiosk has no station key.", "Add \"stationKey\" to station.json and reload.");
    return;
  }
  const station = shell.client.connectStation(key);
  showConnection(shell, station);
  door(shell, station);
}

/** Screen one: present a credential, or take a walk-up. */
function door(shell: Shell, station: StationConnection): void {
  const handshake = handshakePart({
    title: shell.config.title ?? "Welcome",
    onCode: (code) => {
      handshake.update({ busy: true });
      void station.handshake({ credential: "token", token: tokenFrom(code) })
        .then(({ visit }) => table(shell, station, visit))
        .catch((err: unknown) => {
          handshake.update({ error: err instanceof ClientError ? err.message : String(err) });
        });
    },
  });
  handshake.update({});

  // A walk-up mints a transient party here and now: no sign-up, nothing asked
  // for, a pocket that starts empty (spec 7.1). The installation comes from
  // station.json, because a fixed kiosk in one room usually serves one story.
  const walkUp = el("button", {
    className: "sk-button sk-primary",
    type: "button",
    text: "Start without a code",
    onClick: () => {
      const installation = shell.config.installation;
      if (installation === undefined) {
        handshake.update({ error: "station.json names no installation, so this kiosk cannot mint a party." });
        return;
      }
      handshake.update({ busy: true });
      void station.mintParty({ installation, callSign: true })
        .then((minted) => station.handshake({ credential: "token", token: minted.token }))
        .then(({ visit }) => table(shell, station, visit))
        .catch((err: unknown) => {
          handshake.update({ error: err instanceof ClientError ? err.message : String(err) });
        });
    },
  });

  shell.main.replaceChildren(handshake.el, walkUp);
}

/** Screen two: the hand, until the party leaves or stops touching it. */
function table(shell: Shell, station: StationConnection, visit: Visit): void {
  const outcomes: Record<GameId, OutcomeViewWire[]> = {};
  const hands = new Map<GameId, ReturnType<typeof handPart>>();
  const board = el("div", { className: "app-section" });
  const keepsake = qrPart();
  const keepsakeWrap = el("div", { className: "app-section" });

  const leave = el("button", {
    className: "sk-button",
    type: "button",
    text: "Finished",
    onClick: () => { void visit.park().catch(() => { /* parked or gone: the door is right either way */ }); },
  });

  const claim = el("button", {
    className: "sk-button",
    type: "button",
    text: "Keep this story",
    onClick: () => {
      const party = visit.state.party;
      if (party === undefined) return;
      // Claiming at the END of a first play is the friendlier moment, which is
      // the old system's own conclusion (AuthPromotion.md, cited at 7.2).
      void station.claim(party, { kind: "token" }).then((claimed) => {
        if (claimed.qr === undefined) return;
        keepsake.update({ text: claimed.qr, caption: "Photograph this to come back." });
        keepsakeWrap.replaceChildren(keepsake.el);
      }).catch(() => { /* a claim that will not go is not worth a modal */ });
    },
  });

  shell.main.replaceChildren(board, keepsakeWrap, el("div", { className: "app-row" }, claim, leave));

  const wantOutcomes = (card: GameId, hand: GameId): void => {
    void visit.outcomes(card, hand).then((got) => {
      outcomes[card] = got;
      render();
    }).catch(() => { /* the next board event asks again */ });
  };

  const render = (): void => {
    const state = visit.state;
    for (const [hand, cards] of Object.entries(state.board)) {
      let part = hands.get(hand);
      if (part === undefined) {
        part = handPart({
          ...(shell.template !== undefined ? { template: shell.template } : {}),
          onWantOutcomes: wantOutcomes,
          onPlay: (card, outcome, from) => {
            void visit.play(card, outcome, from).catch(() => { /* held, or refused; the board says which */ });
          },
        });
        hands.set(hand, part);
        board.append(el("section", { className: "app-section" },
          el("p", { className: "sk-label", text: hand }), part.el));
      }
      part.update({ hand, cards, outcomes, busy: state.held });
    }
    if (state.closed) {
      for (const part of hands.values()) part.dispose();
      hands.clear();
      keepsake.dispose();
      door(shell, station);
    }
  };

  visit.subscribe(render);
  void visit.deal().catch(() => { /* held: the deal goes out when the wifi comes back */ });
  idle(shell, visit);
}

/** Park after N quiet minutes. A party walks away mid-beat and the next person
 *  to touch the screen must not inherit their story. */
function idle(shell: Shell, visit: Visit): void {
  const minutes = shell.config.idleMinutes ?? 0;
  if (minutes <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reset = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      void visit.park().catch(() => { /* already gone */ });
    }, minutes * 60_000);
  };
  // Any touch is a sign of life, including one that lands on nothing.
  for (const event of ["pointerdown", "keydown"] as const) {
    shell.main.ownerDocument.addEventListener(event, reset);
  }
  visit.subscribe((state) => {
    if (state.closed && timer !== undefined) clearTimeout(timer);
    else reset();
  });
}
