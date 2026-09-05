// ---------------------------------------------------------------------------
// The COMPANION page: the party's own phone.
//
// Reached by a QR and nothing else. Two URLs (spec 7.2):
//
//   /p/<token>              a credential: this is who you are.
//   /at/<venue>/<location>  a placard: this is where you are.
//
// THE PLACARD CARRIES NO STORY. Its code says only where it is, because the
// same wall serves every installation the venue is running and placards are
// printed once. What comes back is decided by what the phone HOLDS: a
// credential resolves to a party in a story, and that pair is the routing. A
// phone holding nothing is offered the venue's default story, or a chooser
// when several are open, and the choice mints the party there.
//
// The token lives in `localStorage`, so a phone that reloads is still the same
// party. It is the only thing this page remembers, and it is the only thing
// worth remembering: the server holds no name, no email and no photo.
//
// Nearly always rebuilt (spec 12): the player-facing surface is the brand.
// This one is plain enough that nobody mistakes it for a venue's design.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import type { GameId, InstallationView, LocationId, OutcomeViewWire, VenueId } from "@storylet-studio/wire";
import { ClientError } from "@storylet-studio/client";
import type { PartyConnection, Visit } from "@storylet-studio/client";
import { el, handPart, qrPart } from "@storylet-studio/station-kit";
import { mountShell, showConnection } from "./shell.js";
import type { Shell } from "./shell.js";

const TOKEN_KEY = "storylet.party.token";

/** What the QR that opened this page said. */
export type Arrival =
  | { at: "party"; token: string }
  | { at: "location"; venue: VenueId; location: LocationId }
  | { at: "nowhere" };

/** Read the arrival off a path. Exported because it is the one piece of this
 *  page a rebuild always needs and always gets subtly wrong. */
export function arrivalFrom(pathname: string): Arrival {
  const party = /\/p\/([^/?#]+)\/?$/.exec(pathname);
  if (party?.[1] !== undefined) return { at: "party", token: decodeURIComponent(party[1]) };
  const location = /\/at\/([^/]+)\/([^/?#]+)\/?$/.exec(pathname);
  if (location?.[1] !== undefined && location[2] !== undefined) {
    return { at: "location", venue: decodeURIComponent(location[1]), location: decodeURIComponent(location[2]) };
  }
  return { at: "nowhere" };
}

const readToken = (): string | undefined => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined; // private browsing, or storage refused: a fresh party
  }
};
const writeToken = (token: string): void => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* nothing is lost that was not already going to be */
  }
};

export async function startCompanion(root: HTMLElement): Promise<void> {
  const shell = await mountShell(root, "companion");
  if (!shell) return;

  const arrival = arrivalFrom(location.pathname);
  if (arrival.at === "party") writeToken(arrival.token);
  const token = readToken() ?? "";
  const party = shell.client.connectParty(token);
  showConnection(shell, party);

  if (arrival.at === "location") {
    await scan(shell, party, arrival.venue, arrival.location);
    return;
  }
  // A token and no placard: show the party its own QR, which is both the
  // keepsake and the thing a station's camera reads (spec 7.2, both
  // directions of the handshake).
  const hello = await party.hello().catch(() => undefined);
  const keepsake = qrPart();
  keepsake.update({
    text: `${shell.client.base}/p/${token}`,
    caption: token === "" ? "Scan a code on a wall to begin." : "Show this to a kiosk, or scan a code on a wall.",
  });
  shell.main.replaceChildren(keepsake.el);
  if (hello?.visit !== undefined) {
    shell.main.append(el("p", { className: "sk-quiet", text: "Your story is waiting at the next code." }));
  }
}

/** A placard was scanned. Either the phone is routed into one story, or it is
 *  asked which: both are 200s, which is why there is no error code for it. */
