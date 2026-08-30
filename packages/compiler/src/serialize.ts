// ---------------------------------------------------------------------------
// (De)serialisation per design/storylets-source.md section 8.
//
// Read: JSON5 (comments, trailing commas, unquoted keys), BOM tolerated on
// the way in, never emitted. Write: the canonical form - a CONTRACT,
// versioned with the shard schema tags, because merges, the hosted shard
// store and import/export all depend on byte-stable output:
//
//   1. sorted keys, with one exception: `schema` first, then the shard's
//      identity object (`project` / `box` / `deck`), so a human and a merge
//      tool orient immediately;
//   2. one field per line, fully expanded, except the empty forms {} / [];
//   3. trailing commas on every last element (JSON5; the F1 lesson - an
//      append touches only its own line);
//   4. two-space indent; double-quoted strings; keys quoted only when not
//      identifier-safe;
//   5. UTF-8, no BOM, LF, final newline;
//   6. the collections that carry a display `order` field (`cards`, `hands`)
//      are stored sorted by immutable id, so two people adding one each land
//      at different places in the file. A collection that arrives unsorted
//      and with no `order` on any item (hand-authored, or from before this
//      rule) gets `order` stamped from its file position first, so what the
//      author had is what the editor keeps showing. Outcomes, templates, tag
//      groups and tags have no `order` field yet and keep authored order.
//
// The compiled bundle is the exception: it must stay STRICT JSON (runtime
// ports use stock JSON parsers), so `serialiseBundle` emits no trailing
// commas and quotes every key.
// ---------------------------------------------------------------------------

import JSON5 from "json5";

/** Parse JSON5 source text (a leading BOM is tolerated). Throws on malformed input. */
export function parseSource(text: string): unknown {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON5.parse(body);
}

/** The shard identity keys hoisted to the top, after `schema` (rule 1). */
const IDENTITY_KEYS = ["project", "box", "deck"];

const IDENTIFIER_SAFE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export interface StringifyOptions {
  /** Emit JSON5 source form (trailing commas, unquoted identifier keys).
   *  Defaults to true; the bundle passes false to stay strict JSON. */
  json5?: boolean;
  /** Run the id-sorting pass. Defaults to true; the BUNDLE passes false.
   *  Rule 5 is a property of source files, where it keeps two authors adding
   *  an item each from colliding. A bundle has no merge story, and its
   *  `outcomes` arrays deliberately carry DISPLAY order (the player's menu),
   *  so id-sorting them here would undo what the compiler just did. */
  idSortCollections?: boolean;
}

/** Serialise a value to the canonical form. `topLevel` key hoisting applies
 *  to the outermost object only. */
export function canonicalStringify(value: unknown, opts?: StringifyOptions): string {
  const json5 = opts?.json5 ?? true;
  const prepared = (opts?.idSortCollections ?? true) ? canonicalCollections(value) : value;
  return write(prepared, "", json5, true) + "\n";
}

/** The collections rule 5 stores id-sorted: each names a list whose items
 *  carry a display `order`, so sorting the file loses nothing.
 *
 *  Source keys only. `outcomes` and `tags` also name lists in the compiled
 *  bundle, which is exactly why `serialiseBundle` turns this pass off rather
 *  than relying on it being a no-op there. */
const ID_SORTED_KEYS = new Set(["cards", "hands", "outcomes", "templates", "groups", "tags"]);

type IdItem = { id: string; order?: unknown };
const isIdList = (v: unknown): v is IdItem[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "object" && x !== null && typeof (x as IdItem).id === "string");
const isIdSorted = (items: IdItem[]): boolean => items.every((x, i) => i === 0 || items[i - 1]!.id <= x.id);

/** Return `value` with every id-sorted collection sorted, at any depth.
 *
 *  Before sorting, any item MISSING an `order` is stamped with its position in
 *  the incoming array, so the order the author was looking at survives the
 *  sort. Stamping the missing ones rather than only whole lists is what makes
 *  every create and duplicate path correct for free: a new item is appended,
 *  the array is therefore unsorted, and it is stamped last before its random
 *  id scatters it. Idempotent, because a second pass finds nothing missing.
 *
 *  A list already in id order is left alone entirely: array position and id
 *  position agree there, so the display fallback already gives the right
 *  answer and stamping would only add noise to the file. Never mutates the
 *  input. */
export function canonicalCollections<T>(value: T): T {
  if (Array.isArray(value)) return value.map((x) => canonicalCollections(x)) as unknown as T;
  if (typeof value !== "object" || value === null) return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (ID_SORTED_KEYS.has(k) && isIdList(v) && !isIdSorted(v)) {
      const stamped = v.map((x, i) => (x.order === undefined ? { ...x, order: i } : x));
      out[k] = [...stamped].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((x) => canonicalCollections(x));
    } else {
      out[k] = canonicalCollections(v);
    }
  }
  return out as T;
}

/** The compiled bundle's canonical bytes: strict JSON, sorted keys, LF. */
export function serialiseBundle(bundle: unknown): string {
  return canonicalStringify(bundle, { json5: false, idSortCollections: false });
}

function orderKeys(obj: Record<string, unknown>, topLevel: boolean): string[] {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  if (!topLevel) return keys;
  const hoisted = ["schema", ...IDENTITY_KEYS].filter((k) => keys.includes(k));
  return [...hoisted, ...keys.filter((k) => !hoisted.includes(k))];
}

function writeKey(key: string, json5: boolean): string {
  return json5 && IDENTIFIER_SAFE.test(key) ? key : JSON.stringify(key);
}

function write(v: unknown, indent: string, json5: boolean, topLevel: boolean): string {
  if (v === null || typeof v === "boolean" || typeof v === "number" || typeof v === "string") {
    return JSON.stringify(v);
  }
  const tail = json5 ? "," : "";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const next = indent + "  ";
    const items = v.map((x) => next + write(x, next, json5, false));
    return `[\n${items.join(",\n")}${tail}\n${indent}]`;
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = orderKeys(obj, topLevel);
    if (keys.length === 0) return "{}";
    const next = indent + "  ";
    const entries = keys.map((k) => `${next}${writeKey(k, json5)}: ${write(obj[k], next, json5, false)}`);
    return `{\n${entries.join(",\n")}${tail}\n${indent}}`;
  }
  // undefined / function / symbol are not representable; drop to null defensively.
  return "null";
}
