// The `el` DOM primitive now lives in the shared shell package
// (@wildwinter/app-shell), whose signature is a superset of the one this file
// used to define. This re-export keeps the `./dom.js` import path stable across
// the renderer while the extraction settles.
export { el } from "@wildwinter/app-shell";
export type { Child, ElProps } from "@wildwinter/app-shell";