async function scan(shell: Shell, party: PartyConnection, venue: VenueId, at: LocationId): Promise<void> {
  shell.say("Looking around...");
  let outcome;
  try {
    outcome = await party.atLocation(venue, at);
  } catch (err) {
    shell.say(
      err instanceof ClientError ? err.message : "Something went wrong here.",
      "Try the code again in a moment.",
    );
    return;
  }
  if (outcome.outcome === "choose") {
    chooser(shell, party, venue, at, outcome.installations);
    return;
  }
  const visit = party.visit;
  if (visit === undefined) {
    shell.say("Nothing is running here just now.");
    return;
  }
  table(shell, party, visit);
}

/** Several stories open, and this phone holds no credential: ask, branded for
 *  nothing until the visitor picks. */
function chooser(
  shell: Shell,
  party: PartyConnection,
  venue: VenueId,
  at: LocationId,
  installations: InstallationView[],
): void {
  const list = el("div", { className: "app-section" });
  for (const installation of installations) {
    list.append(el("button", {
      className: "sk-button sk-primary",
      type: "button",
      text: installation.name,
      attrs: { "data-installation": installation.installation },
      onClick: () => {
        void party.chooseInstallation(venue, at, installation.installation)
          .then(({ visit }) => {
            // The choice minted the party, so this phone now holds one.
            void party.hello().catch(() => {});
            table(shell, party, visit);
          })
          .catch((err: unknown) => {
            shell.say(err instanceof ClientError ? err.message : "That story is not open.");
          });
      },
    }));
  }
  shell.main.replaceChildren(el("p", { className: "app-say", text: "Which story?" }), list);
}

function table(shell: Shell, party: PartyConnection, visit: Visit): void {
  const outcomes: Record<GameId, OutcomeViewWire[]> = {};
  const hands = new Map<GameId, ReturnType<typeof handPart>>();
  const board = el("div", { className: "app-section" });
  const keepsake = qrPart();
  const keepsakeWrap = el("div", { className: "app-section" });
  const note = el("p", { className: "sk-quiet" });

  const claim = el("button", {
    className: "sk-button",
    type: "button",
    text: "Keep this story",
    onClick: () => {
      const id = visit.state.party;
      if (id === undefined) return;
      void party.claim(id, { kind: "token" }).then((claimed) => {
        if (claimed.qr === undefined) return;
        keepsake.update({ text: claimed.qr, caption: "Photograph this to come back." });
        keepsakeWrap.replaceChildren(keepsake.el);
      }).catch(() => { /* a claim that will not go is not worth a modal */ });
    },
  });

  shell.main.replaceChildren(board, note, keepsakeWrap, el("div", { className: "app-row" }, claim));

  const render = (): void => {
    const state = visit.state;
    for (const [hand, cards] of Object.entries(state.board)) {
      let part = hands.get(hand);
      if (part === undefined) {
        part = handPart({
          ...(shell.template !== undefined ? { template: shell.template } : {}),
          emptyText: "Nothing here yet. Try another code.",
          onWantOutcomes: (card, from) => {
            void visit.outcomes(card, from).then((got) => { outcomes[card] = got; render(); }).catch(() => {});
          },
          onPlay: (card, outcome, from) => {
            void visit.play(card, outcome, from).catch((err: unknown) => {
              // The board says what happened either way; a refusal that is
              // worth a word gets one, quietly, under the hand.
              note.textContent = err instanceof ClientError ? err.message : "";
            });
          },
        });
        hands.set(hand, part);
        board.append(el("section", { className: "app-section" },
          el("p", { className: "sk-label", text: hand }), part.el));
      }
      part.update({ hand, cards, outcomes, busy: state.held });
    }
    if (state.closed) {
      for (const p of hands.values()) p.dispose();
      hands.clear();
      shell.say("That is all for now.", "Come back to any code when you are ready.");
    }
  };

  visit.subscribe(render);
  void visit.deal().catch(() => { /* held: the deal goes out when the signal returns */ });
}
