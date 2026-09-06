// ---------------------------------------------------------------------------
// @storylet-studio/station-kit - the Storylet Server's UI parts.
//
// LAYER 3 of the four (design/engine-server.md section 12). Framework-neutral
// parts in the family's tokens, each usable alone: the handshake screen, the
// hand with its outcomes, a field renderer the venue drives, the zone strip,
// the message tray, the help button, the show clock, the QR display, the
// connection banner and the map.
//
// Nothing here talks to a server. The parts take state and give back events;
// `@storylet-studio/client` is what turns those into wire calls, and the
// reference apps in `@storylet-studio/station` are what wire the two together.
// That separation is what makes REARRANGE, the middle of the three routes, a
// day's work rather than a rewrite.
//
// It does not import the studio, and must not: the editor is Electron and
// this runs on a kiosk. The TOKEN NAMES are shared instead, which is the
// whole of the coupling and all of it that is wanted.
// ---------------------------------------------------------------------------

import { KIT_CSS } from "./style.js";

export { KIT, cls, el, svg } from "./part.js";
export type { Part } from "./part.js";
export { KIT_CSS } from "./style.js";

export { handPart } from "./hand.js";
export type { HandOptions, HandState } from "./hand.js";

export { BODY_FIELD, fieldRows, noFields, onlyFields, planTemplate, readingTemplate, showValue } from "./fields.js";
export type { CardFace, FieldPlan, FieldRow, FieldSpec, FieldTemplate } from "./fields.js";

export { handshakePart } from "./handshake.js";
export type { CallSignOption, HandshakeOptions, HandshakeState } from "./handshake.js";

export { zoneStripPart } from "./zones.js";
export type { ZoneStripLocation, ZoneStripOptions, ZoneStripState } from "./zones.js";

export { helpButtonPart, messageTrayPart } from "./messages.js";
export type {
  HelpButtonOptions, HelpButtonState, MessageTrayOptions, MessageTrayState,
} from "./messages.js";

export { showClockPart, showTime } from "./clock.js";
export type { ShowClockOptions, ShowClockState } from "./clock.js";

export { connectionBannerPart } from "./banner.js";
export type { ConnectionBannerOptions, ConnectionBannerState } from "./banner.js";

export { qrPart } from "./qr.js";
export type { QrOptions, QrPart, QrState } from "./qr.js";

export { venueMapPart } from "./map.js";
export type { MapZone, VenueMapOptions, VenueMapState } from "./map.js";

/** Put the kit's stylesheet in a document, once. Idempotent, so a page that
 *  mounts three parts calls it three times and gets one `<style>`.
 *
 *  A venue that would rather own the CSS never calls this and copies
 *  {@link KIT_CSS} into its own build. */
export function installKitStyles(doc?: Document): void {
  const target = doc ?? (globalThis as { document?: Document }).document;
  if (!target) return;
  const id = "storylet-station-kit";
  if (target.getElementById(id) !== null) return;
  const style = target.createElement("style");
  style.id = id;
  style.textContent = KIT_CSS;
  target.head.append(style);
}
