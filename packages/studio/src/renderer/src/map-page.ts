// ---------------------------------------------------------------------------
// The project map's page (the surfacing review's plan item 2): one canvas for
// the project, zones drawn once, every box on the map a layer of its sites.
// And the other end of it, a box's Map tab: that box's own sites, listed.
//
// The page owns its canvas while it is mounted, whether it is being edited
// (Edit layout, for this session), and what the next mount should land on
// selected (the way back to the map from a card opened off its side panel).
// ---------------------------------------------------------------------------

import { el, plural } from "@wildwinter/app-shell";
import { boxPin, setBoxColours } from "./box-tint.js";
import { askZoneName } from "./zone-name.js";
import { documentHeading, setDocTab } from "./inspector.js";
import { boxChip, chip } from "./widgets.js";
import { ok } from "./results.js";
import type { MapPanelHost } from "./map-panel.js";
import type { MountedMapView } from "./map-view.js";
import type { Comments } from "./comments.js";
import type { ViewActions } from "./views.js";
import type { Session } from "./session.js";
import { PROJECT_MAP_CANVAS_ID } from "../../shared/api.js";
import type { BoxDto, CoverageOverlayDto, OpenResult } from "../../shared/api.js";

export interface MapPageContext {
  session: Session;
  actions: () => ViewActions;
  applied: (r: OpenResult | { error: string }) => boolean;
  refreshVc: () => void;
  renderNavPane: () => void;
  renderCentre: () => void;
  /** Navigate sideways, offering the way back (navigation.ts). */
  arriveFrom: (label: string, back: () => void, navigate: () => void) => void;
  /** Make a card at a place and open it (actions.ts). */
  newCardAt: (boxId: string, deckId: string, place: { hand?: string; zone?: string }, back: { label: string; go: () => void }) => void;
  comments: Comments;
  /** The coverage overlay's last run, and whether it is on. */
  coverage: () => CoverageOverlayDto | undefined;
  /** Hand the mounted canvas's coverage repaint to whoever gathers coverage. */
  setCoverageRefresh: (refresh: (() => void) | undefined) => void;
}

export type MapPage = ReturnType<typeof createMapPage>;

