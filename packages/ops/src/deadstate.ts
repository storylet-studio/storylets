// ---------------------------------------------------------------------------
// Dead state: properties and flags with only half a life.
//
// A latch is a write and a read, usually in different files, often written by
// one person and read by another. When half goes missing nothing fails: an
// unread write is silent, and an unwritten read makes its cards quietly
// unavailable, which looks exactly like content that does not exist. The
// ported Village carries the proof: one dangling read (@deck.well_vision)
// killed five cards and ten outcomes across four decks, and only a coverage
// sweep could see the bodies, not the cause.
//
// Static, so it runs in every validate: the editor's problems bar shows it as
// you type, long before a coverage run. Warnings, never errors: a half-wired
// flag is normal mid-authoring, and the point is a nudge, not a gate.
//
// @world is deliberately out of scope. The HOST writes it, so a read with no
// write in the content is the normal case, and coverage's honesty net already
// owns that story.
//
// Scoped state is tracked PER OWNER. @deck.progress in one deck and
// @deck.progress in another are different properties at runtime, each deck
// having its own store, so they are counted apart and the warning names the
// deck it means. Keying by bare name instead let one deck's read vouch for
// another deck's write, which is how the Village hid a dead write for a week.
// ---------------------------------------------------------------------------

import { compileProject } from "@storylet-studio/compiler";
import type { Issue, SourceProject } from "@storylet-studio/compiler";
import type { Bundle, Expression } from "@storylet-studio/model";
import { effectiveGameId } from "@storylet-studio/model";

type AstNode = Expression["ast"];

interface Half {
  /** Where it happens, for the message: "card x condition", "outcome x/y". */
  wheres: string[];
  /** The first occurrence's address, for the CLICK: the shard that carries it
   *  and the card's gameId. Without this every issue wore the project shard's
   *  path, and clicking a warning opened project settings. */
  at?: { path: string; where?: string };
}
interface Life {
  reads: Half; writes: Half;
  flagsChecked: Map<string, Half>; flagsSet: Map<string, Half>;
}

/** Which deck or box a reference was seen in, for the scopes that are private
 *  to one. Empty for @world / @story, which are one thing project-wide. */
interface Owner { box?: string; deck?: string }

const SEP = "\u0000";
/** Map key: owner-qualified for the private scopes, bare for the shared ones.
 *  `displayOf` splits it back into the ref and who owns it. */
const keyOf = (ref: string, o: Owner): string =>
  ref.startsWith("@deck.") ? `${o.deck ?? ""}${SEP}${ref}`
  : ref.startsWith("@box.") ? `${o.box ?? ""}${SEP}${ref}`
  : ref;
const displayOf = (key: string): string => {
  const i = key.indexOf(SEP);
  if (i < 0) return key;
  const owner = key.slice(0, i), ref = key.slice(i + 1);
  return owner ? `${ref} in ${owner}` : ref;
};
/** The bare ref, for the tests that ask what SCOPE a key is in. */
const refOf = (key: string): string => key.slice(key.indexOf(SEP) + 1);

const life = (m: Map<string, Life>, ref: string): Life => {
  let l = m.get(ref);
  if (!l) { l = { reads: { wheres: [] }, writes: { wheres: [] }, flagsChecked: new Map(), flagsSet: new Map() }; m.set(ref, l); }
  return l;
};
const half = (m: Map<string, Half>, name: string): Half => {
  let h = m.get(name);
  if (!h) { h = { wheres: [] }; m.set(name, h); }
  return h;
};

/** Walk one AST, recording reads and flag checks/deltas against `ref` when the
 *  node is a flag call (whose first arg names the property). */
