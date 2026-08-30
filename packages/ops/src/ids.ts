// ---------------------------------------------------------------------------
// Stable, immutable, opaque ids (schema doc section 1). Generated at
// creation, never derived from content or position. A short,
// collision-resistant base-36 token with a type prefix for debugging
// (Patter's id discipline, carried whole).
// ---------------------------------------------------------------------------

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Generate a new opaque id, e.g. `newId("c") -> "c_8f3kq2z1"`. */
export function newId(prefix = "", length = 8): string {
  // Rejection-sample so every alphabet character is equally likely (a plain
  // byte % 36 over-weights the first four characters).
  const limit = 256 - (256 % ALPHABET.length);
  let token = "";
  while (token.length < length) {
    const bytes = new Uint8Array(length * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= limit) continue;
      token += ALPHABET[b % ALPHABET.length];
      if (token.length === length) break;
    }
  }
  return prefix ? `${prefix}_${token}` : token;
}

/** Slugify an author name into a filename-safe segment. */
export function slug(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "project";
}
