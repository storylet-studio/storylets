// ---------------------------------------------------------------------------
// When two declarations of one property name describe the same property, and
// how to say so when they do not. One rule, read by the compiler (the `@hand`
// composition check) and by the project map migration's pre-flight, so the
// pre-flight can never pass what the compiler then refuses.
// ---------------------------------------------------------------------------

import type { PropertyMeta } from "@wildwinter/expr";
import type { PropertyDecl } from "@storylet-studio/model";

/** A declaration as expr's static validator sees it. */
export const propertyMeta = (decl: PropertyDecl): PropertyMeta => ({
  type: decl.type,
  ...(decl.values !== undefined ? { enumValues: decl.values } : {}),
  // A quality's ladder reaches expr's static validator this way, which is what
  // makes `>= "tpyo"` a compile error rather than a runtime surprise.
  ...(decl.stages !== undefined ? { stages: decl.stages } : {}),
});

/** Do two declarations of one name describe the same property? Enum values and
 *  a quality's stages are part of the answer: same type, different ladder is
 *  still a disagreement, and for a quality it is the WHOLE disagreement. */
export const sameMeta = (a: PropertyMeta, b: PropertyMeta): boolean =>
  a.type === b.type
  && JSON.stringify(a.enumValues ?? null) === JSON.stringify(b.enumValues ?? null)
  && JSON.stringify(a.stages ?? null) === JSON.stringify(b.stages ?? null);

/** {@link sameMeta} over two source declarations. */
export const sameDeclaration = (a: PropertyDecl, b: PropertyDecl): boolean =>
  sameMeta(propertyMeta(a), propertyMeta(b));

const listed = (what: string, items: readonly string[] | undefined): string =>
  items === undefined || items.length === 0 ? `no ${what}` : `${what} ${items.join(", ")}`;

/**
 * Two disagreeing declarations, each as a phrase naming what differs: the type
 * alone when the types differ ("number", "string"); otherwise the type with
 * the stages or values that part them ("quality with stages calm, eerie").
 * Both read after "as".
 */
export function describeDisagreement(a: PropertyMeta, b: PropertyMeta): [string, string] {
  if (a.type !== b.type) return [a.type, b.type];
  const say = (m: PropertyMeta): string => {
    const parts: string[] = [];
    if (JSON.stringify(a.stages ?? null) !== JSON.stringify(b.stages ?? null)) parts.push(listed("stages", m.stages));
    if (JSON.stringify(a.enumValues ?? null) !== JSON.stringify(b.enumValues ?? null)) parts.push(listed("values", m.enumValues));
    return parts.length === 0 ? m.type : `${m.type} with ${parts.join(" and ")}`;
  };
  return [say(a), say(b)];
}

/** {@link describeDisagreement} over two source declarations. */
export const describeDeclarations = (a: PropertyDecl, b: PropertyDecl): [string, string] =>
  describeDisagreement(propertyMeta(a), propertyMeta(b));
