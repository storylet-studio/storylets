// ---------------------------------------------------------------------------
// How a hand is bound to a tag group, and whether that binding is this hand's
// to change.
//
// A hand reaches a tag group by one of three routes (schema 2.6), and they are
// not interchangeable:
//
//   - a HOLE its template declares (`chooses`), filled per instance in `chosen`
//   - a standalone hand's own inline `rule.bindings`
//   - a FIXED binding on the template, shared by every instance of it
//
// The first two belong to the hand and can be edited from anywhere that edits a
// hand. The third belongs to the TEMPLATE: changing it moves every hand made
// from that template at once, which is a legitimate edit on the template's own
// page and a very unwelcome side effect of dragging one pin across a map.
//
// This lives in `model` because both sides need it and neither may own it: main
// reads it to rebind a hand when its pin is dropped, and the map draws a pin by
// it (which zone it is coloured for, and whether dragging it can mean anything).
// Pure field access, no io.
// ---------------------------------------------------------------------------

import type { Hand, HandTemplate } from "./index.js";

/**
 * What a hand's relationship to one tag group is.
 *
 * `tag` is the tag id it is bound to, absent when the route exists but is not
 * filled in yet (a hole nobody has chosen for). `editable` says whether this
 * hand can be rebound on its own: the whole point of the distinction.
 */
export type HandBinding =
  /** A hole the hand's template declares and this hand fills. */
  | { kind: "chosen"; tag?: string; editable: true }
  /** A standalone hand's own binding. */
  | { kind: "rule"; tag?: string; editable: true }
  /** The template binds it for every instance: not this hand's to change. */
  | { kind: "fixed"; tag: string; editable: false }
  /** The hand has nothing to do with this group. */
  | { kind: "none"; editable: false };

/**
 * How `hand` is bound to `groupId`, given its template (undefined for a
 * standalone hand, or when the template has gone missing).
 *
 * Order matters: a standalone hand answers from its own rule, and a template
 * instance prefers the HOLE, because a template that both binds a group and
 * declares it as a hole is malformed and the hole is the one an instance can
 * actually fill.
 */
export function handBinding<E>(
  hand: Hand<E>, template: HandTemplate<E> | undefined, groupId: string,
): HandBinding {
  if (hand.rule !== undefined) {
    const tag = hand.rule.bindings?.[groupId];
    return tag === undefined ? { kind: "rule", editable: true } : { kind: "rule", tag, editable: true };
  }
  if (template?.chooses?.includes(groupId)) {
    const tag = hand.chosen?.[groupId];
    return tag === undefined ? { kind: "chosen", editable: true } : { kind: "chosen", tag, editable: true };
  }
  const fixed = template?.bindings?.[groupId];
  if (fixed !== undefined) return { kind: "fixed", tag: fixed, editable: false };
  return { kind: "none", editable: false };
}

/**
 * Take `hand` OFF its binding for `groupId`, IN PLACE, and say whether anything
 * changed.
 *
 * The hand is left LOOSE, which for a template instance with a hole is an error
 * the compiler already names ("missing chosen tag ... a hand is fully concrete").
 * That is the point of clearing rather than quietly keeping the old value: a hand
 * whose pin has ended up outside every zone genuinely has no zone, and an error
 * an author can see beats a link that is silently wrong.
 */
export function unbindHand<E>(
  hand: Hand<E>, template: HandTemplate<E> | undefined, groupId: string,
): boolean {
  const binding = handBinding(hand, template, groupId);
  if (!binding.editable || binding.tag === undefined) return false;
  if (binding.kind === "rule") {
    const bindings = { ...hand.rule!.bindings };
    delete bindings[groupId];
    hand.rule = { ...hand.rule!, ...(Object.keys(bindings).length > 0 ? { bindings } : {}) };
    if (Object.keys(bindings).length === 0) delete hand.rule.bindings;
    return true;
  }
  const chosen = { ...hand.chosen };
  delete chosen[groupId];
  if (Object.keys(chosen).length > 0) hand.chosen = chosen; else delete hand.chosen;
  return true;
}

/**
 * Bind `hand` to `tagId` for `groupId`, IN PLACE, and say whether anything
 * changed.
 *
 * Refuses anything the binding says is not this hand's to change, so a caller
 * cannot rebind one instance and silently move its siblings. The caller is
 * expected to have asked `handBinding` first and offered the gesture only where
 * it means something; this is the backstop rather than the manners.
 */
export function bindHand<E>(
  hand: Hand<E>, template: HandTemplate<E> | undefined, groupId: string, tagId: string,
): boolean {
  const binding = handBinding(hand, template, groupId);
  if (!binding.editable || binding.tag === tagId) return false;
  if (binding.kind === "rule") {
    hand.rule = { ...hand.rule!, bindings: { ...hand.rule!.bindings, [groupId]: tagId } };
    return true;
  }
  hand.chosen = { ...hand.chosen, [groupId]: tagId };
  return true;
}
