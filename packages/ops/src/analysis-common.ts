// ---------------------------------------------------------------------------
// What the static analyses share: what a write is, how a scoped ref is keyed,
// and what a hand declares.
//
// Each of these was written out in each analysis (the CLI review of
// 2026-10-06, item 23): five readers of a change target and `set_flags`, two
// `keyOf`s with two different separators, and a hand's declarations three
// times, one of which disagreed with the runtime. One copy each, so coverage,
// influence, reachability, dead state and the usage scan cannot drift on what
// they are looking at. What each analysis then MAKES of a write stays with it:
// that is where they genuinely differ.
// ---------------------------------------------------------------------------

import type { AstNode, Expression, Outcome, PropertyDecl } from "@storylet-studio/model";

// --- writes ------------------------------------------------------------------

/** A `set_flags(...)` value, taken apart. */
export interface FlagsWrite {
  /** The first argument is the target itself: `@x = set_flags(@x, ...)`, the
   *  only shape that leaves the target's other flags alone. */
  onSelf: boolean;
  /** The flag deltas, in the order written. */
  deltas: { sign: "+" | "-"; flag: string }[];
  /** Some argument after the first is not a flag delta. */
  other: boolean;
}

/** One change an outcome makes. */
export interface ChangeWrite {
  /** The change target as written: "@story.gold". */
  target: string;
  /** The target's scope and name, split at the first dot, as written (a change
   *  target is an object key, so it never went through the parser's case
   *  fold). Scope is "" for a target with no dot. */
  scope: string;
  name: string;
  /** The value. */
  expr: Expression;
  /** Present when the value is a `set_flags(...)` call. */
  flags?: FlagsWrite;
}

/** The ref an AST node names, when it is a plain scoped reference. */
const svRef = (node: AstNode | undefined): string | undefined =>
  Array.isArray(node) && node[0] === "sv" ? `@${String(node[1])}.${String(node[2])}` : undefined;

/** Every change an outcome makes, in the order written. */
export function writesOf(outcome: Pick<Outcome<Expression>, "changes">): ChangeWrite[] {
  return Object.entries(outcome.changes).map(([target, expr]) => {
    const bare = target.startsWith("@") ? target.slice(1) : target;
    const dot = bare.indexOf(".");
    const ast = expr.ast;
    let flags: FlagsWrite | undefined;
    if (Array.isArray(ast) && ast[0] === "call" && ast[1] === "set_flags") {
      const deltas: FlagsWrite["deltas"] = [];
      let other = false;
      for (const arg of ast.slice(3)) {
        if (Array.isArray(arg) && arg[0] === "fd") deltas.push({ sign: arg[1] === "+" ? "+" : "-", flag: String(arg[2]) });
        else other = true;
      }
      flags = { onSelf: svRef(ast[2] as AstNode) === target, deltas, other };
    }
    return {
      target,
      scope: dot < 0 ? "" : bare.slice(0, dot),
      name: dot < 0 ? bare : bare.slice(dot + 1),
      expr,
      ...(flags !== undefined ? { flags } : {}),
    };
  });
}

/** One FLAG of a flags property, as its own key: `@story.world_events:traders_arrived`.
 *  A flags property is a bag of independent latches, so the analyses that ask
 *  "is this written?" ask it a flag at a time. The same spelling as
 *  @wildwinter/expr's latch keys, which reachability joins against. */
export const flagKey = (key: string, flag: string): string => `${key}:${flag}`;

// --- keys --------------------------------------------------------------------

/** Which deck or box a reference was seen in, by INTERNAL id. `@deck.x` in one
 *  deck and `@deck.x` in another are different properties at runtime, each
 *  deck having its own store, so the analyses keep them apart. Ids rather than
 *  gameIds because the id is what the stores are keyed by; a reader is shown
 *  the gameId. Empty for the scopes that are one thing project-wide. */
export interface Owner { box?: string; deck?: string }

/** Between an owner and its ref in a key. A control character no id or ref
 *  can contain. */
export const OWNER_SEP = "\u001f";

/** A map key for a ref: owner-qualified for the private scopes, bare for the
 *  shared ones. `splitKey` takes it apart again. */
export const keyOf = (ref: string, o: Owner): string =>
  ref.startsWith("@deck.") ? `${o.deck ?? ""}${OWNER_SEP}${ref}`
  : ref.startsWith("@box.") ? `${o.box ?? ""}${OWNER_SEP}${ref}`
  : ref;

/** A key's owner id (absent for a shared scope) and its bare ref, flag and all. */
export const splitKey = (key: string): { owner?: string; ref: string } => {
  const at = key.indexOf(OWNER_SEP);
  return at < 0 ? { ref: key } : { owner: key.slice(0, at), ref: key.slice(at + 1) };
};

// --- hands -------------------------------------------------------------------

/** A hand's declared @hand state, as the runtime's hand bags hold it
 *  (engine.ts `handDeclsOf`, schema 2.6): a template instance has its
 *  TEMPLATE's declarations and no others, even when the template declares
 *  none; a standalone hand declares its own. Reads a compiled box's
 *  `handTemplates` and a source box's `hands.templates` alike. */
export function handDeclarations(
  templates: readonly { id: string; properties?: PropertyDecl[] }[],
  hand: { template?: string; properties?: PropertyDecl[] },
): PropertyDecl[] {
  return hand.template !== undefined
    ? templates.find((t) => t.id === hand.template)?.properties ?? []
    : hand.properties ?? [];
}
