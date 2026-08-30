// ---------------------------------------------------------------------------
// The version-control surface: the shell's, plus the one thing only this app
// knows - WHAT STAYS LIVE in a document somebody else holds.
//
// The grammar moved to @wildwinter/app-shell (2026-08-09). Reading a shard
// somebody else holds must remain fully possible, so navigation, disclosure and
// view switches keep working while the writing stops; these selectors are how
// that reads in OUR markup, which is why they did not travel.
// ---------------------------------------------------------------------------

import { lockControls as shellLockControls } from "@wildwinter/app-shell";

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