export function createMapPage(ctx: MapPageContext) {
  const { session } = ctx;
  const studio = session.studio;
  /** The live map canvas, held so the centre can tear it down: a Konva stage
   *  owns window listeners and an observer. */
  let mapView: MountedMapView | undefined;
  /** Edit layout on the project map, for this session. Reading is where the
   *  map opens: a remembered edit mode would greet the author with a canvas
   *  that rebinds hands on a stray drag. */
  let editing = false;
  /** A site or zone the next mount of the map should land on selected. */
  let landOn: string | undefined;

  /**
   * Draw the project map's page into `host`.
   *
   * Its edits name no box (`""` to main's map calls): zones, pictures and frames
   * are the project's and land in the root map shard. Sites are each box's, so
   * those calls name the box the site belongs to.
   */
  function render(host: HTMLElement): void {
    const project = session.project;
    if (!project?.map) { host.replaceChildren(); return; }
    const actions = ctx.actions();
    host.classList.remove("measured");
    const users = project.boxes.filter((b) => b.usesMap === true);
    const head = documentHeading("Project map", {
      comments: {
        on: PROJECT_MAP_CANVAS_ID, count: actions.openThreads(PROJECT_MAP_CANVAS_ID),
        open: (a) => actions.showComments(PROJECT_MAP_CANVAS_ID, "Map", a),
      },
    });
    head.append(
      el("h2", { className: "collection-title", text: "Map" }),
      el("p", { className: "master-sub mapdoc-sub" },
        users.length > 0 ? "Zones drawn once for the project. Used by " : "Zones drawn once for the project. No box uses it yet.",
        ...users.flatMap((b, i) => [...(i > 0 ? [" "] : []), boxChip(b)])));
    const viewHost = el("div", { className: "nodeview" });
    host.replaceChildren(el("div", { className: "mapdoc" }, head, viewHost));
    const group = project.map.groupId;
    void (async () => {
      const [{ mountMapView }, panel, map] = await Promise.all([
        import("./map-view.js"), import("./map-panel.js"), studio.projectMapView(),
      ]);
      if (!viewHost.isConnected || !map.hasMap) return;
      // The first drawing stores a colour for any box on the map with none
      // (main box-colours.ts). Everything already drawn in the old colours (the
      // navigator's glyphs, this page's "Used by" chips) is drawn again; the
      // second drawing finds nothing new, so this happens once.
      if (setBoxColours(map.layers.map((l) => ({ id: l.box, colour: l.colour })))) { ctx.renderNavPane(); ctx.renderCentre(); return; }
      mapView?.destroy();
      const redraw = (result: OpenResult | { error: string }): void => {
        if (!ctx.applied(result)) return;
        ctx.refreshVc();
        // The navigator too: its Map row counts the zones.
        ctx.renderNavPane();
        ctx.renderCentre();
      };
      const quiet = (result: OpenResult | { error: string }): void => {
        if (ctx.applied(result)) ctx.refreshVc();
      };
      /** Back to the map, landing on what the author left it from. */
      const backToMap = (select?: string): (() => void) => () => actions.openMap(select);
      const host2: MapPanelHost = {
        box: (id) => session.project?.boxes.find((b) => b.id === id),
        handCards: (box, hand) => studio.handCards(box, hand),
        zone: (tagId) => studio.mapZone(tagId),
        catalogue: (deck) => studio.cardCatalogue(deck),
        openCard: (box, deck, card, from) => ctx.arriveFrom("Map", backToMap(from), () => actions.inspectCard(box, deck, card)),
        openHand: (box, hand) => ctx.arriveFrom("Map", backToMap(hand), () => actions.openHand(box, hand)),
        // Made at the site, as the hand page makes one, but the way back is to
        // the map with the site still selected: that is where the author was.
        newCardAt: (box, deck, hand) => ctx.newCardAt(box, deck, { hand: hand.id }, { label: "Map", go: backToMap(hand.id) }),
        mapBoxes: () => users,
        // Filed to the zone rather than made at a hand; the way back is the map
        // with the zone still selected.
        newCardInZone: (box, deck, zone) => ctx.newCardAt(box, deck, { zone: zone.id }, { label: "Map", go: backToMap(zone.id) }),
        // The zones' page is a tag group page, which is a box's: any box on the
        // map shows the project's zone group (main's `groupHome`).
        editZones: () => { if (users[0]) ctx.arriveFrom("Map", backToMap(), () => actions.inspectTagGroup(users[0]!.id, group)); },
      };
      const zoneName = (id: string | undefined): string | undefined =>
        (id === undefined ? undefined : (map.zones.find((z) => z.id === id) ?? map.undrawn.find((z) => z.id === id))?.gameId);
      mapView = mountMapView(viewHost, map, editing, {
        openZone: () => host2.editZones(),
        openHand: (box, hand) => host2.openHand(box, hand),
        placeZone: (tagId, polygon) => void (async () => {
          const shaped = await studio.setZonePolygon("", group, tagId, polygon);
          if (ok(shaped)) redraw(shaped.result);
        })(),
        newZone: (polygon) => void (async () => {
          const name = await askZoneName(viewHost);
          const created = await studio.createZone("", group, polygon, name);
          if (ok(created)) redraw(created.result);
        })(),
        reshapeZone: (tagId, polygon) => void (async () => {
          // An empty polygon takes the zone off the map, which changes its shape:
          // a redraw. Otherwise the canvas has drawn it already: a quiet save.
          const shaped = await studio.setZonePolygon("", group, tagId, polygon.length === 0 ? undefined : polygon);
          if (!ok(shaped)) return;
          if (polygon.length === 0) redraw(shaped.result); else quiet(shaped.result);
        })(),
        addBackground: (place) => void (async () => {
          const added = await studio.addBackground("", group, place);
          if (added !== null && ok(added)) redraw(added.result);
        })(),
        editBackground: (id, edit, opts) => void (async () => {
          const result = await studio.editBackground("", group, id, edit, opts);
          if (opts?.coalesce === true) quiet(result); else redraw(result);
        })(),
        restackBackground: (id, move) => void (async () => redraw(await studio.restackBackground("", group, id, move)))(),
        removeBackground: (id) => void (async () => redraw(await studio.removeBackground("", group, id)))(),
        restackZone: (tagId, move) => void (async () => {
          const moved = await studio.restackZone("", group, tagId, move);
          if (ok(moved)) redraw(moved.result);
        })(),
        removeSite: (box, handId) => void (async () => redraw(await studio.removeSitesFromMap(box, [handId])))(),
        setColour: (box, colour) => void (async () => redraw(await studio.setBoxColour(box, colour)))(),
        movedSites: (box, moves) => void (async () => {
          const moved = await studio.moveSitesOnMap(box, group, moves);
          if (!ok(moved)) return;
          // A PLACEMENT changes the panel's waiting list, so the map is re-read; a
          // drag is a quiet save, and main's answer recolours the pins it rebound.
          const layer = map.layers.find((l) => l.box === box);
          const placed = moves.some((m) => !(layer?.sites ?? []).some((p) => p.id === m.id));
          if (placed) { redraw(moved.result); return; }
          quiet(moved.result);
          mapView?.rebound(moved.rebound);
        })(),
        newSite: (box, at, template) => void (async () => {
          const created = await studio.createHand(box, at, template);
          if (!ok(created)) return;
          landOn = created.handId;
          redraw(created.result);
        })(),
        setFurniture: (furniture, label, coalesce) => void (async () => {
          redraw(await studio.setCanvasFurniture("", { kind: "map" }, furniture, label, coalesce));
        })(),
        markers: () => ctx.comments.markers(),
        coverage: () => ctx.coverage(),
        coverageOn: () => session.state.coverageOverlay,
        openThread: (threadId, anchor) => ctx.comments.showThread(threadId, anchor, PROJECT_MAP_CANVAS_ID),
        startThread: (at, item, anchor) => ctx.comments.startThread(PROJECT_MAP_CANVAS_ID, at, item, anchor),
        moveMarker: (threadId, x, y, item) => ctx.comments.moveMarker(PROJECT_MAP_CANVAS_ID, threadId, x, y, item),
        layers: () => session.state.mapLayers?.[group] ?? {},
        setLayers: (prefs) => {
          session.state = { ...session.state, mapLayers: { ...session.state.mapLayers, [group]: prefs } };
          void studio.setMapLayers(group, prefs);
        },
        setEditing: (on) => { editing = on; ctx.renderCentre(); },
        paintSite: (side, layer, site, back) => panel.paintSitePanel(side, host2, layer, site, zoneName(site.zone), back),
        paintZone: (side, tagId, hidden, show, back) => panel.paintZonePanel(side, host2, tagId, hidden, show, back),
      });
      if (landOn !== undefined) { mapView.select(landOn); landOn = undefined; }
      ctx.setCoverageRefresh(() => mapView?.refreshCoverage());
      ctx.comments.attach(PROJECT_MAP_CANVAS_ID, {
        repaint: () => mapView?.repaintMarkers(),
        openMarker: (id) => mapView?.openMarker(id) ?? false,
      });
    })();
  }

  /**
   * Fill an opted-in box's Map tab: its own sites on the project map, one row a
   * hand, as the hand page and the map name it: title, its zone, and how many
   * cards are only here. A row opens the hand's own page.
   */
  function mountBoxSites(host: HTMLElement, box: BoxDto): void {
    void (async () => {
      const map = await studio.projectMapView();
      if (!host.isConnected) return;
      if (setBoxColours(map.layers.map((l) => ({ id: l.box, colour: l.colour })))) { ctx.renderNavPane(); ctx.renderCentre(); return; }
      const actions = ctx.actions();
      const layer = map.layers.find((l) => l.box === box.id);
      const zoneName = (id: string | undefined): string | undefined =>
        (id === undefined ? undefined : (map.zones.find((z) => z.id === id) ?? map.undrawn.find((z) => z.id === id))?.gameId);
      if (!layer) { host.replaceChildren(); return; }
      const rows = layer.sites.map((site) => el("button", {
        className: "listrow boxsite",
        onClick: () => ctx.arriveFrom(box.title ?? box.gameId, () => { setDocTab(`box:${box.id}`, "map"); actions.focus({ kind: "box", box: box.id }); },
          () => actions.openHand(box.id, site.id)),
      },
        el("span", { className: `listname${site.title !== undefined ? " listtitle" : ""}` }, boxPin(box.id), site.title ?? site.gameId),
        el("span", { className: "boxsite-meta" },
          ...(zoneName(site.zone) !== undefined ? [chip(zoneName(site.zone)!)] : [el("span", { className: "listmeta", text: "no zone" })]),
          el("span", { className: "listmeta", text: `${site.only} only here` }))));
      const waiting = layer.unplaced.length > 0
        ? [el("p", { className: "doc-tab-note", text: `${plural(layer.unplaced.length, "hand")} not on the map yet. Place ${layer.unplaced.length === 1 ? "it" : "them"} from the map, in Edit layout.` })]
        : [];
      host.replaceChildren(...(rows.length > 0 ? rows : [el("p", { className: "doc-tab-note", text: "No hands on the map yet. Open the map and add one in Edit layout." })]), ...waiting);
    })();
  }

  return {
    render,
    mountBoxSites,
    /** Open the map next on this site or zone, selected. */
    select(id: string | undefined): void { landOn = id; },
    /** The centre moved on: the canvas's element went with it, but not its
     *  window listeners or its ResizeObserver. */
    release(): void {
      mapView?.destroy();
      mapView = undefined;
    },
  };
}
