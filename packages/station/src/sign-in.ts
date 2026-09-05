// ---------------------------------------------------------------------------
// The SIGN-IN station: the door.
//
// Any station can MINT a party; the sign-in station is the one that CLAIMS
// (spec 7.2), because it is the one with hardware behind it: a label printer
// for the QR, a reader for wristbands, and a person who can say a call sign
// out loud and hear it back.
//
// The old system minted the join URL and never built the page that received
// it. This is that page, and it is deliberately four buttons: mint, claim,
// another credential for the rest of the group, and print.
//
// "Speak the call sign" is `speechSynthesis` where a browser has it, which is
// most kiosks. A call sign is chosen by the SERVER, never typed by the party,
// so it cannot collide and cannot carry a name (spec 7.1); saying it aloud is
// how the party learns it, and hearing it back is how a performer verifies it.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import type { PartyId } from "@storylet-studio/wire";
import { ClientError } from "@storylet-studio/client";
import type { StationConnection } from "@storylet-studio/client";
import { el, qrPart } from "@storylet-studio/station-kit";
import { mountShell, showConnection } from "./shell.js";
import type { Shell } from "./shell.js";

/** Say it out loud, where the browser can. Silent where it cannot, which is
 *  every headless harness and some kiosks: a station that cannot speak still
 *  shows the words. */
export function speak(words: string, synth?: { speak(u: unknown): void; cancel(): void }): void {
  const speech = synth ?? (globalThis as { speechSynthesis?: { speak(u: unknown): void; cancel(): void } }).speechSynthesis;
  const Utterance = (globalThis as { SpeechSynthesisUtterance?: new (text: string) => unknown }).SpeechSynthesisUtterance;
  if (!speech || !Utterance) return;
  try {
    speech.cancel();
    speech.speak(new Utterance(words));
  } catch {
    /* a station that will not speak is not a station that should stop */
  }
}

export async function startSignIn(root: HTMLElement): Promise<void> {
  const shell = await mountShell(root, "sign-in");
  if (!shell) return;
  const key = shell.config.stationKey;
  const installation = shell.config.installation;
  if (key === undefined || installation === undefined) {
    shell.say(
      "This sign-in station is not provisioned.",
      "station.json needs a \"stationKey\" and an \"installation\".",
    );
    return;
  }
  const station = shell.client.connectStation(key);
  showConnection(shell, station);
  desk(shell, station, installation);
}

function desk(shell: Shell, station: StationConnection, installation: string): void {
  const keepsake = qrPart({ level: "Q" });
  const keepsakeWrap = el("div", { className: "app-section" });
  const words = el("p", { className: "app-say" });
  const note = el("p", { className: "sk-quiet" });
  const wristband = document.createElement("input");
  wristband.type = "text";
  wristband.placeholder = "wristband or chip";
  wristband.setAttribute("aria-label", "Wristband or chip");

  let party: PartyId | undefined;

  const fail = (err: unknown): void => {
    note.textContent = err instanceof ClientError ? err.message : String(err);
  };

  const mint = el("button", {
    className: "sk-button sk-primary",
    type: "button",
    text: "New party",
    onClick: () => {
      note.textContent = "";
      void station.mintParty({ installation, callSign: true }).then((minted) => {
        party = minted.partyId;
        words.textContent = minted.callSign ?? minted.partyId;
        speak(minted.callSign ?? "");
        keepsake.update({
          text: `${shell.client.base}/p/${minted.token}`,
          caption: "Photograph this, or take the printed card.",
        });
        keepsakeWrap.replaceChildren(keepsake.el);
        draw();
      }).catch(fail);
    },
  });

  const claim = el("button", {
    className: "sk-button",
    type: "button",
    text: "Claim (keepsake)",
    onClick: () => {
      if (party === undefined) return;
      // Issuing a permanent credential IS the claim: the party record flips to
      // claimed and leaves the sweep (spec 7.1).
      void station.claim(party, { kind: "callsign" }).then((claimed) => {
        words.textContent = claimed.callSign ?? words.textContent;
        speak(claimed.callSign ?? "");
        note.textContent = "Claimed. This pocket is theirs to come back to.";
      }).catch(fail);
    },
  });

  const bind = el("button", {
    className: "sk-button",
    type: "button",
    text: "Bind a wristband",
    onClick: () => {
      const ref = wristband.value.trim();
      if (party === undefined || ref === "") return;
      // Everyone in a party carries a credential that resolves to the same id:
      // four wristbands, one party, one flow, one pocket (spec 7.1).
      void station.issueCredential(party, { kind: "external", externalRef: ref }).then(() => {
        wristband.value = "";
        note.textContent = "Bound. Issue one per person in the group.";
      }).catch(fail);
    },
  });

  const print = el("button", {
    className: "sk-button",
    type: "button",
    text: "Print",
    // The QR is on screen and it is SVG, so the browser's own print is the
    // whole feature. A label printer is a bridge on the server side, not a
    // thing this page knows about.
    onClick: () => { (globalThis as { print?: () => void }).print?.(); },
  });

  const draw = (): void => {
    const ready = party !== undefined;
    for (const button of [claim, bind, print]) (button as HTMLButtonElement).disabled = !ready;
  };

  shell.main.replaceChildren(
    el("div", { className: "app-row" }, mint, claim, print),
    words,
    keepsakeWrap,
    el("div", { className: "app-row" }, wristband, bind),
    note,
  );
  draw();
}