function scan(ast: AstNode, where: string, m: Map<string, Life>, owner: Owner, at?: { path: string; where?: string }): void {
  if (!Array.isArray(ast)) return;
  const [tag] = ast;
  const mark = (h: Half): void => { h.wheres.push(where); h.at ??= at; };
  if (tag === "sv") {
    mark(life(m, keyOf(`@${ast[1]}.${ast[2]}`, owner)).reads);
    return;
  }
  if (tag === "call" && (ast[1] === "check_flags" || ast[1] === "set_flags" || ast[1] === "clear_flags")) {
    const target = ast[2];
    const ref = Array.isArray(target) && target[0] === "sv" ? `@${target[1]}.${target[2]}` : undefined;
    if (ref !== undefined) {
      const l = life(m, keyOf(ref, owner));
      // check_flags READS; set/clear also read (they take the current set).
      mark(l.reads);
      for (const arg of ast.slice(3)) {
        if (Array.isArray(arg) && arg[0] === "fd") {
          const name = String(arg[2]);
          if (ast[1] === "check_flags") mark(half(l.flagsChecked, name));
          // set_flags +x sets; clear_flags -x clears, which only matters if
          // something set it, so only additions count as "set".
          else if (arg[1] === "+") mark(half(l.flagsSet, name));
        }
      }
    }
    for (const arg of ast.slice(2)) scan(arg as AstNode, where, m, owner, at);
    return;
  }
  for (const part of (ast as unknown[]).slice(1)) scan(part as AstNode, where, m, owner, at);
}

/** Dead-state warnings for one project. Compiles internally (cheap beside the
 *  compile validate already runs, and the ASTs are what make flag names
 *  reliable rather than regex guesses). */
