// ---------------------------------------------------------------------------
// The project map's side panel: the LAYERS, and in Edit layout what each one
// holds. The selected hand's or zone's own panel is map-panel.ts; this decides
// which of the two is up, and draws the layers.
//
// A map is wide and shallow, so the room to spend is on the right, which is
// also the Board's own map shape: the canvas takes the big column and this
// panel carries the CONTENTS.
//
// Out of map-view.ts, which holds the canvas, and handed the pieces only the
// view knows (its model, its surface, the tools that arm a trace or a place),
// the way the furniture controller is.
// ---------------------------------------------------------------------------

import { el, iconNode, openAnchoredPanel, plural, wireReorder } from "@wildwinter/app-shell";
import { boxColour, boxColourIndex, boxPin } from "./box-tint.js";
import { PALETTE_SIZE } from "../../shell/colour.js";
import {
  MAP_LAYER_PICTURES, MAP_LAYER_ZONES, activeBox, hideAll, isShown, moveLayer, orderedBoxes, setActive,
  showAll, soloLayer, toggleLayer,
} from "./map-layers.js";
import { mapGlyph } from "./map-glyphs.js";
import { layerName } from "./map-words.js";
import type { CanvasSurface } from "./canvas-surface.js";
import type { MapItem, MapViewActions } from "./map-view.js";
import type {
  MapBackgroundDto, MapLayerPrefs, ProjectMapLayerDto, ProjectMapSiteDto, ProjectMapViewDto,
} from "../../shared/api.js";

/** The colour picker's width: six swatches a row. */
const SWATCH_PANEL_WIDTH = 196;
/** How far below a picture's row its menu opens, so the row stays readable. */
const ROW_MENU_GAP = 2;

export interface MapSideDeps {
  side: HTMLElement;
  map: ProjectMapViewDto;
  /** Edit layout, rather than reading. */
  editing: boolean;
  boxIds: readonly string[];
  layerOf: ReadonlyMap<string, ProjectMapLayerDto>;
  siteDto: ReadonlyMap<string, ProjectMapSiteDto>;
  prefs: () => MapLayerPrefs;
  /** Keep a change to the layers, and rebuild what is drawn. */
  keep: (next: MapLayerPrefs) => void;
  zoneName: (id: string | undefined) => string | undefined;
  surface: () => CanvasSurface<MapItem>;
  byId: (id: string) => MapItem | undefined;
  /** Something is being traced or placed: the panel stays on the layers. */
  busy: () => boolean;
  /** Arm the tracer for an undrawn zone. */
  trace: (zone: string, label: string) => void;
  /** Arm the placer for a hand with no pin. */
  place: (box: string, handId: string, label: string) => void;
  /** A picture's menu, open at a point on screen. */
  pictureMenu: (b: MapBackgroundDto, at: { x: number; y: number }) => void;
  actions: Pick<MapViewActions, "setColour" | "paintSite" | "paintZone">;
}

export interface MapSide {
  /** The panel for the selection now: the selected hand or zone while reading,
   *  else the layers. */
  paint: () => void;
  /** Whatever is up is out of date: the next paint redraws even the same panel. */
  forget: () => void;
}

