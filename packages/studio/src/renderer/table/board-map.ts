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
// What it adds is the run: a site wears the same running-position mark a row
// wears in the list (run-marks.ts), because a map that cannot show you where the
// playthrough is would only be a picture.
// ---------------------------------------------------------------------------

import Konva from "konva";
import { mountCanvasSurface, type CanvasSurface, type DrawContext } from "../src/canvas-surface.js";
import { readCanvasTokens, watchCanvasTokens } from "../src/canvas-tokens.js";
import {
  backgroundShape, drawBackground, drawSite, drawZone, paintZoneLabels, siteShape, zoneShape, LABEL_FLOOR,
  type BackgroundShape, type SiteShape, type ZoneShape,
} from "../src/map-art.js";
import { onImageReady } from "../src/image-cache.js";
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
  /** A site was clicked: show that hand's cards. */
  select: (handGameId: string | undefined) => void;
  /** A ZONE was clicked: filter the whole Board to it, or clear the filter when
   *  the selection goes. The map is the filter control while it is open. */
  filter: (zoneId: string | undefined) => void;
  /** A site was double-clicked: open the hand in the editor. Reveal, never
   *  during a live session drive-by - the Board marks, it does not navigate. */
  reveal: (handGameId: string) => void;
}

export interface MountedBoardMap {
  /** New session state (a play, a deal, a filter): redraw the sites. */
  update: (map: BoxMapDto, selected: string | undefined, marks: BoardMapMarks) => void;
  destroy: () => void;
}

export function mountBoardMap(
  host: HTMLElement, map: BoxMapDto, selected: string | undefined,
  marks: BoardMapMarks, actions: BoardMapActions,
): MountedBoardMap {
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
        id: site.id, title: site.gameId, name: site.gameId, at: { x: site.x, y: site.y },
        ...(site.zone !== undefined
          ? { zone: site.zone, ...(zoneName(site.zone) !== undefined ? { zoneName: zoneName(site.zone)! } : {}) }
          : {}),
      }),
      // Filtered to one zone: everything else goes quiet rather than away.
      ...(where.filtered !== undefined && site.zone !== where.filtered ? { quiet: true } : {}),
    })),
  ];

  let items = build();
  const byId = (id: string): BoardItem | undefined => items.find((i) => i.id === id);
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
      actions.select(one?.kind === "site" ? handOf(one.id) : undefined);
      actions.filter(one?.kind === "zone" ? one.id : undefined);
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

        // What this hand is holding. Drawn beside the site rather than on it: a
        // site is a point on a map and a number inside one is a different object.
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
          const text = new Konva.Text({
            text: String(held),
            fontSize: 11 / scale, fontFamily: tokens.fontUi, fontStyle: "600",
            fill: dimmed ? tokens.muted : tokens.ink,
            listening: false,
          });
          text.position({
            x: item.x + item.width / 2 - text.width() / 2,
            // 17 rather than 13: the selection ring reaches a few pixels
            // above the pin, and a plate the ring cuts through reads broken.
            y: item.y - (17 / scale),
          });
          // On a plate, not floating: bare ink over a background picture had
          // no contrast to count on (the author could not read it at all over
          // the Village's art). The plate is the theme ground, so on a bare
          // map it reads as a quiet pill and over a picture it carries the
          // number.
          const padX = 4 / scale, padY = 1.5 / scale;
          layer.add(new Konva.Rect({
            x: text.x() - padX, y: text.y() - padY,
            width: text.width() + padX * 2, height: text.height() + padY * 2,
            fill: tokens.bg, stroke: tokens.lineSoft, strokeWidth: 1 / scale,
            cornerRadius: 7 / scale,
            opacity: dimmed ? 0.5 : 0.92,
            listening: false,
          }));
          text.opacity(dimmed ? 0.5 : 1);
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

  const show = (): void => {
    surface.setItems(items);
    if (chosen !== undefined) {
      const site = current.sites.find((p) => p.gameId === chosen);
      surface.select(site ? [site.id] : []);
    } else surface.select([]);
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
    destroy() { pulseAnim?.stop(); unwatchImages(); unwatch(); surface.destroy(); },
  };
}