export function deadStateIssues(source: SourceProject, compiled?: Bundle): Issue[] {
  const bundle = compiled ?? compileProject(source).bundle;
  if (!bundle) return [];   // does not compile: the real errors are already told

  // Which refs are qualities, so their warnings can speak the ladder's
  // language: a read-only quality is not just unread state, it is a story
  // that never moves past its first stage.
  const qualityRefs = new Set<string>();
  const declsOf = (scope: string, decls: { name: string; type: string }[] | undefined, owner: Owner): void => {
    for (const d of decls ?? []) if (d.type === "quality") qualityRefs.add(keyOf(`@${scope}.${d.name}`, owner));
  };
  declsOf("world", bundle.world.properties, {});
  declsOf("story", bundle.story.properties, {});
  for (const box of bundle.boxes) {
    const boxName = effectiveGameId(box);
    declsOf("box", box.properties, { box: boxName });
    for (const deck of box.decks) declsOf("deck", deck.properties, { box: boxName, deck: effectiveGameId(deck) });
  }

  // Deck id -> the shard that carries it, for a warning's clickable address.
  const deckShardPaths = new Map<string, string>();
  for (const sb of source.boxes) for (const d of sb.decks) deckShardPaths.set(d.shard.deck.id, d.path);

  const m = new Map<string, Life>();
  for (const box of bundle.boxes) {
    const at = { box: effectiveGameId(box) };
    for (const template of box.handTemplates) {
      if (template.condition) scan(template.condition.ast, `hand template ${effectiveGameId(template)}`, m, at);
    }
    for (const hand of box.hands) {
      if (hand.rule?.condition) scan(hand.rule.condition.ast, `hand ${effectiveGameId(hand)}`, m, at);
    }
    for (const group of box.tagGroups) {
      if (group.boundBy !== undefined) life(m, keyOf(group.boundBy, at)).reads.wheres.push(`tag group ${effectiveGameId(group)}`);
    }
    for (const deck of box.decks) {
      const inDeck = { ...at, deck: effectiveGameId(deck) };
      const deckPath = deckShardPaths.get(deck.id);
      const site = (cardGameId?: string): { path: string; where?: string } | undefined =>
        deckPath === undefined ? undefined : { path: deckPath, ...(cardGameId !== undefined ? { where: cardGameId } : {}) };
      if (deck.condition) scan(deck.condition.ast, `deck ${effectiveGameId(deck)}`, m, inDeck, site());
      for (const card of deck.cards) {
        const cardSite = site(effectiveGameId(card));
        if (card.condition) scan(card.condition.ast, `card ${effectiveGameId(card)}`, m, inDeck, cardSite);
        if (typeof card.priority === "object") scan(card.priority.ast, `card ${effectiveGameId(card)} priority`, m, inDeck, cardSite);
        for (const outcome of card.outcomes) {
          const where = `${effectiveGameId(card)}/${effectiveGameId(outcome)}`;
          if (outcome.condition) scan(outcome.condition.ast, `outcome ${where}`, m, inDeck, cardSite);
          for (const [target, change] of Object.entries(outcome.changes)) {
            const l = life(m, keyOf(target, inDeck));
            l.writes.wheres.push(`outcome ${where}`);
            l.writes.at ??= cardSite;
            scan(change.ast, `outcome ${where}`, m, inDeck, cardSite);
          }
        }
      }
    }
  }

  const issues: Issue[] = [];
  const one = (wheres: string[]): string => wheres[0] ?? "";
  for (const [key, l] of [...m].sort(([a], [b]) => a.localeCompare(b))) {
    const scoped = refOf(key), ref = displayOf(key);
    if (scoped.startsWith("@world.") || scoped.startsWith("@hand.")) continue;   // host-owned / composed

    // The READ side warns everywhere content can be gated: an unwritten read
    // shuts its gates forever, and nothing but an outcome can open them.
    if (l.reads.wheres.length > 0 && l.writes.wheres.length === 0 && l.flagsSet.size === 0) {
      issues.push({ severity: "warning", path: l.reads.at?.path ?? source.path,
        ...(l.reads.at?.where !== undefined ? { where: l.reads.at.where } : {}),
        message: qualityRefs.has(key)
          ? `${ref} is gated on (${one(l.reads.wheres)}) but never moves - nothing advances or sets it, so it stays at its first stage forever`
          : `${ref} is read (${one(l.reads.wheres)}) but nothing writes it, so every gate on it stays shut` });
    }
    for (const [flag, h] of [...l.flagsChecked].sort(([a], [b]) => a.localeCompare(b))) {
      if (!l.flagsSet.has(flag)) {
        issues.push({ severity: "warning", path: h.at?.path ?? source.path,
          ...(h.at?.where !== undefined ? { where: h.at.where } : {}),
          message: `${ref} +${flag} is checked (${one(h.wheres)}) but nothing sets it` });
      }
    }

    // The WRITE side warns only for @deck, and only when the project asked
    // (validation.warnUnreadWrites, off by default): content is routinely
    // written ahead of the cards that will read it, so mid-development this
    // is mostly noise. A host legitimately reads @story and @box (a
    // reputation display, a save summary), so "written but never read"
    // cannot tell content from interface there - the Hamlet's own
    // relationship endings (+angry, +grateful) are exactly that. @deck is
    // the story's private progress scope, where an unread write really is a
    // loose end, once the author says they are done writing ahead.
    if (source.project.validation?.warnUnreadWrites !== true) continue;
    if (!scoped.startsWith("@deck.")) continue;
    if (l.writes.wheres.length > 0 && l.reads.wheres.length === 0) {
      issues.push({ severity: "warning", path: l.writes.at?.path ?? source.path,
        ...(l.writes.at?.where !== undefined ? { where: l.writes.at.where } : {}),
        message: `${ref} is written (${one(l.writes.wheres)}) but nothing reads it` });
    }
    for (const [flag, h] of [...l.flagsSet].sort(([a], [b]) => a.localeCompare(b))) {
      if (!l.flagsChecked.has(flag)) {
        issues.push({ severity: "warning", path: h.at?.path ?? source.path,
          ...(h.at?.where !== undefined ? { where: h.at.where } : {}),
          message: `${ref} +${flag} is set (${one(h.wheres)}) but nothing checks it` });
      }
    }
  }
  return issues;
}
