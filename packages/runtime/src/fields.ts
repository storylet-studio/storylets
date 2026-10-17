// ---------------------------------------------------------------------------
// Field read helpers: a box's card and outcome fields as a host reads them.
//
// The engine hands a card's fields (and an outcome's) to the host exactly as
// the bundle wrote them: sparse, a field the card leaves out simply absent.
// That is deliberate, because "the card sets nothing" and "the card sets the
// default" are different facts a host may care about. Most hosts want the
// filled-in picture, though, and the declared defaults ride in the bundle, so
// these pure helpers do that resolution once rather than in every game.
//
// Patter's gameData helpers (gameDataFields, gameDataValue, effectiveGameData)
// are the same idea, by the same rule (patterkit design/family-parity-2026-10.md
// item 7), and every Storylet Engine runtime carries these four.
// ---------------------------------------------------------------------------

import type { Bundle, FieldDecl, ScalarValue } from "@storylet-studio/model";

type BundleBoxes = Pick<Bundle, "boxes">;

const boxOf = (bundle: BundleBoxes, box: string) =>
  bundle.boxes.find((b) => b.gameId === box) ?? bundle.boxes.find((b) => b.id === box);

/** A box's card template, by its gameId (or id). Empty when the box declares
 *  none or is not in the bundle. */
export function fieldDecls(bundle: BundleBoxes, box: string): FieldDecl[] {
  return boxOf(bundle, box)?.fields ?? [];
}

/** A box's outcome fields, by its gameId (or id). Empty when it declares none. */
export function outcomeFieldDecls(bundle: BundleBoxes, box: string): FieldDecl[] {
  return boxOf(bundle, box)?.outcomeFields ?? [];
}

/** One field's effective value: the card's (or outcome's) own when it sets
 *  one, else the field's declared default; undefined for a name declared
 *  nowhere and set nowhere. */
export function fieldValue(
  decls: readonly FieldDecl[], values: Readonly<Record<string, ScalarValue>> | undefined, name: string,
): ScalarValue | undefined {
  if (values !== undefined && Object.prototype.hasOwnProperty.call(values, name)) return values[name];
  return decls.find((f) => f.name === name)?.default;
}

/** Every declared field resolved (the value set, else the default), plus any
 *  key set with no declaration, kept as it is. */
export function effectiveFields(
  decls: readonly FieldDecl[], values: Readonly<Record<string, ScalarValue>> | undefined,
): Record<string, ScalarValue> {
  const out: Record<string, ScalarValue> = {};
  for (const f of decls) {
    const v = fieldValue(decls, values, f.name);
    if (v !== undefined) out[f.name] = v;
  }
  for (const [k, v] of Object.entries(values ?? {})) if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = v;
  return out;
}
