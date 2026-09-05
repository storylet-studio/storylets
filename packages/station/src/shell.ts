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
import type { Client, ConnectionState } from "@storylet-studio/client";
import { connectionBannerPart, el, installKitStyles, onlyFields } from "@storylet-studio/station-kit";
import type { FieldTemplate, Part } from "@storylet-studio/station-kit";
import { baseOf, loadConfig } from "./config.js";
import type { FieldSpec, StationConfig } from "./config.js";

export interface Shell {
  config: StationConfig;
  client: Client;
  /** Where an app puts its screen. */
  main: HTMLElement;
  /** A line above the screen: the title, the clock, whatever an app adds. */
  head: HTMLElement;
  /** Degraded mode, already mounted. An app calls `showConnection`. */
  banner: Part<{ connection: ConnectionState; held?: boolean; reason?: string; queued?: number }>;
  /** The venue's field template, from `station.json`. */
  template: FieldTemplate;
  /** Replace the screen with one message. The unprovisioned case, the refused
   *  case, the "come back to the door" case. */
  say(text: string, detail?: string): void;
}

/** A `FieldSpec[]` from `station.json` becomes a template. Absent shows
 *  everything the card carries, which is the kit's own default. */
export function templateFrom(fields: FieldSpec[] | undefined): FieldTemplate | undefined {
  if (fields === undefined) return undefined;
  const wanted: Record<string, string | undefined> = {};
  for (const spec of fields) {
    if (typeof spec === "string") wanted[spec] = undefined;
    else wanted[spec.field] = spec.label;
  }
  return onlyFields(wanted);
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
  const template = templateFrom(loaded.fields);

  return {
    config: loaded,
    client,
    head,
    main,
    banner,
    ...(template !== undefined ? { template } : {}),
    say(text, detail) {
      main.replaceChildren(
        el("p", { className: "app-say", text }),
        ...(detail !== undefined ? [el("p", { className: "sk-quiet", text: detail })] : []),
      );
    },
  } as Shell;
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
 *  them should have to remember to. */
export function showConnection(
  shell: Shell,
  connection: { subscribe(l: (s: ConnectionState, held: boolean, reason?: string) => void): () => void; visit?: { state: { queued: number } } },
): () => void {
  return connection.subscribe((state, held, reason) => {
    shell.banner.update({
      connection: state,
      held,
      ...(reason !== undefined ? { reason } : {}),
      queued: connection.visit?.state.queued ?? 0,
    });
  });
}
