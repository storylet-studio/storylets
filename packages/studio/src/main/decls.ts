// ---------------------------------------------------------------------------
// Property declarations across the bridge: a shard's `PropertyDecl` as the
// editor's row, and the row back. ONE converter each way, for every list that
// declares properties (@world, @story, box, deck, card and outcome fields, tag
// groups and tags, hands and templates). There were three the first way, and
// they had drifted: two dropped `writable`, and two sent an absent default as
// `undefined` rather than "".
// ---------------------------------------------------------------------------

import { parseSource } from "@storylet-studio/compiler";
import type { PropertyDecl, ScalarValue } from "@storylet-studio/model";
import type { PropertyDeclDto } from "../shared/api.js";

/** A shard value as the text a field edits: a string as it is, anything else
 *  as JSON. */
export const asText = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

// `shared` and `durable` ride along even where no list draws a switch for them
// (design/flows.md and engine-server.md 4.2): a declaration list saves whole, so
// a flag the DTO drops is a flag the next save deletes from the shard.
export const declDto = (d: PropertyDecl): PropertyDeclDto => ({
  name: d.name, type: d.type,
  default: d.default === undefined ? "" : asText(d.default),
  ...(d.values !== undefined ? { values: d.values } : {}),
  ...(d.stages !== undefined ? { stages: d.stages } : {}),
  ...(d.writable !== undefined ? { writable: d.writable } : {}),
  ...(d.shared !== undefined ? { shared: d.shared } : {}),
  ...(d.durable !== undefined ? { durable: d.durable } : {}),
  ...(d.purpose !== undefined ? { purpose: d.purpose } : {}),
});

/** A default typed into a row, read as the declaration's type. */
export const coerceDefault = (raw: string, type: string): ScalarValue => {
  const t = raw.trim();
  if (type === "boolean") return t === "true";
  if (type === "number") return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : 0;
  if (type === "flags") { try { const v = parseSource(t); return Array.isArray(v) ? (v as string[]) : []; } catch { return []; } }
  return t;   // string / enum
};

export const declFromDto = (d: PropertyDeclDto): PropertyDecl => ({
  name: d.name, type: d.type as PropertyDecl["type"],
  // A quality with no explicit default starts at its first stage; the compile
  // gate still checks the result is ON the ladder either way.
  default: d.type === "quality" && d.default.trim() === "" ? (d.stages?.[0] ?? "") : coerceDefault(d.default, d.type),
  ...(d.values !== undefined ? { values: d.values } : {}),
  ...(d.stages !== undefined ? { stages: d.stages } : {}),
  ...(d.writable !== undefined ? { writable: d.writable } : {}),
  // The two axes (design/flows.md, engine-server.md 4.2). Carried whether or
  // not the project's rung draws a switch for them: a list saves whole, so a
  // flag that does not survive the round trip is a flag the next save deletes.
  ...(d.shared !== undefined ? { shared: d.shared } : {}),
  ...(d.durable !== undefined ? { durable: d.durable } : {}),
  // Blank means no purpose: an emptied field deletes rather than storing "".
  ...(d.purpose !== undefined && d.purpose.trim() !== "" ? { purpose: d.purpose.trim() } : {}),
});

/** The rows a page saves, minus any left with no name. */
export const declsFromDtos = (rows: PropertyDeclDto[]): PropertyDecl[] =>
  rows.filter((d) => d.name.trim()).map(declFromDto);
