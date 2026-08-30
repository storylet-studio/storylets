// The themed confirm now lives in the shared shell package
// (@wildwinter/app-shell; styles arrive via theme.css's confirm.css import).
// This re-export keeps the `./confirm.js` import path stable across the
// renderer while the extraction settles.
export { confirmDialog } from "@wildwinter/app-shell";
export type { ConfirmOptions } from "@wildwinter/app-shell";
