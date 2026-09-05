// ---------------------------------------------------------------------------
// The installation contract's checks (design/engine-server.md 4.11, net 1).
//
// A venue is provisioned against NAMES: the hands its stations deal, the boxes
// its scheduler ticks, the properties its clocks drive, the fields its crew and
// its bridges read. The server writes those names into a contract shard, one per
// installation, and this is what turns a rename into a refusal at the earliest
// and cheapest gate rather than a dark kiosk on the night.
//
// ERRORS, never warnings, which is the whole difference from the spatial checks
// next door: a broken outline draws oddly, a broken contract stops a venue. The
// existing rename WARNING for hands and tags (Reboot 4: an API break beyond the
// project's borders) becomes an error under a contract, because the border is
// now a known thing with a name.
//
// Here rather than in the compiler because a contract NEVER COMPILES. It is
// project-side config like `coverage` and `export`: the server does not need its
// own contract handed back, it needs the bundle to still honour it. That is the
// same arrangement `spatialIssues` sits in, and for the same reason - core
// validates what it compiles, and it compiles none of this.
// ---------------------------------------------------------------------------

import {
  contractPropertyPath, contractPropertyType, effectiveGameId,
} from "@storylet-studio/model";
import type { ContractShard, PropertyDecl, PropertyType } from "@storylet-studio/model";
import type { Issue, SourceBox, SourceProject } from "@storylet-studio/compiler";

/** A hand's declarations: a template instance inherits its template's, a
 *  standalone hand declares its own (the rule the runtime's hand bags use). */
function handDecls(box: SourceBox, hand: SourceBox["hands"]["hands"][number]): PropertyDecl[] {
  if (hand.template !== undefined) {
    return box.hands.templates.find((t) => t.id === hand.template)?.properties ?? [];
  }
  return hand.properties ?? [];
}

/**
 * Every declaration in the project, addressed the way `listProperties()` prints
 * it with the `@` dropped: "world.time_wall", "story.visits",
 * "box.street.mood", "value.docks.danger".
 *
 * The owner segment is accepted as EITHER the gameId or the internal id. The
 * contract is written by gameId, like everything that crosses the project's
 * border; the running engine addresses its bags by internal id. A contract that
 * matched only one of the two would be right about a name and wrong about the
 * only place the name is ever read.
 */
function declarations(source: SourceProject): Map<string, { decl: PropertyDecl; path: string; where: string }> {
  const out = new Map<string, { decl: PropertyDecl; path: string; where: string }>();
  const add = (scope: string, owners: string[], decls: PropertyDecl[] | undefined, path: string, where: string): void => {
    for (const decl of decls ?? []) {
      for (const owner of owners) {
        const address = owner === "" ? `${scope}.${decl.name}` : `${scope}.${owner}.${decl.name}`;
        if (!out.has(address)) out.set(address, { decl, path, where });
      }
    }
  };
  const both = (entity: { id: string; gameId?: string; title?: string }): string[] => {
    const gameId = effectiveGameId(entity);
    return gameId === entity.id ? [gameId] : [gameId, entity.id];
  };

  add("world", [""], source.project.world?.properties, source.path, "world");
  add("story", [""], source.project.story?.properties, source.path, "story");
  for (const box of source.boxes) {
    add("box", both(box.box.box), box.box.box.properties, `${box.path}/box`, effectiveGameId(box.box.box));
    for (const deck of box.decks) {
      add("deck", both(deck.shard.deck), deck.shard.deck.properties, deck.path, effectiveGameId(deck.shard.deck));
    }
    for (const hand of box.hands.hands) {
      add("hand", both(hand), handDecls(box, hand), `${box.path}/hands`, effectiveGameId(hand));
    }
    for (const group of box.tags.groups) {
      for (const tag of group.tags) {
        const where = `${effectiveGameId(group)}.${effectiveGameId(tag)}`;
        add("value", both(tag), tag.properties, `${box.path}/tags`, where);
        // A group declares what every one of its tags has; the compiler
        // flattens those onto each tag, so they are addressable here too.
        add("value", both(tag), group.properties, `${box.path}/tags`, where);
      }
    }
  }
  return out;
}

/**
 * The venues' errors: what an author has changed that a venue depends on.
 *
 * Each one names the dependency and the installation, because "you may not
 * rename this" without saying who cares is the kind of refusal that gets worked
 * around. Anchored to the shard that would FIX it wherever the entity is still
 * there to be fixed (the box shard for a box, the declaring shard for a
 * property); a name that has gone entirely no longer has a shard to point at,
 * so those anchor to the contract, which is the other end of the same break.
 */
