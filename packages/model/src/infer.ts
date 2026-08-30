// ---------------------------------------------------------------------------
// Guessing a property's type from the value an outcome writes to it.
//
// For the "Set up @deck.x" quick fix. It used to declare a number defaulting to
// 0 and say so honestly in a comment: "the type is a guess". That is one round
// trip to the declaration per property, and the dominant authoring pattern is a
// BOOLEAN latch - in the ported Village, 63 of 66 @deck properties are only ever
// set true, so 63 guesses would all have been wrong.
//
// The written value usually settles it. Only confident readings are returned;
// anything else is left undefined, and the caller keeps the old default rather
// than inventing a type from a shrug.
// ---------------------------------------------------------------------------

import type { PropertyDecl } from "./index.js";

/** A confident reading of what `src` writes, or undefined. */
export function inferDeclFromWrite(src: string): Pick<PropertyDecl, "type" | "default"> | undefined {
  const s = src.trim();
  if (s === "true" || s === "false") return { type: "boolean", default: false };
  // A plain number, and negatives, which a counter's floor may well be.
  if (/^-?\d+(\.\d+)?$/.test(s)) return { type: "number", default: 0 };
  // A quoted literal: the string's own default is empty, not this value, since
  // the value is what one outcome happens to set.
  if (/^"[^"]*"$/.test(s) || /^'[^']*'$/.test(s)) return { type: "string", default: "" };
  // Flag arithmetic: set_flags / clear_flags read and write a flag set.
  if (/^(set_flags|clear_flags)\s*\(/.test(s)) return { type: "flags", default: [] };
  // Arithmetic on anything is a number: `@deck.heat + 1`, `@story.gold - 5`.
  if (/[+\-*/%]/.test(s) && !/^@[a-z]+\.[a-z0-9_-]+$/i.test(s)) return { type: "number", default: 0 };
  return undefined;
}
