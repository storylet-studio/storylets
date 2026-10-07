// ---------------------------------------------------------------------------
// The Solo rung's one pointer under a zone's properties (zone-share.ts
// `SOLO_SHARE_POINTER`), drawn the way the Story page points at @world: the
// route as a link that opens Project settings at its General section, where
// the Play field is. The opener is the renderer's settings dialog, registered
// once, so the zones' page and the map's panel need not each be handed it.
// ---------------------------------------------------------------------------

import { el } from "@wildwinter/app-shell";
import { SOLO_SHARE_POINTER } from "./zone-share.js";

let openSettings: ((section: string) => void) | undefined;

/** The renderer's Project settings dialog, opened at a section. */
export function setSettingsOpener(open: (section: string) => void): void { openSettings = open; }

const ROUTE = "Project settings ▸ General";

/** The pointer as a paragraph: its sentence, with the route as a link. */
export function soloSharePointer(className: string): HTMLElement {
  const [before] = SOLO_SHARE_POINTER.split(ROUTE);
  return el("p", { className: `${className} zone-solo-pointer` },
    el("span", { text: before ?? "" }),
    openSettings !== undefined
      ? el("button", { className: "linklike", text: ROUTE, onClick: () => openSettings?.("general") })
      : el("span", { text: ROUTE }),
    el("span", { text: "." }));
}
