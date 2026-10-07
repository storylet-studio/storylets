// ---------------------------------------------------------------------------
// The Board's Map view: the List | Map switch, the pick of which map, fetching
// a map's geometry, and the canvas that draws it (board-map.ts), mounted once
// and updated after that.
// ---------------------------------------------------------------------------

import { el } from "@wildwinter/app-shell";
import { currentMapChoices, currentPick, effectiveView, spaceList } from "./board-state.js";
import type { Board, BoardState } from "./board-state.js";

/**
 * Fetch the chosen map's geometry.
 *
 * Read once per session build rather than live: the Board plays a COMPILED
 * bundle, so its map should be the map as it was when that bundle was made. An
 * author editing zones while a session runs gets the same answer as an author
 * editing anything else - the out-of-date bar, and a restart.
 */
export async function loadMap(b: Board): Promise<void> {
  const s = b.state;
  const pick = currentPick(s);
  if (!pick) { s.mapData = undefined; return; }
  if (s.boxSel === undefined) {
    // Everything: the shared space, drawn once - the first member's geometry
    // and furniture, EVERY member's placed hands. The members' zones are
    // identical by the space's own definition.
    const members = spaceList(s.maps)[s.mapPick] ?? [];
    const parts = await Promise.all(members.map((m) => b.studio.boxMap(m.box, m.group)));
    const first = parts[0];
    s.mapData = first === undefined ? undefined : { ...first, sites: parts.flatMap((p) => p.sites) };
  } else {
    s.mapData = await b.studio.boxMap(pick.box, pick.group);
  }
  if (effectiveView(s) === "map") b.render();
}

/**
 * Put the map on screen, mounting the canvas the first time.
 *
 * Konva is most of a megabyte and only this view needs it, so the module is a
 * dynamic import: a Board session that never opens the map never pays for one.
 * The stage itself is mounted ONCE and updated after that - remounting per
 * render would throw away the camera every time a card was played.
 */
export function showMap(b: Board): void {
  const s = b.state;
  if (!s.mapData) return;
  const pick = currentPick(s);
  // The zone the Board is filtered to, translated from the filter's own terms
  // (a group gameId to a tag gameId) into the id the map draws by.
  const filteredName = pick ? s.filters[pick.groupGameId] ?? "" : "";
  const filtered = filteredName === ""
    ? undefined
    : s.mapData.zones.find((z) => z.gameId === filteredName)?.id;
  // Another box's map, or another group's: frame it whole. The same map again
  // (a play, a pick) keeps the camera where the author left it.
  const key = `${s.boxSel ?? "*"}|${s.mapPick}|${pick?.box ?? ""}|${pick?.group ?? ""}`;
  const refit = key !== s.mapKey;
  s.mapKey = key;
  const marks = {
    now: s.marks.now(),
    visited: (h: string) => s.marks.visitedHand(h),
    held: (h: string) => s.board.find((x) => x.hand === h)?.cards.length ?? 0,
    changed: (h: string) => s.pulsed.has(h),
    changedStamp: s.pulseStamp,
    ...(filtered !== undefined ? { filtered } : {}),
  };
  if (s.mapView) {
    s.mapView.update(s.mapData, s.selectedHand, marks);
    if (refit) s.mapView.fit();
    return;
  }
  void (async () => {
    const { mountBoardMap } = await import("./board-map.js");
    if (!s.mapData || s.mapView) return;
    s.mapView = mountBoardMap(s.mapHost, s.mapData, s.selectedHand, marks, {
      // One click, one render. Picking a site selects its hand; clicking a zone
      // IS the Board's filter for that tag group: the same state the dropdown
      // writes, so the two always agree and either can clear it. A site click
      // leaves the filter as it was.
      pick: (hand, zone) => {
        s.selectedHand = hand; s.open = undefined; s.pending = undefined;
        const group = currentPick(s);
        if (zone && group) {
          const z = zone.id === undefined ? undefined : s.mapData?.zones.find((x) => x.id === zone.id);
          if (z) s.filters[group.groupGameId] = z.gameId;
          else delete s.filters[group.groupGameId];
        }
        b.render();
      },
      // Double-click reveals in the editor, the same gesture as everywhere else.
      // It is the author asking, not the Board driving: the Board marks.
      // By the hand's own ids: the editor opens a hand by id, and the pin is
      // keyed by gameId (it used to send that, which opened nothing).
      reveal: (hand) => {
        const hv = s.table?.hands().find((h) => h.gameId === hand);
        if (hv) void b.studio.searchReveal({ kind: "hand", box: hv.boxId, hand: hv.id });
      },
    });
  })();
}

/** The map's selected zone, as the tag group it filters: the Board's filter
 *  for the map's group, while the map is what is showing. */
export function mapZoneGroup(s: BoardState): string | undefined {
  if (s.liveMode || effectiveView(s) !== "map") return undefined;
  const group = currentPick(s)?.groupGameId;
  return group !== undefined && (s.filters[group] ?? "") !== "" ? group : undefined;
}

/** List | Map: the same board, two ways of looking at it. Offered only when the
 *  project has a map, and never a mode with different RULES - the filters, the
 *  selection and the reveal gesture are the same in both. */
export function viewSwitch(b: Board): HTMLElement | null {
  const s = b.state;
  if (currentMapChoices(s).length === 0) return null;
  return el("div", { className: "seg viewswitch" },
    ...(["list", "map"] as const).map((v) => el("button", {
      className: `seg-opt vbtn${effectiveView(s) === v ? " on" : ""}`, text: v === "list" ? "List" : "Map",
      tip: v === "list" ? "This box's hands as a list" : "This box seen from above",
      onClick: () => { s.view = v; void b.studio.setBoardView(v); if (v === "map") { void loadMap(b); showMap(b); } b.render(); },
    })));
}

/** Which map, when there is more than one. Same grammar as the editor's own
 *  group control: a name when there is nothing to choose. */
export function mapPicker(b: Board): HTMLElement | null {
  const s = b.state;
  const scoped = currentMapChoices(s);
  if (effectiveView(s) !== "map" || scoped.length === 0) return null;
  const here = currentPick(s)!;
  if (scoped.length === 1) {
    return el("span", { className: "maphere" },
      el("span", { className: "maphere-of", text: "Map of" }),
      el("span", { className: "maphere-name", text: here.groupGameId }));
  }
  const sel = document.createElement("select");
  sel.className = "arg";
  scoped.forEach((m, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = m.groupGameId;
    o.selected = i === s.mapPick;
    sel.append(o);
  });
  sel.addEventListener("change", () => {
    s.mapPick = Number(sel.value);
    s.selectedHand = undefined;
    void loadMap(b);
  });
  return sel;
}
