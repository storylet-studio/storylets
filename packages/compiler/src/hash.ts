// ---------------------------------------------------------------------------
// The content hash: FNV-1a 32-bit as a 7-char base-36 digest, matching
// Patter's `hash32` exactly (resolved 2026-07-19; schema doc 2.8). Computed
// over the canonical serialisation of the parsed shards, so formatting and
// comments never perturb it - only content does.
// ---------------------------------------------------------------------------

function fnv32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic 7-char base-36 hash of a string (full FNV-1a 32-bit width). */
export function hash32(input: string): string {
  return fnv32(input).toString(36).padStart(7, "0");
}
