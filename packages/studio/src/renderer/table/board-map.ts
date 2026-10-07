// ---------------------------------------------------------------------------
// The Board's map: the same board, seen from above
// (design/graphical-views.md section 2, slice 6b).
//
// A VIEW of the Board, not a second map window. It draws with the editor's own
// modules (`map-art`, `canvas-surface`) and adds nothing to them, which is what
// keeps the two maps honest: this one has no tools, no vertex handles, nothing
// drags, and no gesture here is an undo step. "It is the Board" says NOT AN
// EDITOR without a word of explanation, so two maps never confuse.
//
// What it adds is the run: a pin wears the same running-position mark a row
// wears in the list (run-marks.ts), because a map that cannot show you where the
// playthrough is would only be a picture.
// ---------------------------------------------------------------------------

import Konva from "konva";
import { mountCanvasSurface, type CanvasSurface, type DrawContext } from "../src/canvas-surface.js";
import { readCanvasTokens, readableOn, watchCanvasTokens } from "../src/canvas-tokens.js";
import {
  backgroundShape, drawBackground, drawSite, drawZone, paintZoneLabels, siteShape, zoneShape, LABEL_FLOOR,
  type BackgroundShape, type SiteShape, type ZoneShape,
} from "../src/map-art.js";
import { onImageReady, retryFailedImages } from "../src/image-cache.js";
import type { BoxMapDto } from "../../shared/api.js";

/** One item on the Board's map. The same shapes the editor draws. */
type BoardItem =
  | (BackgroundShape & { kind: "background" })
  | (ZoneShape & { kind: "zone" })
  | (SiteShape & { kind: "site" });

export interface BoardMapMarks {
  /** The hand the last play came from: the live position. */
  now?: string;
  /** Hands played from earlier this run. */
  visited: (handGameId: string) => boolean;
  /** How many cards this hand is holding right now. A board is dealt, so this
   *  is the difference between a place with something going on and a place with
   *  nothing, which is the question a playtest asks of a map. */
  held: (handGameId: string) => number;
  /** The zone the Board is filtered to, if any: everything else goes quiet. */
  filtered?: string;
  /** Hands changed by the last board refresh: the ripple's "look here" ring
   *  (design/board-ripple.md). Replaced by the next refresh. */
  changed: (handGameId: string) => boolean;
  /** Bumped when a NEW changed-set arrives: the ring's pulse clock, so it
   *  pulses on the change and not on every camera repaint. */
  changedStamp: number;
}

export interface BoardMapActions {
  /**
   * A click on the map, in ONE call, so the Board renders once for it: the hand
   * it picked (a site, or none), and, only when a zone is involved, the zone the
   * whole Board is now filtered to (`{ id: undefined }` clears the filter). A
   * zone is involved when one was clicked, or when the click took the selection
   * off one. A site click leaves the filter alone. The map is the filter control
   * while it is open.
   */
  pick: (handGameId: string | undefined, zone?: { id: string | undefined }) => void;
  /** A site was double-clicked: open the hand in the editor. Reveal, never
   *  during a live session drive-by - the Board marks, it does not navigate. */
  reveal: (handGameId: string) => void;
}

export interface MountedBoardMap {
  /** New session state (a play, a deal, a filter): redraw the sites. The
   *  selection follows the Board: the selected hand's site, else the zone the
   *  Board is filtered to. Never reported back as a click. */
  update: (map: BoxMapDto, selected: string | undefined, marks: BoardMapMarks) => void;
  /** Frame the whole map: another box's map, or another group's, came in. */
  fit: () => void;
  destroy: () => void;
}

