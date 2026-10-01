// ---------------------------------------------------------------------------
// The project map's layers: which are showing, their order, and which one
// "+ Site" adds to (the surfacing review's plan item 2, the author's layered
// map view of 2026-10-01).
//
// Each box on the map is a layer of its own sites; Zones and Pictures are
// layers too. The rules, all here so the view only draws them:
//
//   - Show all shows every layer. Hide all hides the BOX layers only, never
//     Zones (nor Pictures): a page of pins with no zones round them is not a
//     map of anything.
//   - Option-click on an eye SOLOS that layer: it shows, and every other layer
//     hides except Zones, for the reason above. Option-click on the same eye
//     again puts back exactly what the solo put aside. Any other visibility
//     change forgets the solo, so a stale "restore" cannot undo work since.
//   - One box layer is ACTIVE. It is the one named, when it is still on the
//     map, else the top one. "+ Site" goes into it, so the new site's box is
//     never asked; selecting a site makes its box active.
//   - The order is the person's, top first, and sets pin draw order: the top
//     layer's pins draw over the rest. Zones and Pictures are not in it. They
//     are bands, structurally below every site (map-view.ts builds pictures,
//     then zones, then sites), so ordering them would be a control that
//     promises something the canvas cannot do.
//
// Pure over MapLayerPrefs, which is app state, never the project's: hiding a
// layer is a focus tool, and two people on one project focus differently.
// ---------------------------------------------------------------------------

import type { MapLayerPrefs } from "../../shared/api.js";

/** The Zones layer's id among the layer ids (the rest are box ids). */
export const MAP_LAYER_ZONES = "zones";
/** The Pictures layer's id. */
export const MAP_LAYER_PICTURES = "pictures";

/** Is this layer showing? */
export const isShown = (prefs: MapLayerPrefs, layer: string): boolean =>
  !(prefs.hidden ?? []).includes(layer);

/** The box layers, top first: the person's order, then any box it does not
 *  name (new to the map since), in project order. A name no longer on the map
 *  is dropped rather than kept as a hole. */
export function orderedBoxes(prefs: MapLayerPrefs, boxes: readonly string[]): string[] {
  const known = new Set(boxes);
  const named = (prefs.order ?? []).filter((b) => known.has(b));
  const seen = new Set(named);
  return [...named, ...boxes.filter((b) => !seen.has(b))];
}

/** The active box layer, or undefined when no box is on the map. */
export function activeBox(prefs: MapLayerPrefs, boxes: readonly string[]): string | undefined {
  if (prefs.active !== undefined && boxes.includes(prefs.active)) return prefs.active;
  return orderedBoxes(prefs, boxes)[0];
}

/** Without the solo record, which every change but the restoring click ends. */
const unsolo = (prefs: MapLayerPrefs): MapLayerPrefs => {
  const next = { ...prefs };
  delete next.solo;
  return next;
};

const withHidden = (prefs: MapLayerPrefs, hidden: Iterable<string>): MapLayerPrefs => {
  const list = [...new Set(hidden)];
  const next = { ...prefs };
  if (list.length > 0) next.hidden = list; else delete next.hidden;
  return next;
};

/** A plain click on an eye. */
export function toggleLayer(prefs: MapLayerPrefs, layer: string): MapLayerPrefs {
  const hidden = new Set(prefs.hidden ?? []);
  if (hidden.has(layer)) hidden.delete(layer); else hidden.add(layer);
  return withHidden(unsolo(prefs), hidden);
}

/** Show every layer. */
export function showAll(prefs: MapLayerPrefs): MapLayerPrefs {
  return withHidden(unsolo(prefs), []);
}

/** Hide every BOX layer, leaving Zones and Pictures as they are. */
export function hideAll(prefs: MapLayerPrefs, boxes: readonly string[]): MapLayerPrefs {
  return withHidden(unsolo(prefs), [...(prefs.hidden ?? []), ...boxes]);
}

/**
 * An Option-click on an eye: solo the layer, or, on the layer already soloed,
 * put back what the solo hid.
 */
export function soloLayer(prefs: MapLayerPrefs, layer: string, boxes: readonly string[]): MapLayerPrefs {
  if (prefs.solo?.layer === layer) return withHidden(unsolo(prefs), prefs.solo.hidden);
  // Soloing a second layer straight after a first keeps the FIRST snapshot:
  // the restore should return to how things were before any soloing began.
  const before = prefs.solo?.hidden ?? prefs.hidden ?? [];
  const all = [...boxes, MAP_LAYER_PICTURES];
  const hidden = all.filter((l) => l !== layer);
  return { ...withHidden(prefs, hidden), solo: { layer, hidden: [...before] } };
}

/** Make a box layer the active one. */
export function setActive(prefs: MapLayerPrefs, box: string): MapLayerPrefs {
  return prefs.active === box ? prefs : { ...prefs, active: box };
}

/** Move one box layer before or after another, in the person's order. */
export function moveLayer(
  prefs: MapLayerPrefs, boxes: readonly string[], from: string, to: string, before: boolean,
): MapLayerPrefs {
  const order = orderedBoxes(prefs, boxes).filter((b) => b !== from);
  const at = order.indexOf(to);
  if (at < 0 || from === to) return prefs;
  order.splice(before ? at : at + 1, 0, from);
  return { ...prefs, order };
}
