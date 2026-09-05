// ---------------------------------------------------------------------------
// What all five reference apps share: a page, a client, a banner, and a place
// to put things.
//
// Deliberately thin. Everything hard is in `@storylet-studio/client` and
// everything drawn is in `@storylet-studio/station-kit`; this is the wiring a
// venue reads to see how the two go together, and then writes its own version
// of. That is the third route (REPLACE), and the test the layering has to pass
// is that reaching it costs nothing already spent.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import { createClient } from "@storylet-studio/client";
import type { Client, ClientError, ConnectionState } from "@storylet-studio/client";
import { connectionBannerPart, el, installKitStyles } from "@storylet-studio/station-kit";
import type { CardFace, FieldPlan, Part } from "@storylet-studio/station-kit";
import { baseOf, loadConfig } from "./config.js";
import type { StationConfig } from "./config.js";

export interface Shell {
  config: StationConfig;
  client: Client;
  /** Where an app puts its screen. */
  main: HTMLElement;
  /** A line above the screen: the title, the clock, whatever an app adds. */
  head: HTMLElement;
  /** Degraded mode, already mounted. An app calls `showConnection`. */
  banner: Part<{ connection: ConnectionState; held?: boolean; reason?: string; queued?: number }>;
  /** What this station's cards show: the venue's plan, plus the two switches
   *  the KIND decides. */
  face: CardFace;
  /** What to call a hand on screen. `station.json` names the ones the venue
   *  cares about; the rest are headed with their gameId. */
  handName(hand: string): string;
  /** Replace the screen with one message. The unprovisioned case, the refused
   *  case, the "come back to the door" case. */
  say(text: string, detail?: string): void;
}

/**
 * The card face for a station of this KIND, with the venue's plan inside it.
 *
 * The two switches are not the venue's to set (5.7). A card's purpose and an
 * outcome's purpose are the AUTHOR's notes: what the beat is for, written for
 * whoever performs it. A crew handset is the one screen with such a reader in
 * front of it, so a crew handset is the one screen that shows them, and no
 * edit to `station.json` can turn them on anywhere else.
 */
export function faceFrom(kind: StationConfig["kind"], plan: FieldPlan | undefined): CardFace {
  const crew = kind === "crew";
  return { ...plan, purpose: crew, outcomePurpose: crew };
}

/** Read the config, build the page, and hand back the pieces. Rejects never:
 *  an unprovisioned device gets a page that says so. */
export async function mountShell(root: HTMLElement, kind: StationConfig["kind"]): Promise<Shell | undefined> {
  installKitStyles(root.ownerDocument);
  const loaded = await loadConfig();
  const head = el("header", { className: "app-head" });
  const main = el("main", { className: "app-main" });

  if ("error" in loaded) {
    root.replaceChildren(head, main);
    main.replaceChildren(el("p", { className: "sk-error", text: loaded.error }));
    return undefined;
  }
  if (loaded.kind !== kind) {
    root.replaceChildren(head, main);
    main.replaceChildren(el("p", {
      className: "sk-error",
      text: `station.json says this is a "${loaded.kind}" station, and this page is the ${kind} app.`,
    }));
    return undefined;
  }

  const banner = connectionBannerPart(loaded.banner !== undefined ? { words: loaded.banner } : {});
  banner.update({ connection: "connecting" });
  root.replaceChildren(banner.el, head, main);
  head.append(el("h1", { className: "app-title", text: loaded.title ?? kind }));

  const client = createClient({ base: baseOf(loaded) });

  return {
    config: loaded,
    client,
    head,
    main,
    banner,
    face: faceFrom(loaded.kind, loaded.fields),
    handName: (hand: string) => loaded.hands?.[hand] ?? hand,
    say(text, detail) {
      main.replaceChildren(
        el("p", { className: "app-say", text }),
        ...(detail !== undefined ? [el("p", { className: "sk-quiet", text: detail })] : []),
      );
    },
  };
}

/** The page's own styling, over the kit's. Small on purpose: these apps are
 *  meant to be plain enough that nobody mistakes one for the venue's design
 *  (spec 12), and everything that looks like anything is a kit part. */
export const APP_CSS = `
html, body { height: 100%; margin: 0; background: var(--bg, #e6eaef); }
body { font-family: var(--font-ui, system-ui, sans-serif); color: var(--ink, #161e28); }
#app { max-width: 44rem; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
.app-head { display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap; }
.app-title { font: 600 1.3rem var(--font-read, Georgia, serif); margin: 0; flex: 1; }
.app-main { display: flex; flex-direction: column; gap: 16px; }
.app-say { font: 1.1rem/1.5 var(--font-read, Georgia, serif); }
.app-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.app-section { display: flex; flex-direction: column; gap: 8px; }
`;

/** Wire the banner to the connection, once. Every app does this and none of
 *  them should have to remember to.
 *
 *  Including the part that is easy to miss: a REFUSAL IS AN ANSWER, and the
 *  banner is not for answers. The server heard the phone and said which
 *  credential it is holding; the page shows that sentence, and a banner over
 *  the top of it - "No connection. Come back to this spot in a moment." across
 *  "that was a day pass for a run that has ended" - sends a visitor to wait at
 *  a wall for something that is never coming. Seen at the door on 2026-09-05.
 *  Degraded mode is for a connection that failed and will catch up by itself
 *  (spec 17 item 2), which is exactly what a refusal is not. */
export function showConnection(
  shell: Shell,
  connection: {
    subscribe(l: (s: ConnectionState, held: boolean, reason?: string) => void): () => void;
    visit?: { state: { queued: number } };
    /** The server's refusal of this bearer, when there is one. */
    refusal?: ClientError;
  },
): () => void {
  return connection.subscribe((state, held, reason) => {
    if (connection.refusal !== undefined) {
      // Say nothing, which is what this part does when the connection is
      // current: there is nothing held, and nothing to wait for. Hidden
      // outright as well, so a venue that gave `live` words of its own does
      // not put them here either.
      shell.banner.update({ connection: "live", queued: 0 });
      shell.banner.el.hidden = true;
      return;
    }
    shell.banner.update({
      connection: state,
      held,
      ...(reason !== undefined ? { reason } : {}),
      queued: connection.visit?.state.queued ?? 0,
    });
  });
}