export function mountBoardMap(
  host: HTMLElement, map: BoxMapDto, selected: string | undefined,
  marks: BoardMapMarks, actions: BoardMapActions,
): MountedBoardMap {
  // A picture that failed last time (missing, then put back) gets another go.
  retryFailedImages();
  let tokens = readCanvasTokens();
  let current = map;
  let chosen = selected;
  let where = marks;

  /** A zone's name, drawn or not: a site can be bound to a zone nobody has traced. */
  const zoneName = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    return current.zones.find((z) => z.id === id)?.gameId
      ?? current.undrawn.find((z) => z.id === id)?.gameId;
  };

  const build = (): BoardItem[] => [
    // The same pictures the editor shows, in the same band below the zones, and
    // ALWAYS locked here: the Board is not an editor, so nothing on it is a
    // target. A hidden one stays hidden - what an author chose not to look at
    // while editing is not something to spring on them while they play.
    ...current.backgrounds.filter((b) => b.hidden !== true).map((b): BoardItem => ({
      kind: "background",
      ...backgroundShape({ ...b, locked: true }),
    })),
    ...current.zones.map((zone): BoardItem => ({
      kind: "zone",
      ...zoneShape({ id: zone.id, title: zone.gameId, name: zone.gameId, polygon: zone.polygon }),
    })),
    // Sites after the zones, so they draw on top and the pointer finds them first.
    ...current.sites.map((site): BoardItem => ({
      kind: "site",
      ...siteShape({
        id: site.id, title: site.title ?? site.gameId, name: site.gameId, at: { x: site.x, y: site.y },
        ...(site.zone !== undefined
          ? { zone: site.zone, ...(zoneName(site.zone) !== undefined ? { zoneName: zoneName(site.zone)! } : {}) }
          : {}),
      }),
      // In its box's stored colour, as on the editor's map (box-tint.ts): the
      // same pin is one colour wherever it is drawn.
      ...(site.colour !== undefined ? { tint: site.colour } : {}),
      // Filtered to one zone: everything else goes quiet rather than away.
      ...(where.filtered !== undefined && site.zone !== where.filtered ? { quiet: true } : {}),
    })),
  ];

  let items = build();
  const byId = (id: string): BoardItem | undefined => items.find((i) => i.id === id);
  /** True while `show` puts the Board's selection on the surface: that is the
   *  Board talking to the map, and must not come back as a click. It used to,
   *  and a zone click cleared its own filter on the way through. */
  let syncing = false;
  /** What the surface last had selected, by kind: a click that takes the
   *  selection off a zone involves that zone. */
  let selectedKind: BoardItem["kind"] | undefined;
  /** Sites are keyed by HAND id here and by hand gameId everywhere in the Board. */
  const handOf = (id: string): string | undefined => current.sites.find((p) => p.id === id)?.gameId;

  const surface: CanvasSurface<BoardItem> = mountCanvasSurface<BoardItem>({
    host,
    tokens,
    grid: 0,
    draw: (item: BoardItem, ctx: DrawContext): Konva.Group => {
      if (item.kind === "background") return drawBackground(item, ctx);
      return item.kind === "zone" ? drawZone(item, ctx) : drawSite(item, ctx);
    },
    hoverTip: (item, scale) => (scale < LABEL_FLOOR ? item.title : undefined),
    // One selection, two meanings, decided by what was picked: a site is a place
    // to look INTO (its cards), a zone is a place to look AT (filter the board to
    // it). Both are "what am I looking at", which is what a selection means
    // everywhere else in this app, so the two never need telling apart.
    onSelectionChange: (ids) => {
      // Pictures are locked here, so they never appear in a selection at all.
      const one = ids.length === 1 ? byId(ids[0]!) : undefined;
      const was = selectedKind;
      selectedKind = one?.kind;
      if (syncing) return;
      if (one?.kind === "zone") actions.pick(undefined, { id: one.id });
      else if (one?.kind === "site") actions.pick(handOf(one.id));
      else actions.pick(undefined, ...(was === "zone" ? [{ id: undefined }] : []));
    },
    onActivate: (id) => {
      const hand = byId(id)?.kind === "site" ? handOf(id) : undefined;
      if (hand !== undefined) actions.reveal(hand);
    },
    // No onMove, no onContext, no setTool: nothing here edits anything. The
    // surface still gives pan, zoom, the navigation cluster and hover tips.
  });

  /**
   * The run: the live position and its trail, BEHIND the sites.
   *
   * The live mark is a soft accent HALO, not a ring, and that is the whole
   * lesson of looking at it. A ring in the accent is what the surface already
   * draws around a SELECTED item, so a live site and a selected site were the same
   * mark, and a site that was both wore two concentric accent rings that read as
   * one thick one. The list has the same pair to tell apart and solves it the
   * same way: a wash for where the run is, a crisp outline for what you picked.
   *
   * Both are RINGS around the site, in the FOREGROUND, and both of those were
   * learnt by looking. Drawn behind the items they sat under the zones' own
   * translucent fills and washed out to nothing, the trail mark invisibly so. A
   * filled halo in the foreground would have covered the site it belongs to, so
   * rings it is: a ring cannot hide what it surrounds.
   *
   * The live ring is a circle in the accent; the SELECTION ring the surface
   * draws is a rectangle. Different shape, so a site that is both wears two
   * marks that can still be told apart, which two accent circles could not.
   */
  /** The rings painted by the LAST foreground pass, re-collected per paint so
   *  the pulse survives camera repaints without touching dead nodes. */
  let rings: Konva.Circle[] = [];
  let ringLayer: Konva.Container | undefined;
  let pulseAnim: Konva.Animation | undefined;
  let pulseFrom = 0;
  let lastStamp = -1;
  const PULSE_MS = 2200;   // two beats, like the list's 1.1s x2
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const settleRings = (): void => {
    for (const r of rings) {
      const base = r.getAttr("ringBase") as { opacity: number; width: number } | undefined;
      if (base) { r.opacity(base.opacity); r.strokeWidth(base.width); }
    }
  };
  const pulseRings = (): void => {
    if (reducedMotion || rings.length === 0 || ringLayer === undefined) return;
    pulseAnim?.stop();
    const layer = ringLayer.getLayer() ?? (ringLayer as Konva.Layer);
    pulseAnim = new Konva.Animation(() => {
      const t = performance.now() - pulseFrom;
      if (t > PULSE_MS) { settleRings(); pulseAnim?.stop(); return; }
      const beat = Math.sin(((t % (PULSE_MS / 2)) / (PULSE_MS / 2)) * Math.PI);
      for (const r of rings) {
        const base = r.getAttr("ringBase") as { opacity: number; width: number } | undefined;
        if (!base) continue;
        r.opacity(base.opacity * (0.45 + 0.55 * beat));
        r.strokeWidth(base.width * (1 + beat));
      }
    }, layer);
    pulseAnim.start();
  };

  function paintRun(): void {
    surface.setForeground((layer, scale, at) => {
      rings = [];
      ringLayer = layer;
      paintZoneLabels(layer, scale, tokens, current.zones, (id) => {
        const item = at(id);
        return item?.kind === "zone" ? item : undefined;
      });
      for (const site of current.sites) {
        const item = at(site.id);
        if (item?.kind !== "site") continue;

        // What this hand is holding, as a number inside its disc. It used to sit
        // on a plate above the pin, and that plate kept its size on screen at
        // every zoom, so zoomed out it covered the hands beside it. Inside the
        // disc it costs no room at all; the rings around it (the ripple, the
        // live and visited marks) stay outside, so nothing collides with it.
        const held = where.held(site.gameId);
        const dimmed = where.filtered !== undefined && site.zone !== where.filtered;
        // The ripple's ring: this hand changed in the last refresh. A quiet
        // accent halo OUTSIDE the disc (the coverage overlay's grammar), gone
        // at the next refresh - attention direction, not a permanent mark.
        if (where.changed(site.gameId)) {
          const ring = new Konva.Circle({
            x: item.x + item.width / 2, y: item.y + item.height / 2,
            radius: (item.width / 2) + 6 / scale,
            stroke: tokens.accent, strokeWidth: 2.5 / scale,
            opacity: dimmed ? 0.35 : 0.85,
            listening: false,
          });
          ring.setAttr("ringBase", { opacity: dimmed ? 0.35 : 0.85, width: 2.5 / scale });
          rings.push(ring);
          layer.add(ring);
        }
        if (held > 0) {
          // The disc is the hand's box colour (or hollow when nothing binds it),
          // so the number takes whichever of ink or surface reads on it. More
          // than two digits will not fit an 18px disc; a hand that full says 99+.
          const disc = item.unbound === true ? tokens.surface
            : item.tint !== undefined ? (tokens.chars[item.tint % tokens.chars.length] ?? tokens.accent)
            : tokens.accent;
          const text = new Konva.Text({
            text: held > 99 ? "99+" : String(held),
            fontSize: (held > 99 ? 8 : held > 9 ? 9.5 : 11) / scale,
            fontFamily: tokens.fontUi, fontStyle: "600",
            fill: readableOn(tokens, disc),
            opacity: dimmed ? 0.6 : 1,
            listening: false,
          });
          text.position({
            x: item.x + item.width / 2 - text.width() / 2,
            y: item.y + item.height / 2 - text.height() / 2,
          });
          // In front of the disc: the pins are drawn in the layer below, so this
          // foreground text sits on top of its own pin.
          layer.add(text);
        }

        const live = where.now === site.gameId;
        if (!live && !where.visited(site.gameId)) continue;
        // The site is drawn at a constant SCREEN size, so its ring holds one too:
        // a mark that shrank with the zoom would be gone at the size a map is
        // usually read at.
        const radius = (item.width / 2) + (live ? 8 : 5) / scale;
        layer.add(new Konva.Circle({
          x: item.x + item.width / 2, y: item.y + item.height / 2, radius,
          stroke: live ? tokens.accent : tokens.muted,
          strokeWidth: (live ? 2.5 : 1.5) / scale,
          opacity: live ? 1 : 0.75,
          listening: false,
        }));
      }
    });
  }

  /** What the surface should have selected: the chosen hand's site, or else
   *  the zone the Board is filtered to, so a filter set from the dropdown and
   *  one set by clicking the zone look the same. */
  const selection = (): string[] => {
    if (chosen !== undefined) {
      const site = current.sites.find((p) => p.gameId === chosen);
      return site ? [site.id] : [];
    }
    return where.filtered !== undefined && current.zones.some((z) => z.id === where.filtered) ? [where.filtered] : [];
  };

  const show = (): void => {
    surface.setItems(items);
    syncing = true;
    try { surface.select(selection()); } finally { syncing = false; }
    paintRun();
  };

  show();
  surface.fitAll();

  const unwatch = watchCanvasTokens((next) => { tokens = next; surface.setTokens(next); paintRun(); });
  // A picture finishing its load: the first paint of one is a placeholder.
  const unwatchImages = onImageReady(() => { surface.setItems(items); paintRun(); });

  const maybePulse = (): void => {
    if (where.changedStamp === lastStamp) return;
    lastStamp = where.changedStamp;
    pulseFrom = performance.now();
    pulseRings();
  };
  maybePulse();

  return {
    update(next, nextSelected, nextMarks) {
      current = next;
      chosen = nextSelected;
      where = nextMarks;
      items = build();
      show();
      maybePulse();
    },
    fit() { surface.fitAll(); },
    destroy() { pulseAnim?.stop(); unwatchImages(); unwatch(); surface.destroy(); },
  };
}
