// ---------------------------------------------------------------------------
// The version-control surface: the shell's, plus the one thing only this app
// knows - WHAT STAYS LIVE in a document somebody else holds.
//
// The grammar moved to @wildwinter/app-shell (2026-08-09). Reading a shard
// somebody else holds must remain fully possible, so navigation, disclosure and
// view switches keep working while the writing stops; these selectors are how
// that reads in OUR markup, which is why they did not travel.
// ---------------------------------------------------------------------------

import { el, icon, lockControls as shellLockControls } from "@wildwinter/app-shell";

export { foldVc, vcBadgeFor, paintVcBadges, lockNotice } from "@wildwinter/app-shell";
export type { VcMap } from "@wildwinter/app-shell";

// Containers list their INSIDES too, because a card face's condition preview is
// drawn from buttons (pills): disabling those would swallow the click that opens
// the card.
const LIVE_LEAVES = [".crumb-back", ".doc-tab", ".centre-step", ".viewbtn", ".doc-collapsed", ".camerabtn"];
const LIVE_CONTAINERS = [
  ".outcome-row", ".scard:not(.ghost)", ".listrow:not(.ghost)", ".deck-card:not(.ghost)",
  ".cardwhen", ".ct-when",   // read-only condition previews (pills, not controls)
];
export const VC_STAYS_LIVE = [
  ...LIVE_LEAVES, ...LIVE_CONTAINERS, ...LIVE_CONTAINERS.map((s) => `${s} *`),
].join(", ");

/** Turn a frame's editing controls off, or back on. This app's live-selector
 *  list, the shell's mechanism. */
export function lockControls(host: HTMLElement, off: boolean): void {
  shellLockControls(host, off, VC_STAYS_LIVE);
}

// --- the role's own read-only, which is not version control at all ------------
// The same mechanism and the same look, for a different reason: under an
// author's key the shape shards are the designer's, so the editor says so
// BEFORE the edit rather than refusing it after (design/engine-server.md 9.1).

/** The line a document opens with when the shape is not this key's to change:
 *  the far end's own sentence, said before the edit instead of after it. */
export const shapeNotice = (): HTMLElement => el("div", { className: "vc-lock" },
  el("span", { className: "vc-lock-glyph", text: icon.readOnly }),
  el("span", { text: "Read-only: pull as designer to change the shape." }));

/**
 * May this role arrange a canvas?
 *
 * WHERE THINGS SIT IS THE SHAPE. A card's place on the node canvas lands in the
 * box's `.storyletview` shard, which an author's key may not change, while the
 * cards on that same canvas are the author's to write all day. So this greys
 * the arranging and nothing else: no drag, no frame, no arrange.
 */
export const arrangingLocked = (role: string | undefined): boolean => role === "author";

/** ...and is a canvas of that kind on screen right now? What decides whether
 *  the document wears the notice, since the canvas sits inside a document that
 *  is otherwise perfectly writable. */
export const canvasLocked = (centre: ParentNode, role: string | undefined): boolean =>
  arrangingLocked(role) && centre.querySelector(".nodeview") !== null;