export function contractIssues(source: SourceProject): Issue[] {
  const issues: Issue[] = [];
  if (source.contracts.length === 0) return issues;

  const hands = new Set<string>();
  const boxes = new Map<string, { turn?: number; path: string; gameId: string }>();
  const fields = new Set<string>();
  for (const box of source.boxes) {
    for (const hand of box.hands.hands) hands.add(effectiveGameId(hand));
    boxes.set(effectiveGameId(box.box.box), {
      ...(box.box.box.turn !== undefined ? { turn: box.box.box.turn.seconds } : {}),
      path: `${box.path}/box`,
      gameId: effectiveGameId(box.box.box),
    });
    for (const field of box.box.box.fields ?? []) fields.add(field.name);
  }
  const decls = declarations(source);

  // One installation, one contract. Two files claiming the same venue is not a
  // merge to reconcile: the second one is a copy somebody kept, and the tools
  // would have to guess which set of names the venue actually runs on.
  const claimed = new Map<string, string>();

  for (const contract of source.contracts) {
    const shard: ContractShard = contract.shard;
    const at = shard.installation;
    const prior = claimed.get(at);
    if (prior !== undefined) {
      issues.push({
        severity: "error", path: contract.path, where: at,
        message: `installation "${at}" already has a contract (${prior}); one installation, one contract`,
      });
      continue;
    }
    claimed.set(at, contract.path);

    for (const hand of shard.hands ?? []) {
      if (hands.has(hand)) continue;
      issues.push({
        severity: "error", path: contract.path, where: hand, field: "hands",
        message: `hand "${hand}" is bound by a station at ${at}; it may not be renamed or removed`,
      });
    }

    for (const [gameId, want] of Object.entries(shard.boxes ?? {})) {
      const box = boxes.get(gameId);
      if (box === undefined) {
        issues.push({
          severity: "error", path: contract.path, where: gameId, field: "boxes",
          message: `box "${gameId}" is ticked by the scheduler at ${at}; it may not be renamed or removed`,
        });
        continue;
      }
      if (box.turn === undefined) {
        issues.push({
          severity: "error", path: box.path, where: gameId, field: "turn",
          message: `box "${gameId}" is ticked by the scheduler at ${at} every ${want.turn}s, so it may not stop being a timed box`,
        });
        continue;
      }
      if (box.turn !== want.turn) {
        issues.push({
          severity: "error", path: box.path, where: gameId, field: "turn",
          message: `box "${gameId}" is ticked by the scheduler at ${at} every ${want.turn}s, not ${box.turn}s; changing the unit changes what every rest on its cards means`,
        });
      }
    }

    for (const entry of shard.properties ?? []) {
      const path = contractPropertyPath(entry);
      const found = decls.get(path);
      if (found === undefined) {
        issues.push({
          severity: "error", path: contract.path, where: path, field: "properties",
          message: `property "${path}" is carried in pockets at ${at}; it may not be renamed or removed`,
        });
        continue;
      }
      const want: PropertyType | undefined = contractPropertyType(entry);
      if (want !== undefined && want !== found.decl.type) {
        issues.push({
          severity: "error", path: found.path, where: found.where, field: "properties",
          message: `property "${path}" is carried in pockets at ${at} as ${want}, and is now ${found.decl.type}; a type change orphans every value the venue holds`,
        });
      }
    }

    for (const field of shard.fields ?? []) {
      if (fields.has(field)) continue;
      issues.push({
        severity: "error", path: contract.path, where: field, field: "fields",
        message: `card field "${field}" is read by the crew at ${at}; no box declares it any more`,
      });
    }
  }
  return issues;
}

/** One entity's contract dependencies, as a line an editor can show. */
export interface ContractNote {
  /** The installation that depends on this entity. */
  installation: string;
  /** The line itself, in the density grammar ("Bound at the-park: a station
   *  deals this hand"). */
  line: string;
}

/**
 * What each entity a contract depends on should say about itself, keyed by the
 * key an editor already has to hand.
 *
 * Keys are `hand:<gameId>`, `box:<gameId>`, `property:<path>` and
 * `field:<name>` - the four things a contract can name. Derived here rather than
 * in the editor because a second reading of the same shard is how the refusal
 * and the explanation come to disagree, and because the CLI's `contract show`
 * needs exactly the same list.
 */
export function contractNotes(source: SourceProject): Map<string, ContractNote[]> {
  const notes = new Map<string, ContractNote[]>();
  const push = (key: string, note: ContractNote): void => {
    notes.set(key, [...(notes.get(key) ?? []), note]);
  };
  for (const contract of source.contracts) {
    const at = contract.shard.installation;
    for (const hand of contract.shard.hands ?? []) {
      push(`hand:${hand}`, { installation: at, line: `Bound at ${at}: a station deals this hand` });
    }
    for (const [gameId, want] of Object.entries(contract.shard.boxes ?? {})) {
      push(`box:${gameId}`, { installation: at, line: `Ticked at ${at} every ${want.turn}s` });
    }
    for (const entry of contract.shard.properties ?? []) {
      const path = contractPropertyPath(entry);
      push(`property:${path}`, { installation: at, line: `Carried in pockets at ${at}` });
    }
    for (const field of contract.shard.fields ?? []) {
      push(`field:${field}`, { installation: at, line: `Read by the crew at ${at}` });
    }
  }
  return notes;
}
