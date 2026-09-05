// ---------------------------------------------------------------------------
// The field renderer: a card's fields, drawn for the station KIND, by a plan
// the VENUE supplies.
//
// A card's fields are the project's own vocabulary, and they are written for
// DIFFERENT AUDIENCES (spec 16.1): `text` is what the phone in a visitor's
// hand shows, `prompt` is the stage direction a performer reads, `cue` is for
// the bulb on the desk. The server never interprets them and neither does the
// kit: it draws what a plan says to draw, in the order the plan says.
//
// THE RULE, and the defect it exists to prevent (2026-09-05): a plan that
// showed every field showed the crew's prompt and the bridge's cue on a
// visitor's phone, labelled, under a card whose purpose - the AUTHOR's note
// about what the beat is for - was already sitting there as a paragraph. So a
// face names ONE body field, drawn as prose with no label, and lists the
// others it wants. Nothing arrives on a face because it happened to be there.
//
// This is the second half of RESTYLE, the cheapest of the three routes
// (spec 12): tokens change the look, a field plan changes the words. A venue
// that gets both right may never need to touch the parts at all.
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
  /** The story, drawn as prose rather than as a row: no label, reading type,
   *  and never a colon in front of it. One row at most, by convention. */
  prose?: boolean;
}

/** One field a plan asks for, and what to call it. A bare string means "show
 *  it, unlabelled", which is what a stage direction wants. */
export type FieldSpec = string | { field: string; label?: string };

/** What a station shows on a card, as `station.json` writes it. */
export interface FieldPlan {
  /** Draw the card's title. A venue whose own heading says it already may
   *  turn it off; absent is on. */
  title?: boolean;
  /** Which field is the STORY: the prose a party reads, drawn unlabelled.
   *  `text` by default (spec 16.1); an empty string draws no body, which is
   *  what a crew handset wants. */
  body?: string;
  /** The other fields, in this order. Empty is the party-facing answer: the
   *  cue vocabulary is the venue's business and not the visitor's. */
  show?: FieldSpec[];
}

/** A plan, plus the two switches that are the station KIND's and never the
 *  venue's (5.7). Both are author-facing material, and the kind is what
 *  decides whether there is an author's reader in front of the screen. */
export interface CardFace extends FieldPlan {
  /** The card's PURPOSE, under the title: the author's note about what the
   *  beat is for. A performer's note, and a performer's screen only. */
  purpose?: boolean;
  /** Each outcome's purpose, as a hint BESIDE its button. Never the button's
   *  text and never its accessible name: a hint a screen reader announces as
   *  the label is the same leak, said out loud. */
  outcomePurpose?: boolean;
}

/** The field a body defaults to. The demo's content and the venue kit's card
 *  template both call it this (16.1), and a project that calls it something
 *  else says so in `station.json`. */
export const BODY_FIELD = "text";

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

const named = (spec: FieldSpec): { field: string; label?: string } =>
  (typeof spec === "string" ? { field: spec } : spec);

/** A plan as a template: the body first, as prose, then the named fields in
 *  the order the plan names them. A field the card does not carry is skipped
 *  rather than drawn empty, and the body is never repeated in `show`. */
export const planTemplate = (plan: FieldPlan): FieldTemplate => (card) => {
  const fields = card.fields ?? {};
  const rows: FieldRow[] = [];
  const body = plan.body ?? BODY_FIELD;
  const bodyValue = body === "" ? undefined : fields[body];
  if (bodyValue !== undefined && bodyValue !== "") {
    rows.push({ key: body, value: showValue(bodyValue), prose: true });
  }
  for (const spec of plan.show ?? []) {
    const { field, label } = named(spec);
    if (field === body && bodyValue !== undefined && bodyValue !== "") continue;
    const value = fields[field];
    if (value === undefined || value === "") continue;
    rows.push({ key: field, ...(label !== undefined ? { label } : {}), value: showValue(value) });
  }
  return rows;
};

/** The party-facing default, and the default of the hand itself: the story,
 *  and not one word written for anybody behind the scenes. */
export const readingTemplate: FieldTemplate = planTemplate({});

/** A template that shows nothing: for a face that is the title and the
 *  outcomes alone. */
export const noFields: FieldTemplate = () => [];

/** Only these fields, in this order, labelled as given, and no body. The
 *  shortest way for a venue composing the kit itself to say "show the prompt
 *  and the cue and nothing else".
 *
 *  ```ts
 *  const template = onlyFields({ prompt: undefined, cue: "Lighting" });
 *  ``` */
export const onlyFields = (wanted: Record<string, string | undefined>): FieldTemplate =>
  planTemplate({
    body: "",
    show: Object.entries(wanted).map(([field, label]) => (label === undefined ? field : { field, label })),
  });

/** Run a template, with the reading default when a venue supplied none.
 *  Exported so the hand and the crew's prompt list share one path through it. */
export const fieldRows = (card: DealtCardView, template?: FieldTemplate): FieldRow[] =>
  (template ?? readingTemplate)(card);
