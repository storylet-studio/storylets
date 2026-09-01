import { fnv32 } from "@wildwinter/toolkit";   // FNV-1a: a published algorithm, shared
// ---------------------------------------------------------------------------
// The content hash: FNV-1a 32-bit as a 7-char base-36 digest, matching
// Patter's `hash32` exactly (resolved 2026-07-19; schema doc 2.8). Computed
// over the canonical serialisation of the parsed shards, so formatting and
// comments never perturb it - only content does.
// ---------------------------------------------------------------------------



/** Deterministic 7-char base-36 hash of a string (full FNV-1a 32-bit width). */
export function hash32(input: string): string {
  return fnv32(input).toString(36).padStart(7, "0");
}
