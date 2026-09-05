// ---------------------------------------------------------------------------
// The handshake screen: the door every station has, in the three shapes the
// spec gives it (7.1, 7.2).
//
//   - the CAMERA, reading the QR a party carries. `BarcodeDetector` where the
//     browser has it, which is every Android kiosk and Chrome on a laptop.
//   - a TYPED CODE, which is the fallback and is never optional: a camera can
//     be missing, refused, dirty, or pointed at a phone with a cracked screen,
//     and a performer with a queue behind them needs a way through.
//   - a CALL SIGN, picked from a list. Low entropy, so a station key and a
//     person in the loop are what make it safe: the performer hears "quiet
//     otter", types three letters and picks from a handful.
//
// The part never resolves anything itself. It reports what it read and the
// app calls `handshake`, because which credential kind a station may present
// is the client's business and refusing one is the server's.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import { cls, el } from "./part.js";
import type { Part } from "./part.js";

/** The browser API this uses where it exists. Declared here rather than
 *  imported: it is not in lib.dom, and a kit that fails to compile on a
 *  toolchain without it would be a kit nobody could build. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

/** One entry in the call-sign pick list. */
export interface CallSignOption {
  callSign: string;
  /** What a performer needs to tell two similar parties apart: "arrived 14:02",
   *  "four people". Never a name: the server holds none (spec 7.4). */
  hint?: string;
}

export interface HandshakeState {
  /** Shown under the code entry: a refusal, in the server's own words. */
  error?: string;
  /** The pick list, filtered by whatever the performer has typed. Absent hides
   *  the call-sign half entirely, which is right for a kiosk. */
  callSigns?: CallSignOption[];
  /** Something is in flight: every control is disabled rather than silently
   *  doing nothing. */
  busy?: boolean;
}

export interface HandshakeOptions {
  /** A QR was read, or a code was typed. The value is whatever was on it: the
   *  app decides whether that is a token URL or a bare token. */
  onCode(code: string): void;
  /** A call sign was picked from the list. */
  onCallSign?(callSign: string): void;
  /** The performer typed into the call-sign filter; the app narrows the list
   *  and calls `update`. Server-side, because the list is the run's. */
  onFilter?(text: string): void;
  /** Ask for the camera. Default true; a companion page passes false, since a
   *  phone showing its own QR has nothing to scan. */
  camera?: boolean;
  title?: string;
  /** What the typed-code field is called. A venue's word for the thing printed
   *  on the card. */
  codeLabel?: string;
  /** For a test, or for a host with its own scanner: supply the detector. */
  BarcodeDetector?: BarcodeDetectorCtor;
  /** For a test: supply the camera. */
  getUserMedia?: (constraints: unknown) => Promise<MediaStream>;
}

const SCAN_INTERVAL_MS = 400;

export function handshakePart(opts: HandshakeOptions): Part<HandshakeState> {
  const root = el("section", { className: cls("part", "handshake") });
  const heading = el("h2", { text: opts.title ?? "Welcome" });
  const scanner = el("div", { className: cls("scanner") });
  scanner.hidden = true;
  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.muted = true;
  scanner.append(video);

  const codeLabel = el("label", { className: cls("label"), text: opts.codeLabel ?? "Or type the code" });
  const code = document.createElement("input");
  code.type = "text";
  code.autocapitalize = "off";
  code.spellcheck = false;
  code.setAttribute("aria-label", opts.codeLabel ?? "Code");
  const go = el("button", { className: `${cls("button")} ${cls("primary")}`, type: "button", text: "Go" }) as HTMLButtonElement;
  const entry = el("div", { className: cls("code-entry") }, code, go);

  const error = el("p", { className: cls("error") });
  error.hidden = true;

  const filter = document.createElement("input");
  filter.type = "text";
  filter.setAttribute("aria-label", "Call sign");
  filter.placeholder = "quiet o...";
  const filterWrap = el("div", { className: cls("code-entry") }, filter);
  const list = el("div", { className: cls("callsigns") });
  const callSignLabel = el("p", { className: cls("label"), text: "Or say a call sign" });
  const callSignBlock = el("div", { className: cls("callsign-block") }, callSignLabel, filterWrap, list);
  callSignBlock.hidden = true;

  root.append(heading, scanner, codeLabel, entry, error, callSignBlock);

  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stream: MediaStream | undefined;
  let lastRead = "";

  const submit = (): void => {
    const value = code.value.trim();
    if (value === "") return;
    code.value = "";
    opts.onCode(value);
  };
  go.addEventListener("click", submit);
  code.addEventListener("keydown", (ev) => { if ((ev as KeyboardEvent).key === "Enter") submit(); });
  filter.addEventListener("input", () => opts.onFilter?.(filter.value.trim()));

  // The camera, where there is one. Every step of this can fail (no API, no
  // permission, no camera, a video element that will not play) and every
  // failure is the same outcome: the typed code, which was already on screen.
  const startCamera = async (): Promise<void> => {
    if (opts.camera === false) return;
    const Detector = opts.BarcodeDetector
      ?? (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    const media = opts.getUserMedia
      ?? (globalThis as { navigator?: { mediaDevices?: { getUserMedia?: (c: unknown) => Promise<MediaStream> } } })
        .navigator?.mediaDevices?.getUserMedia?.bind(globalThis.navigator.mediaDevices);
    if (!Detector || !media) return;
    let detector: BarcodeDetectorLike;
    try {
      detector = new Detector({ formats: ["qr_code"] });
      stream = await media({ video: { facingMode: "environment" } });
    } catch {
      return; // refused, or no camera: the typed code stands
    }
    if (disposed) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    // `srcObject` is the test for a host with real media support. Where there
    // is none (jsdom, a headless harness) the stream is still started and the
    // detector still runs, because an injected detector is how this part is
    // tested at all; only the playback is skipped.
    if ("srcObject" in video) {
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        /* some kiosks autoplay without it; the detector reads the element either way */
      }
    }
    scanner.hidden = false;
    timer = setInterval(() => {
      void (async () => {
        try {
          const found = await detector.detect(video);
          const first = found[0];
          if (!first || first.rawValue === lastRead) return;
          lastRead = first.rawValue;
          opts.onCode(first.rawValue);
        } catch {
          /* a frame that will not decode is not an error worth showing */
        }
      })();
    }, SCAN_INTERVAL_MS);
  };
  void startCamera();

  return {
    el: root,
    update(state) {
      if (disposed) return;
      error.hidden = state.error === undefined;
      error.textContent = state.error ?? "";
      const busy = state.busy === true;
      go.disabled = busy;
      code.disabled = busy;
      filter.disabled = busy;

      const options = state.callSigns;
      callSignBlock.hidden = options === undefined;
      if (options === undefined) return;
      list.replaceChildren();
      for (const option of options) {
        const label = option.hint === undefined ? option.callSign : `${option.callSign} (${option.hint})`;
        const button = el("button", {
          className: cls("button"),
          type: "button",
          text: label,
          attrs: { "data-callsign": option.callSign },
          onClick: () => opts.onCallSign?.(option.callSign),
        }) as HTMLButtonElement;
        button.disabled = busy;
        list.append(button);
      }
      // A pick list of one is a pick list a tired performer taps by accident,
      // so it still needs the same deliberate press. It is not auto-selected.
      if (options.length === 0) {
        list.append(el("p", { className: cls("quiet"), text: "No call sign like that." }));
      }
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      for (const track of stream?.getTracks() ?? []) track.stop();
      stream = undefined;
      root.replaceChildren();
    },
  };
}
