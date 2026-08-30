// ---------------------------------------------------------------------------
// What the Links window says about a selected link, in words an author reads
// rather than fields a debugger reads.
//
// The first cut put everything on one line - "Opens this card: @story.world_events
// (tree_bloomed) by touch-the-bark" - which is every fact and no grammar. It did
// not say WHICH card, it read as a colon-list rather than a sentence, and with
// several contributing properties it ran off the end of the line.
//
// So an explanation has two parts: a LEAD naming both cards and what one does to
// the other, and one ROW per contributing property. Pure (strings in, strings
// out) so the phrasing is testable without a canvas.
// ---------------------------------------------------------------------------

import type { LinkReason } from "../../shared/api.js";

export type LinkClass = "enable" | "disable" | "influence" | "reference";

/** The verb for each class, in the third person: `<card> opens <card>`. Kept
 *  plain: "enable" and "disable" are the analyser's words, not an author's. */
const VERB: Record<LinkClass, string> = {
  enable: "opens",
  disable: "shuts",
  influence: "changes what is true for",
  // A reference is not directional: neither card writes it, they merely both
  // care. Phrased as a state of affairs, so it cannot be read as an effect.
  reference: "shares state with",
};

export interface Explanation {
  /** One sentence: who does what to whom. */
  lead: string;
  /** One per contributing property, in reading order. */
  rows: ExplanationRow[];
}

export interface ExplanationRow {
  /** The property, in the mono voice: `@story.world_events`. */
  property: string;
  /** The words around it, already phrased: "flag tree_bloomed, written by the
   *  outcome touch-the-bark". Empty when there is nothing to add. */
  detail: string;
  /** A caveat on this one reason, shown quieter still. */
  note?: string;
}

/**
 * Explain one link.
 *
 * `direction` is which side of the focus the neighbour sits on: `into` means the
 * neighbour affects the focus, `out of` means the focus affects the neighbour.
 * The lead always names both cards, because "this card" alone left the reader
 * looking back at the canvas to work out which one was meant.
 */
export function explainLink(
  focusTitle: string, neighbourTitle: string,
  direction: "into" | "out of", cls: LinkClass, via: LinkReason[],
): Explanation {
  const verb = VERB[cls];
  // A reference reads the same either way round, so it is always written with the
  // focus first: there is no direction to preserve.
  const lead = cls === "reference" || direction === "out of"
    ? `${focusTitle} ${verb} ${neighbourTitle}`
    : `${neighbourTitle} ${verb} ${focusTitle}`;
  return { lead, rows: via.map(row) };
}

function row(reason: LinkReason): ExplanationRow {
  const parts: string[] = [];
  if (reason.flag !== undefined) parts.push(`the flag ${reason.flag}`);
  if (reason.outcome !== undefined) parts.push(`written by the outcome ${reason.outcome}`);
  // A property with neither flag nor outcome is a plain read on both sides: say
  // so rather than leaving the row as a bare name with no verb anywhere in it.
  const detail = parts.length > 0 ? parts.join(", ") : "read on both sides";
  return { property: reason.property, detail, ...(reason.note ? { note: reason.note } : {}) };
}
