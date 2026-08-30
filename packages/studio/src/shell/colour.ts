// The per-entity colour hash now lives in the shared shell package
// (@wildwinter/app-shell). This re-export keeps the local import path stable
// for the renderer / table while the extraction settles.
export { colourIndex, colourFor, PALETTE, PALETTE_SIZE } from "@wildwinter/app-shell";
