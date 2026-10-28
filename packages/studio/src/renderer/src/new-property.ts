// ---------------------------------------------------------------------------
// A new `@story` property made from an outcome's Changes (expr-editor 0.18.0,
// the hands-on review of 2026-10): typing a name nothing has offers "+ New
// property", and choosing it asks one thing, what kind of value the property
// holds. Patterpad's prompt (app parity, ruled 2026-10-28), naming the Story
// page where Patterpad names its Properties page, since a @story property is
// declared there. The three plain kinds are offered; a list, a set of flags or
// a quality needs its values written out, which is the Story page's job, so
// they aren't. Number is the default (a new row on a properties list starts as
// one, and "set gold to gold + 1" is the common case).
//
// The declaration goes through the problems bar's Declare (main, version
// control, one undoable step), with the type chosen and no default: the
// type's own holds (0, "", false), as a declaration with none always does.
// ---------------------------------------------------------------------------

import { dialogFrame } from "@wildwinter/app-shell/dialog";
import { el } from "@wildwinter/app-shell";
import type { ConditionProperty, OpenResult } from "../../shared/api.js";
import type { PropertyCreator } from "./expr-panels.js";
import { sentence } from "./results.js";

/** The kinds a new property can be made as, here. */
export type NewPropertyType = "number" | "string" | "boolean";

/** The kinds the choice offers, in the order the buttons read (the default last, where the accent sits). */
export const NEW_PROPERTY_TYPES: ReadonlyArray<{ type: NewPropertyType; label: string }> = [
  { type: "string", label: "Text" },
  { type: "boolean", label: "True or false" },
  { type: "number", label: "Number" },
];

/** Ask what kind of value `@name` holds. Resolves the type, or null when the author backs out. */
export function askPropertyType(name: string): Promise<NewPropertyType | null> {
  return new Promise((resolve) => {
    let answer: NewPropertyType | null = null;
    const frame = dialogFrame({
      title: "New property",
      sub: `What kind of value does @${name} hold? You can change it on the Story page.`,
      className: "confirm-dialog new-prop-dialog",
      onClose: () => resolve(answer),
    });
    const cancel = el("button", "btn confirm-btn", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => frame.close());
    frame.actions.append(cancel);
    let primary: HTMLButtonElement | null = null;
    for (const t of NEW_PROPERTY_TYPES) {
      const b = el("button", t.type === "number" ? "btn primary confirm-btn" : "btn confirm-btn", t.label);
      b.type = "button";
      b.dataset["type"] = t.type;
      b.addEventListener("click", () => { answer = t.type; frame.close(); });
      frame.actions.append(b);
      if (t.type === "number") primary = b;
    }
    frame.open();
    primary?.focus();
  });
}

/** What the creator needs from the renderer: the write, and what to do with its answer. */
export interface NewPropertyHost {
  /** The problems bar's Declare (`studio.declareProperty`), with the type chosen. */
  declare(scope: string, name: string, guess: { type: NewPropertyType }): Promise<OpenResult | { error: string }>;
  /** Main reread the project (a drifted file): fetch it again. */
  reread(): void;
  /** The fresh project, taken in like any other edit's. */
  apply(result: OpenResult): void;
  /** The new property, into the catalogues in hand (`catalogues.adopt`). */
  adopt(entry: ConditionProperty): void;
  /** The question; Patterpad's dialog unless a test stands in. */
  ask?: (name: string) => Promise<NewPropertyType | null>;
}

/**
 * The Changes picker's creator: ask the type, declare the property with it, and
 * answer the catalogue entry. Null when the author backs out of the question:
 * nothing is written, and the picker stays as it was. A refusal ("already
 * declared", a drifted file) is thrown, and the picker says it under the row.
 */
export function newPropertyCreator(host: NewPropertyHost): PropertyCreator {
  return async (name, scope) => {
    const type = await (host.ask ?? askPropertyType)(name);
    if (type === null) return null;
    const result = await host.declare(scope, name, { type });
    if ((result as { reread?: true }).reread === true) host.reread();
    if ("error" in result) throw new Error(sentence(result.error));
    host.apply(result);
    const entry: ConditionProperty = { scope, name, type };
    host.adopt(entry);
    return entry;
  };
}