export function createMapSide(deps: MapSideDeps): MapSide {
  const { side, map, editing, boxIds, layerOf, actions } = deps;

  /** The layer list's eye: click toggles, Option-click solos (and restores). */
  function eye(layer: string, label: string): HTMLElement {
    const shown = isShown(deps.prefs(), layer);
    const b = el("button", {
      className: `maplayer-eye${shown ? "" : " off"}`,
      tip: `${shown ? "Hide" : "Show"} ${label}. Option-click shows only this layer, and again puts the rest back.`,
    }, mapGlyph(shown ? "eye" : "eyeOff", 14, "map-glyph"));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const prefs = deps.prefs();
      deps.keep(e.altKey ? soloLayer(prefs, layer, boxIds) : toggleLayer(prefs, layer));
    });
    return b;
  }

  /**
   * The side panel with nothing selected: the LAYERS (the author's layered map
   * view). Show all / Hide all at the top, a row per box on the map in the
   * person's order (the active one highlighted), then Zones and Pictures.
   *
   * In Edit layout each layer opens out to its contents, which is what the old
   * Zones / Hands / Pictures panel held: the active box's sites and its hands
   * still waiting to be placed, every zone (an undrawn one arms its trace), and
   * every picture (a picture's row is the only handle a LOCKED picture has).
   */
  function paintLayers(): void {
    const prefs = deps.prefs();
    const active = activeBox(prefs, boxIds);
    const head = el("div", { className: "maplayers-head" },
      el("span", { className: "mapside-title", text: "Layers" }),
      el("span", { className: "crumb-spacer" }),
      el("button", { className: "maplayers-all", text: "Show all", onClick: () => deps.keep(showAll(deps.prefs())) }),
      el("button", { className: "maplayers-all", text: "Hide all", tip: "Hide every box's hands. Zones stay.", onClick: () => deps.keep(hideAll(deps.prefs(), boxIds)) }));
    const rows: HTMLElement[] = [];
    for (const box of orderedBoxes(prefs, boxIds)) {
      const layer = layerOf.get(box)!;
      const swatch = colourSwatch(layer);
      const row = el("div", {
        className: `maplayer${box === active ? " active" : ""}${isShown(prefs, box) ? "" : " hidden"}`,
        tip: box === active ? "The active layer: + Hand adds here." : "Make this the active layer",
      }, eye(box, layerName(layer)), el("span", { className: "maplayer-grip" }, iconNode("grip", 12)), swatch,
        el("span", { className: "maplayer-name", text: layerName(layer) }),
        el("span", { className: "maplayer-n", text: plural(layer.sites.length, "hand") }));
      row.addEventListener("click", () => deps.keep(setActive(deps.prefs(), box)));
      // The person's order, by drag: the pin draw order follows it.
      wireReorder(row, box, "y", (from, before, to) => deps.keep(moveLayer(deps.prefs(), boxIds, from, to, before)));
      rows.push(row);
      if (editing && box === active) rows.push(...activeContents(layer));
    }
    const zonesRow = el("div", { className: `maplayer${isShown(prefs, MAP_LAYER_ZONES) ? "" : " hidden"}` },
      eye(MAP_LAYER_ZONES, "the zones"), el("span", { className: "maplayer-grip none" }), el("i", { className: "maplayer-swatch zones" }),
      el("span", { className: "maplayer-name", text: "Zones" }),
      el("span", { className: "maplayer-n", text: plural(map.zones.length + map.undrawn.length, "zone") }));
    const picturesRow = el("div", { className: `maplayer${isShown(prefs, MAP_LAYER_PICTURES) ? "" : " hidden"}` },
      eye(MAP_LAYER_PICTURES, "the pictures"), el("span", { className: "maplayer-grip none" }), el("i", { className: "maplayer-swatch pictures" }),
      el("span", { className: "maplayer-name", text: "Pictures" }),
      el("span", { className: "maplayer-n", text: String(map.backgrounds.length) }));
    side.replaceChildren(head, ...rows, zonesRow, ...(editing ? zoneContents() : []),
      picturesRow, ...(editing ? pictureContents() : []),
      ...(editing
        ? []
        : [el("p", { className: "mapside-teach", text: boxIds.length > 0
            ? "Choose a hand to see what can come up there, or a zone for its properties and everything filed to it."
            : "No box uses the map yet. A box joins it from its own page." })]));
  }

  const subRow = (label: string, tip: string, onClick: (e: MouseEvent) => void, cls = "", meta?: string): HTMLElement =>
    el("button", { className: `mapside-row sub${cls}`, tip, onClick },
      el("span", { className: "mapside-name", text: label }),
      ...(meta !== undefined ? [el("span", { className: "mapside-meta", text: meta })] : []));

  /** Select one thing on the map and bring it into view: what a row is for. */
  const show = (id: string): void => {
    const surface = deps.surface();
    surface.select([id]);
    surface.showSelection();
  };

  /**
   * A layer's colour, as a swatch that changes it: the box's STORED colour
   * (box-tint.ts), picked from the identity palette in an anchored panel, the
   * app's one-choice picker (the deck picker's shape, inspector.ts). Patterpad
   * picks a writing status's colour the same way, a swatch that opens the
   * twelve slots. A slot another layer already wears says so, and can still be
   * chosen: the colours are the author's.
   */
  function colourSwatch(layer: ProjectMapLayerDto): HTMLElement {
    const swatch = el("button", { className: "maplayer-swatch pick", tip: `${layerName(layer)}'s colour. Click to change it.` });
    swatch.style.background = boxColour(layer.box);
    swatch.setAttribute("aria-label", `${layerName(layer)}'s colour`);
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = openAnchoredPanel({
        anchor: swatch, className: "swatchpick", title: `${layerName(layer)}'s colour`, width: SWATCH_PANEL_WIDTH, prefer: "below",
      });
      if (!panel) return;
      const grid = el("div", { className: "swatchpick-grid" });
      const now = boxColourIndex(layer.box);
      let focus: HTMLElement | undefined;
      for (let slot = 0; slot < PALETTE_SIZE; slot++) {
        const wearing = map.layers.filter((l) => l.box !== layer.box && boxColourIndex(l.box) === slot).map(layerName);
        const opt = el("button", {
          className: `swatchpick-opt${slot === now ? " sel" : ""}${wearing.length > 0 ? " taken" : ""}`,
          tip: wearing.length > 0 ? `Colour ${slot + 1}, which ${wearing.join(" and ")} ${wearing.length === 1 ? "wears" : "wear"}` : `Colour ${slot + 1}`,
          onClick: () => { panel.close(); if (slot !== now) actions.setColour(layer.box, slot); },
        });
        opt.style.background = `var(--char-${slot})`;
        opt.setAttribute("aria-label", `Colour ${slot + 1}`);
        if (slot === now) focus = opt;
        grid.append(opt);
      }
      panel.body.append(grid);
      focus?.focus();
    });
    return swatch;
  }

  /** The active layer's pinned hands and its hands still waiting for a pin. */
  function activeContents(layer: ProjectMapLayerDto): HTMLElement[] {
    return [
      ...layer.sites.map((site) => {
        const r = subRow(site.title ?? site.gameId, "Show its pin on the map",
          () => show(site.id), site.title !== undefined ? " titled" : "",
          deps.zoneName(site.zone) ?? "no zone");
        r.prepend(boxPin(layer.box));
        return r;
      }),
      ...layer.unplaced.map((hand) => {
        const r = subRow(hand.title ?? hand.gameId, "Not on the map yet. Click, then click where it sits.",
          () => deps.place(layer.box, hand.id, hand.title ?? hand.gameId), hand.title !== undefined ? " todo titled" : " todo");
        r.append(el("span", { className: "mapside-act", text: "place" }));
        return r;
      }),
    ];
  }

  function zoneContents(): HTMLElement[] {
    const rows = [
      ...map.zones.map((z) => {
        const r = subRow(z.gameId, "Show it on the map", () => show(z.id));
        // Neutral, as the zone is on the map: zones are the project's, and only
        // pins wear a box's colour.
        r.prepend(el("i", { className: "mapside-dot zone" }));
        return r;
      }),
      ...map.undrawn.map((z) => {
        const r = subRow(z.gameId, "Not drawn yet. Click to trace its outline.", () => deps.trace(z.id, z.gameId), " todo");
        r.append(el("span", { className: "mapside-act", text: "trace" }));
        return r;
      }),
    ];
    // What every zone carries, said once: the declarations are the group's.
    if (map.properties.length > 0) {
      rows.push(el("p", { className: "mapside-note",
        text: `Each zone has ${map.properties.map((p) => `${p.name}, ${/^[aeiou]/i.test(p.type) ? "an" : "a"} ${p.type}`).join("; ")}.` }));
    }
    return rows;
  }

  function pictureContents(): HTMLElement[] {
    return map.backgrounds.map((b) =>
      subRow(b.file, "Everything a picture can do, in its menu.",
        (e) => {
          const at = (e.currentTarget as HTMLElement).getBoundingClientRect();
          deps.pictureMenu(b, { x: at.left, y: at.bottom + ROW_MENU_GAP });
        }, "", [b.locked === true ? "locked" : "", b.hidden === true ? "hidden" : ""].filter((x) => x !== "").join(", ") || undefined));
  }

  /** Which panel is up, so a repaint of the same selection does not refetch it. */
  let panelFor: string | undefined;

  /** The panel: the selected hand or zone while reading, else the layers. Edit
   *  layout keeps the layers up whatever is selected: the content panel is for
   *  reading, and editing wants the contents to hand. */
  function paint(): void {
    const surface = deps.surface();
    const chosen = surface.selection();
    const only = !editing && !deps.busy() && chosen.length === 1 ? deps.byId(chosen[0]!) : undefined;
    const back = (): void => { surface.select([]); };
    if (only?.kind === "site") {
      if (panelFor === only.id) return;
      panelFor = only.id;
      actions.paintSite(side, layerOf.get(only.box)!, deps.siteDto.get(only.id)!, back);
      return;
    }
    if (only?.kind === "zone") {
      const prefs = deps.prefs();
      const key = `${only.id}|${(prefs.hidden ?? []).join(",")}`;
      if (panelFor === key) return;
      panelFor = key;
      const hidden = new Set(boxIds.filter((b) => !isShown(prefs, b)));
      actions.paintZone(side, only.id, hidden, (boxes) => {
        let next = deps.prefs();
        for (const b of boxes) if (!isShown(next, b)) next = toggleLayer(next, b);
        deps.keep(next);
      }, back);
      return;
    }
    panelFor = undefined;
    paintLayers();
  }

  return { paint, forget: () => { panelFor = undefined; } };
}
