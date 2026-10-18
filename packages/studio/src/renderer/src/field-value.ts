// ---------------------------------------------------------------------------
// A card or outcome field's value between the editor's text and the shell's
// field row. The DTO carries a value as the text main reads it back from
// (`coerceField`, JSON5 where it parses, else the raw string; "" is no value);
// the shell's row works in typed values. These two are the one conversion.
// ---------------------------------------------------------------------------

import type { FieldValue } from "@wildwinter/app-shell/value-control";

/** Text that main's JSON5 read would turn into something other than itself (a number, a boolean, a list, a
 *  quoted string's contents). A string value that looks like this goes over quoted. */
const READS_AS_OTHER = /^\s*(?:true|false|null|Infinity|NaN|[-+.\d]|["'[{])/;

/** The DTO's text as the row's typed value for a field of `type`; undefined when it sets none. */
export function fieldValueFromText(type: string, text: string): unknown {
  if (text === "") return undefined;
  if (type === "boolean") return text === "true" ? true : text === "false" ? false : text;
  if (type === "number") { const n = Number(text.trim()); return text.trim() !== "" && Number.isFinite(n) ? n : text; }
  if (type === "flags") {
    try {
      const v: unknown = JSON.parse(text);
      if (Array.isArray(v)) return v.map(String);
    } catch {
      // An older value typed as "a, b" into the comma field: read it as the names it meant.
    }
    return text.split(",").map((s) => s.trim()).filter((s) => s !== "");
  }
  return text;
}

/** The row's typed value back as the DTO's text: "" for none, a list as JSON, a string quoted where main
 *  would otherwise read it as something else ("true" in a text field stays text). */
export function fieldValueToText(value: FieldValue | undefined): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "string") return READS_AS_OTHER.test(value) ? JSON.stringify(value) : value;
  return String(value);
}
