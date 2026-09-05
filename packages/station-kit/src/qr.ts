// ---------------------------------------------------------------------------
// The QR display: a party's keepsake, a placard's code, a kiosk's pairing
// square.
//
// SVG, not a canvas and not a data URI. Three reasons, in the order they bit
// the previous system: a placard is PRINTED and a raster QR prints soft; a
// kiosk showing a QR for a phone to read across a counter needs it to scale
// with the screen and not with a device pixel ratio; and an SVG in the DOM can
// be styled by the venue's own stylesheet, which is the whole gradient
// argument in one element.
//
// Rendering is asynchronous (the encoder is), so the part exposes `ready`. A
// test awaits it; an app usually does not have to, because the caption is
// drawn immediately and the square appears a frame later.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import { toString as qrToString } from "qrcode";
import { cls, el } from "./part.js";
import type { Part } from "./part.js";

export interface QrState {
  /** What the code says. For a party keepsake this is the token URL the server
   *  handed over (`https://<server>/p/<token>`); for a placard it is
   *  `https://<server>/at/<venue>/<location>` and nothing else. */
  text: string;
  /** Printed under the square. "Photograph this to come back." */
  caption?: string;
}

export interface QrOptions {
  /** Error-correction level. `M` by default; a placard that will live on a
   *  wall behind a plant wants `Q` or `H`. */
  level?: "L" | "M" | "Q" | "H";
  /** Quiet-zone modules. The standard is 4 and printing below it is the
   *  classic reason a printed code will not scan. */
  margin?: number;
  /** Swap the encoder: a host that already ships one, or a test. */
  encode?: (text: string, opts: { level: string; margin: number }) => Promise<string>;
}

/** The reference encoder, wrapped so the part has one shape to call. */
const defaultEncode = (text: string, opts: { level: string; margin: number }): Promise<string> =>
  qrToString(text, {
    type: "svg",
    errorCorrectionLevel: opts.level as "L" | "M" | "Q" | "H",
    margin: opts.margin,
  });

export interface QrPart extends Part<QrState> {
  /** Resolves when the square on screen is the one for the last `update`.
   *  Rejects never: an encoder failure leaves the caption and a plain text
   *  fallback, because a kiosk that cannot draw a QR must still say the URL. */
  ready(): Promise<void>;
}

export function qrPart(opts: QrOptions = {}): QrPart {
  const root = el("figure", { className: cls("part", "qr") });
  const square = el("div", { className: cls("qr-square") });
  const caption = el("figcaption", { className: cls("qr-caption") });
  root.append(square, caption);

  const encode = opts.encode ?? defaultEncode;
  let disposed = false;
  let pending: Promise<void> = Promise.resolve();
  let drawn = "";

  return {
    el: root,
    ready: () => pending,
    update(state) {
      if (disposed) return;
      caption.textContent = state.caption ?? "";
      if (state.text === drawn) return;
      drawn = state.text;
      const wanted = state.text;
      pending = encode(wanted, { level: opts.level ?? "M", margin: opts.margin ?? 4 })
        .then((markup) => {
          // A later update may have overtaken this one; the last one wins.
          if (disposed || drawn !== wanted) return;
          square.innerHTML = markup;
        })
        .catch(() => {
          if (disposed || drawn !== wanted) return;
          // No square, but never a blank screen: the URL is the fallback, and
          // somebody can type it.
          square.replaceChildren(el("code", { className: cls("qr-fallback"), text: wanted }));
        });
    },
    dispose() {
      disposed = true;
      root.replaceChildren();
    },
  };
}
