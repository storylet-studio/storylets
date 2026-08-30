// ---------------------------------------------------------------------------
// The hoist nudge (design/hand-typing.md step 8). A property declared
// identically on every tag in a group is the group form written the long way:
// the schema half is being restated per tag purely to say the value half.
// `hoistableProperties` finds those names; `hoistProperty` moves one up,
// keeping the commonest default on the group and recording the outliers as
// per-tag starting values, so the compiled bundle is unchanged by the hoist.
// Pure over the TagGroupEdit, so the nudge is testable without a DOM.
// ---------------------------------------------------------------------------

import type { PropertyDeclDto, TagGroupEdit } from "../../shared/api.js";

type Edit = Required<Pick<TagGroupEdit, "properties" | "values">>;

/** The same property, ignoring its default: type, enum values and a quality's
 *  whole ladder must agree (a ladder in a different order is a different
 *  property, not a variant of one). */
const sameShape = (a: PropertyDeclDto, b: PropertyDeclDto): boolean =>
  a.type === b.type
  && JSON.stringify(a.values ?? null) === JSON.stringify(b.values ?? null)
  && JSON.stringify(a.stages ?? null) === JSON.stringify(b.stages ?? null);

/** Names declared on EVERY tag with one shape, and not already on the group. */
export function hoistableProperties(edit: Edit): string[] {
  if (edit.values.length === 0) return [];
  const taken = new Set(edit.properties.map((p) => p.name));
  const first = edit.values[0]!.properties;
  return first
    .filter((decl) => !taken.has(decl.name))
    .filter((decl) => edit.values.every((v) => {
      const own = v.properties.find((p) => p.name === decl.name);
      return own !== undefined && sameShape(own, decl);
    }))
    .map((decl) => decl.name);
}

/** Move one hoistable name up to the group. The group takes the COMMONEST
 *  default (fewest per-tag overrides); a tag whose default differed keeps its
 *  start as a value, so behaviour is identical before and after. */
export function hoistProperty(edit: Edit, name: string): void {
  if (!hoistableProperties(edit).includes(name)) return;
  const decls = edit.values.map((v) => v.properties.find((p) => p.name === name)!);
  const counts = new Map<string, number>();
  for (const d of decls) counts.set(d.default, (counts.get(d.default) ?? 0) + 1);
  const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  edit.properties.push({ ...decls[0]!, default: commonest });
  for (const v of edit.values) {
    const own = v.properties.find((p) => p.name === name)!;
    v.properties = v.properties.filter((p) => p.name !== name);
    if (own.default !== commonest) {
      v.values = { ...(v.values ?? {}), [name]: own.default };
    }
  }
}
