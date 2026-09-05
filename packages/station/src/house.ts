// ---------------------------------------------------------------------------
// The HOUSE display: the venue's own flow, on a wall.
//
// The house is a flow like any other, except that it belongs to nobody: it is
// where the weather lives, and the phase, and whatever the room does that is
// not any one party's doing (spec 5.5). Its hands are dealt and played by the
// cue list and by a producer, so this screen almost never has a button on it.
//
// It also MIRRORS CUES. The server never interprets a card's fields; a bridge
// does, and this page echoes what the bridge just sent, so a wall display can
// show the same thing the light desk was told without a second integration.
// That is the `cue` event, and it is the one place a front-end reads a card's
// fields as vocabulary rather than as text.
//
// A display, not a control: no handshake, no idle, no park. It shows the map
// if the venue has a plan, the clock, and the house's own hands.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import type { GameId, LocationId, LocationView } from "@storylet-studio/wire";
import type { StationConnection } from "@storylet-studio/client";
import { el, handPart, showClockPart, venueMapPart } from "@storylet-studio/station-kit";
import { mountShell, showConnection } from "./shell.js";

export async function startHouse(root: HTMLElement): Promise<void> {
  const shell = await mountShell(root, "house");
  if (!shell) return;
  const key = shell.config.stationKey;
  if (key === undefined) {
    shell.say("This display has no station key.", "Add \"stationKey\" to station.json and reload.");
    return;
  }
  const station = shell.client.connectStation(key);
  showConnection(shell, station);

  const clock = showClockPart();
  clock.update({});
  shell.head.append(clock.el);

  const cues = el("div", { className: "app-section" });
  const board = el("div", { className: "app-section" });
  const mapWrap = el("div", { className: "app-section" });
  shell.main.replaceChildren(mapWrap, board, cues);

  const hello = await station.hello().catch(() => undefined);
  if (hello) {
    // The map draws the BUILDING: one plan, one coordinate space, whichever
    // stories are running on those walls.
    const locations: LocationView[] = [];
    const map = venueMapPart({ venue: hello.venue, locations });
    map.update({});
    mapWrap.replaceChildren(map.el);
    if (hello.run !== undefined) clock.update({});
    const counts: Record<LocationId, number> = {};
    const stations: Record<LocationId, number> = {};
    station.on((event) => {
      if (event.type !== "presence") return;
      const at = event.presence.location;
      if (at === undefined) return;
      stations[at] = (stations[at] ?? 0) + 1;
      map.update({ counts, stations });
    });
  }

  // The house's hands, when this display is attached to the house flow. A
  // display with no visit shows the room and the clock, which is the honest
  // state before a producer opens one.
  const hands = new Map<GameId, ReturnType<typeof handPart>>();
  const drawBoard = (): void => {
    const visit = station.visit;
    if (visit === undefined) return;
    for (const [hand, cards] of Object.entries(visit.state.board)) {
      let part = hands.get(hand);
      if (part === undefined) {
        // No outcomes are passed: the house is played by the cue list and by
        // the console, never by whoever is standing in front of the wall. The
        // face is the party's, plus the cue: a wall is read by the room.
        part = handPart({ face: shell.face, heading: shell.handName(hand), onPlay: () => {} });
        hands.set(hand, part);
        board.append(el("section", { className: "app-section" }, part.el));
      }
      part.update({ hand, cards });
    }
  };
  station.on((event) => {
    if (event.type === "board") drawBoard();
    if (event.type !== "cue") return;
    // What a bridge just sent, echoed. Newest at the top, three deep: a wall
    // is read at a glance or not at all.
    const line = el("p", { className: "sk-quiet" });
    const fields = Object.entries(event.fields ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join("  ");
    line.textContent = `${event.verb}${event.card !== undefined ? ` ${event.card}` : ""}  ${fields}`.trim();
    cues.prepend(line);
    while (cues.childElementCount > 3) cues.lastElementChild?.remove();
  });
  drawBoard();
}

/** Exported so a venue rebuilding this page has the one non-obvious piece:
 *  a display is a station like any other, and it reads the house's board off
 *  the same visit machinery every other app uses. */
export type HouseStation = StationConnection;
