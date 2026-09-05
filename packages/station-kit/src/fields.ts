// ---------------------------------------------------------------------------
// The field renderer: a card's fields, drawn by a template the VENUE supplies.
//
// A card's fields are the project's own vocabulary (`prompt` for the stage
// direction a performer reads, `cue` for the bulb on the desk, whatever else
// the venue's card template declares). The server never interprets them and
// neither does the kit: it draws what a template says to draw, in the order
// the template says.
//
// This is the second half of RESTYLE, the cheapest of the three routes
// (spec 12): tokens change the look, a field template changes the words. A
// venue that gets both right may never need to touch the parts at all.
// ---------------------------------------------------------------------------

import type { ScalarValue } from "@storylet-studio/model";
import type { DealtCardView } from "@storylet-studio/wire";

/** One line the renderer draws. `key` becomes a class (`sk-field-prompt`), so
 *  a venue can style one field without touching the rest. */
export interface FieldRow {
  key: string;
  /** Absent draws the value alone, which is what a stage direction wants. */
  label?: string;
  value: string;
}

/** A venue's template: given a card, say what to show. Returning an empty
 *  array shows nothing, which is right for a party-facing kiosk where the
 *  fields are the crew's business. */
export type FieldTemplate = (card: DealtCardView) => FieldRow[];

/** How a scalar reads on a screen. `false` is drawn as "no" rather than
 *  omitted: a flag that is off is information a performer may need. */
export const showValue = (value: ScalarValue): string => {
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
};

/** Sentence case from a field name: `time_phase` -> `Time phase`. Used only by
 *  the default template, because a venue that cares supplies its own. */
const humanise = (key: string): string => {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The default: every field the card carries, labelled from its name, in
 *  declaration order, with `prompt` first because a performer reads it first
 *  (spec 5.7: the prompt list is what a crew view is FOR). */
export const defaultTemplate: FieldTemplate = (card) => {
  const fields = card.fields ?? {};
  const keys = Object.keys(fields);
  keys.sort((a, b) => (a === "prompt" ? -1 : b === "prompt" ? 1 : 0));
  return keys.flatMap((key) => {
    const value = fields[key];
    if (value === undefined || value === "") return [];
    return [{
      key,
      ...(key === "prompt" ? {} : { label: humanise(key) }),
      value: showValue(value),
    }];
  });
};

/** A template that shows nothing: the party-facing default, where a card's
 *  cue fields are the venue's business and not the visitor's. */
export const noFields: FieldTemplate = () => [];

/** Only these fields, in this order, labelled as given. The shortest way for a
 *  venue to say "show the prompt and the cue and nothing else".
 *
 *  ```ts
 *  const template = onlyFields({ prompt: undefined, cue: "Lighting" });
 *  ``` */
export const onlyFields = (wanted: Record<string, string | undefined>): FieldTemplate => (card) => {
  const fields = card.fields ?? {};
  return Object.entries(wanted).flatMap(([key, label]) => {
    const value = fields[key];
    if (value === undefined || value === "") return [];
    return [{ key, ...(label !== undefined ? { label } : {}), value: showValue(value) }];
  });
};

/** Run a template, with the default when a venue supplied none. Exported so
 *  the hand and the crew's prompt list share one path through it. */
export const fieldRows = (card: DealtCardView, template?: FieldTemplate): FieldRow[] =>
  (template ?? defaultTemplate)(card);
