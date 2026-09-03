// ---------------------------------------------------------------------------
// SourceProject -> Bundle: validate, compile expressions, assemble, hash.
//
// Validation here is the publish gate of schema 2.1 and the demotion net of
// the merge story (source doc section 9): reference checks no text merge can
// see (memberships, bindings, hand->query, fields against the box shape) and
// expression validation against the declared scopes via @wildwinter/expr.
// @hand is validated permissively in v0 (its names are deal-composed); the
// four static scopes are strict.
// ---------------------------------------------------------------------------

import { compile as compileExpr, parseAndValidate } from "@wildwinter/expr";
import type { Expression, ExpressionSchema, PropertyMeta } from "@wildwinter/expr";
import { storyletsDialect } from "@storylet-studio/dialect";
import type {
  Box, Bundle, Card, Deck, Hand, HandTemplate, Outcome, PropertyDecl, ScalarValue, TagGroup,
} from "@storylet-studio/model";
import { BUNDLE_SCHEMA, PLACE_GROUP, effectiveGameId, isValidGameId,
  isValidPropertyName, propertyNameify, RESERVED_PROPERTY_NAMES, byDisplayOrder, inferDeclFromWrite } from "@storylet-studio/model";
import type { Issue, SourceBox, SourceProject } from "./project.js";
import { canonicalStringify } from "./serialize.js";
import { compileMaps } from "./maps.js";
import { hash32 } from "./hash.js";

export interface CompileResult {
  /** Present only when there are no error-severity issues. */
  bundle?: Bundle;
  issues: Issue[];
}

const byId = <T extends { id: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));


const sortRecord = <V>(record: Record<string, V>): Record<string, V> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

/** Empty or whitespace-only expression source means "no expression". */
const blank = (src: string | undefined): boolean => src === undefined || src.trim() === "";

const meta = (decl: PropertyDecl): PropertyMeta => ({
  type: decl.type,
  ...(decl.values !== undefined ? { enumValues: decl.values } : {}),
  // A quality's ladder reaches expr's static validator this way, which is what
  // makes `>= "tpyo"` a compile error rather than a runtime surprise.
  ...(decl.stages !== undefined ? { stages: decl.stages } : {}),
});

const bagSchema = (decls: PropertyDecl[]): Map<string, PropertyMeta> =>
  new Map(decls.map((d) => [d.name, meta(d)]));

/** Does a value fit a declaration's type? The check a tag's own starting value
 *  gets, so `haunting: "loud"` on a number is caught at publish. */
const valueFits = (decl: PropertyDecl, v: ScalarValue): boolean => {
  switch (decl.type) {
    case "number": return typeof v === "number";
    case "boolean": return typeof v === "boolean";
    case "flags": return Array.isArray(v);
    case "enum": return typeof v === "string" && (decl.values?.includes(v) ?? true);
    case "quality": return typeof v === "string" && (decl.stages?.includes(v) ?? true);
    default: return typeof v === "string";
  }
};

/** Do two declarations of one name describe the same property? Enum values and
 *  a quality's stages are part of the answer: same type, different ladder is
 *  still a disagreement, and for a quality it is the WHOLE disagreement. */
const sameMeta = (a: PropertyMeta, b: PropertyMeta): boolean =>
  a.type === b.type
  && JSON.stringify(a.enumValues ?? null) === JSON.stringify(b.enumValues ?? null)
  && JSON.stringify(a.stages ?? null) === JSON.stringify(b.stages ?? null);

/** The content hash: over the canonical serialisation of the parsed shards,
 *  so formatting and comments never perturb it (schema 2.8). */
export function projectHash(source: SourceProject): string {
  return hash32(canonicalStringify({
    project: source.project,
    boxes: source.boxes.map((b) => ({
      path: b.path,
      box: b.box,
      tags: b.tags,
      hands: b.hands,
      decks: b.decks,
    })),
  }));
}

/** The staleness gate (schema 2.8): does a committed bundle still match the
 *  shards it claims to be compiled from? */
export function bundleIsFresh(bundle: Bundle, source: SourceProject): boolean {
  return bundle.content.project === source.project.project.id
    && bundle.content.version === source.project.project.version
    && bundle.content.hash === projectHash(source);
}

/**
 * Name something in a diagnostic the way the author sees it.
 *
 * A problem is read by somebody holding a mouse, not by somebody holding the
 * shard: `d_q671qawn` is a generated handle that appears nowhere in the editor,
 * so a message built from one is a message they cannot act on. The gameId is the
 * address every list, page and breadcrumb shows.
 *
 * An id survives only where the thing it points at does NOT exist, because then
 * it is the only evidence there is and it is what somebody grepping the shards
 * would search for. It is labelled `(id ...)` so it never reads as a name.
 */
const named = (entity: { gameId?: string; title?: string; id: string } | undefined, id: string): string =>
  (entity ? `"${effectiveGameId(entity)}"` : `an unknown group (id ${id})`);

export function compileProject(source: SourceProject): CompileResult {
  const issues: Issue[] = [];
  const report = (issue: Issue): void => { issues.push(issue); };

  const strip = source.project.export?.metadata === "stripped";
  const title = (v: string | undefined): string | undefined => (strip ? undefined : v);

  // --- global uniqueness -------------------------------------------------------
  const ids = new Map<string, string>();   // id -> path (all entities)
  const claimId = (id: string, path: string, where: string): void => {
    const prior = ids.get(id);
    if (prior !== undefined) {
      report({ severity: "error", path, where, message: `duplicate id "${id}" (also in ${prior})` });
    } else {
      ids.set(id, path);
    }
  };
  /**
   * A gameId that is not a legal address.
   *
   * The STUDIO cannot produce one: every save path runs the typed value through
   * `gameIdify`, whose output is always legal or empty. This is for the shards
   * that did not come through the editor - hand-edited, produced by another
   * tool, or arriving through unpack or a merge - where nothing had ever looked.
   *
   * An error rather than a warning, because a gameId IS the address a host calls
   * content by, and a bundle full of names no host can name is not half-working.
   * A deck's gameId is also its FILE NAME, which is why writeShardPath refuses to
   * build a path from one of these: reporting alone would leave the write
   * unguarded (design/storyletter.md section 4, "addresses").
   */
  const checkGameId = (kind: string, entity: { gameId?: string; id: string }, path: string): void => {
    // The PINNED value only. The other two ways an address is arrived at are
    // safe by construction and must not be checked against this regex: a derived
    // one comes from `gameIdify`, whose output is always legal, and the last
    // resort is the entity's own id, which contains an UNDERSCORE by convention
    // ("c_arrive") and would fail. Checking the effective address flagged every
    // untitled entity in the corpus, which is how this was caught.
    const pinned = entity.gameId?.trim();
    if (pinned === undefined || pinned === "" || isValidGameId(pinned)) return;
    report({
      severity: "error", path, where: pinned,
      message: `${kind} gameId "${pinned}" is not a legal address`
        + " (lower case letters, digits and hyphens; must start and end with a letter or digit)",
    });
  };
  /**
   * A declared property name has to be one the expression language can reach, and the
   * rule is dictated rather than chosen. `@wildwinter/expr` lexes an identifier as
   * a letter or underscore followed by letters, digits or underscores, and then FOLDS
   * it to lower case, so:
   *
   *   `isNight`   the reference becomes `isnight`, the declaration keeps its capital,
   *               and they never meet
   *   `9lives`    parse error, a name cannot start with a digit
   *   `not`       parse error, it is a keyword
   *   `is-night`  NOT an error: `@story.is-night` compiles to `@story.is` MINUS the
   *               string "night". This is the one that matters, because every other
   *               violation is loud and this one quietly means something else
   *
   * This began as the case check alone (found by following the Patter side's method,
   * patterkit to-storylets/declared-scopes-two-faults: hunt for a name stored one way
   * and looked up another). Widening it to the whole grammar, and giving both families
   * ONE rule with one implementation each and a parity test, was settled 2026-08-18:
   * see `@wildwinter/app-shell` src/property-names.ts, which owns the default, and
   * `packages/model/src/index.ts` here, which owns this side's copy.
   *
   * The words matter as much as the check. An author reads this while wondering why a
   * condition does nothing, so each branch says what actually happens and offers the
   * coerced name rather than reciting the rule.
   */
  const legalPropertyName = (scopeLabel: string, decls: PropertyDecl[] | undefined, path: string): void => {
    for (const d of decls ?? []) {
      // Quality declarations (design/quality.md): the ladder is the meaning,
      // so a quality without one, with a duplicate rung, or starting off the
      // ladder is caught at publish, in the same pass every declaration walks.
      if (d.type === "quality") {
        const ref = `@${scopeLabel}.${d.name}`;
        if (d.stages === undefined || d.stages.length === 0) {
          report({ severity: "error", path, where: `${scopeLabel}.${d.name}`, message: `quality "${ref}" declares no stages - a quality is its ladder` });
        } else {
          const seen = new Set<string>();
          for (const stage of d.stages) {
            if (seen.has(stage)) report({ severity: "error", path, where: `${scopeLabel}.${d.name}`, message: `quality "${ref}" lists stage "${stage}" twice` });
            seen.add(stage);
          }
          if (typeof d.default !== "string" || !seen.has(d.default)) {
            report({ severity: "error", path, where: `${scopeLabel}.${d.name}`, message: `quality "${ref}" defaults to ${JSON.stringify(d.default)}, which is not one of its stages` });
          }
        }
      }
      if (isValidPropertyName(d.name)) continue;
      const suggestion = propertyNameify(d.name);
      const tail = suggestion ? ` Try "${suggestion}".` : "";
      const ref = `@${scopeLabel}.${d.name}`;
      let why: string;
      if (RESERVED_PROPERTY_NAMES.includes(d.name.toLowerCase())) {
        why = `"${d.name.toLowerCase()}" is a keyword in expressions, so "${ref}" will not parse`;
      } else if (d.name.includes("-")) {
        why = `a hyphen reads as subtraction, so "${ref}" compiles to "@${scopeLabel}.${d.name.split("-")[0]}" minus a string, not to this property`;
      } else if (/^[0-9]/.test(d.name)) {
        why = `a name cannot start with a digit, so "${ref}" will not parse`;
      } else if (d.name !== d.name.toLowerCase() && isValidPropertyName(d.name.toLowerCase())) {
        why = `expressions fold names, so "${ref}" would look for "${d.name.toLowerCase()}" and find nothing`;
      } else {
        why = `only lower case letters, digits and underscores can appear in a name, so "${ref}" will not parse`;
      }
      report({
        severity: "error", path, where: `${scopeLabel}.${d.name}`,
        message: `property name "${d.name}" cannot be used (${why}).${tail}`,
      });
    }
  };
  const uniqueGameIds = (kind: string, scope: Map<string, string>, gameId: string, path: string): void => {
    const prior = scope.get(gameId);
    if (prior !== undefined) {
      report({ severity: "error", path, where: gameId, message: `duplicate ${kind} gameId "${gameId}" (also in ${prior})` });
    } else {
      scope.set(gameId, path);
    }
  };
  // Hands and cards are addressed project-wide (deal(hand) is API; the
  // play-history functions key on card gameIds), so their gameIds are
  // project-wide unique. Boxes likewise.
  const handGameIds = new Map<string, string>();
  const cardGameIds = new Map<string, string>();
  const boxGameIds = new Map<string, string>();

  // --- expression validation plumbing --------------------------------------------
  legalPropertyName("story", source.project.story?.properties, source.path);
  legalPropertyName("world", source.project.world?.properties, source.path);
  // The sharing flag stops at @world's door (design/flows.md): @world is the
  // game's own state, always one value across every flow, so a flag either
  // way is a claim the scope cannot honour.
  for (const d of source.project.world?.properties ?? []) {
    if (d.shared !== undefined) {
      report({
        severity: "error", path: source.path, where: `world.${d.name}`,
        message: `@world.${d.name} declares "shared" - @world is the game's own state and is always shared across flows; the flag belongs on @story, box, deck, hand or tag properties`,
      });
    }
  }
  const storySchema = bagSchema(source.project.story?.properties ?? []);
  const worldSchema = bagSchema(source.project.world?.properties ?? []);
  /**
   * The @hand schema for one box, INFERRED from what the box already declares
   * (design/hand-typing.md step A). @hand is composed per ask, in the three
   * layers `buildHandEnv` assembles, so this mirrors them in the same order:
   *
   *   1. the properties of the group's tags, which must AGREE on a shared name
   *   2. hand and hand-template properties, same rule
   *   3. one name per tag group, the chosen tag, typed as an enum over the
   *      group's tags, which is what makes `@hand.area == "dokcs"` an error
   *
   * Later layers overwrite earlier ones without complaint, because that is
   * exactly what `buildHandEnv` does when two layers use one name. Within a
   * layer, a disagreement is a real authoring fault, reported once, naming
   * both sides. The name then KEEPS its first declaration rather than being
   * dropped: dropping it makes every use site an "unresolved reference", which
   * buries the one real message under a second wave of errors about a cause
   * the use sites do not own. (A per-name "permissive" would be the ideal
   * third option; the schema has no way to say it, since a name is either in
   * the map with a type or absent and therefore unresolved.)
   *
   * Nothing here asks an author to declare anything new. Inferring it types
   * every project as already written, which is the point: before this, a
   * misspelt @hand name compiled clean, validated ok, and silently never
   * dealt.
   */
  const handSchemaCache = new Map<string, Map<string, PropertyMeta>>();
  const handSchemaFor = (box: SourceBox): Map<string, PropertyMeta> => {
    const cached = handSchemaCache.get(box.path);
    if (cached) return cached;

    const layer = (decls: Array<{ decl: PropertyDecl; where: string }>, path: string): Map<string, PropertyMeta> => {
      const out = new Map<string, PropertyMeta>();
      const firstSeen = new Map<string, { meta: PropertyMeta; where: string }>();
      const reported = new Set<string>();
      for (const { decl, where } of decls) {
        const m = meta(decl);
        const first = firstSeen.get(decl.name);
        if (!first) { firstSeen.set(decl.name, { meta: m, where }); out.set(decl.name, m); continue; }
        if (sameMeta(first.meta, m) || reported.has(decl.name)) continue;
        reported.add(decl.name);
        report({ severity: "error", path, where,
          message: `@hand.${decl.name} is declared as ${first.meta.type} on ${first.where} and as ${decl.type} on ${where}; @hand composes them into one name, so they must agree` });
      }
      return out;
    };

    const tagsPath = `${box.path}/tags`;
    const tagDecls = box.tags.groups.flatMap((group) => [
      // Declared once on the group: unambiguous by construction, and the same
      // name on one of its tags is refused, so these never fight each other.
      ...(group.properties ?? []).map((decl) => ({ decl, where: `group ${effectiveGameId(group)}` })),
      ...group.tags.flatMap((tag) => (tag.properties ?? []).map((decl) => ({
        decl, where: `${effectiveGameId(group)}/${effectiveGameId(tag)}`,
      }))),
    ]);
    const handsPath = `${box.path}/hands`;
    const handDecls = [
      ...box.hands.templates.flatMap((t) => (t.properties ?? []).map((decl) => ({
        decl, where: `hand template ${effectiveGameId(t)}`,
      }))),
      ...box.hands.hands.flatMap((h) => (h.properties ?? []).map((decl) => ({
        decl, where: `hand ${effectiveGameId(h)}`,
      }))),
    ];

    const out = new Map<string, PropertyMeta>([
      ...layer(tagDecls, tagsPath),
      ...layer(handDecls, handsPath),
    ]);
    // Layer 3 last, so a group name wins the way it does at runtime.
    for (const group of box.tags.groups) {
      out.set(effectiveGameId(group), {
        type: "enum",
        enumValues: group.tags.map((t) => effectiveGameId(t)),
      });
    }
    handSchemaCache.set(box.path, out);
    return out;
  };

  const schemaFor = (box: SourceBox, deckDecls: PropertyDecl[] | undefined): ExpressionSchema => ({
    properties: new Map([
      ["story", storySchema],
      ["world", worldSchema],
      ["box", bagSchema(box.box.box.properties ?? [])],
      // deck absent (undefined) would be permissive; an empty map makes every
      // reference an error - exactly right for query conditions (schema 6.2).
      ["deck", bagSchema(deckDecls ?? [])],
      ["hand", handSchemaFor(box)],
    ]),
  });

  const expr = (
    src: string, schema: ExpressionSchema, path: string, where: string, label: string,
    /** The shard field this expression is the value of, for the editor's jump.
     *  Separate from `label`, which is prose and reads differently ("outcome
     *  condition", "change @story.gold"). Defaults to the label where the two
     *  happen to agree. */
    field: string = label,
  ): Expression | undefined => {
    const result = parseAndValidate(src, schema, storyletsDialect);
    for (const issue of result.issues) {
      report({ severity: issue.severity, path, where, field, message: `${label}: ${issue.message}` });
    }
    if (!result.ok || result.ast === null) return undefined;
    return compileExpr(src, storyletsDialect);
  };

  // --- per-box assembly ------------------------------------------------------------
  const boxes: Box<Expression>[] = [];
  for (const sourceBox of source.boxes) {
    const boxDecl = sourceBox.box.box;
    const boxPath = `${sourceBox.path}/box`;
    claimId(boxDecl.id, boxPath, effectiveGameId(boxDecl));
    checkGameId("box", boxDecl, boxPath);
    uniqueGameIds("box", boxGameIds, effectiveGameId(boxDecl), boxPath);
    legalPropertyName("box", boxDecl.properties, boxPath);

    // Tag groups. A group gameId is addressed through the box that owns it
    // (peek names a box; the play-history functions resolve against the box
    // being asked), so it is unique WITHIN a box and boxes namespace it: two
    // boxes may each declare a "zone" group.
    const tagGroups: TagGroup[] = [];
    const groupsById = new Map<string, TagGroup>();
    const groupGameIds = new Map<string, string>();
    for (const group of sourceBox.tags.groups) {
      const path = `${sourceBox.path}/tags`;
      claimId(group.id, path, effectiveGameId(group));
      checkGameId("tag group", group, path);
      uniqueGameIds(`tag group (box "${effectiveGameId(boxDecl)}")`, groupGameIds, effectiveGameId(group), path);
      if (effectiveGameId(group) === PLACE_GROUP) {
        report({ severity: "error", path, where: PLACE_GROUP, message: `"${PLACE_GROUP}" is the reserved tag group and cannot be declared` });
      }
      const tagGameIds = new Map<string, string>();
      for (const tag of group.tags) {
        claimId(tag.id, path, effectiveGameId(tag));
        checkGameId("tag", tag, path);
        uniqueGameIds(`tag (group "${effectiveGameId(group)}")`, tagGameIds, effectiveGameId(tag), path);
        // A tag's own properties feed the composed @hand, so they fold too.
        legalPropertyName("hand", tag.properties, path);
      }
      // A state-bound group names a @world or @story property that must exist
      // and must be able to hold a tag's gameId. Caught here rather than at
      // runtime: a group bound to nothing silently wildcards, so every card in
      // the axis becomes available and the fault reads as content, not config.
      if (group.boundBy !== undefined) {
        const ref = /^@(world|story)\.([a-z][a-z0-9_-]*)$/.exec(group.boundBy);
        if (!ref) {
          report({ severity: "error", path, where: effectiveGameId(group), message: `boundBy "${group.boundBy}" must be a @world or @story property reference` });
        } else {
          const decls = ref[1] === "world" ? source.project.world?.properties : source.project.story?.properties;
          const decl = (decls ?? []).find((d) => d.name === ref[2]);
          if (!decl) {
            report({ severity: "error", path, where: effectiveGameId(group), message: `boundBy "${group.boundBy}" is not a declared ${ref[1]} property` });
          } else if (decl.type !== "string" && decl.type !== "enum") {
            report({ severity: "error", path, where: effectiveGameId(group), message: `boundBy "${group.boundBy}" is a ${decl.type} property; a state-bound group needs a string or enum, whose value names one of its tags` });
          } else if (decl.type === "enum" && decl.values !== undefined) {
            // An enum's whole point is a closed set, so a value that can never
            // name a tag is a mistake worth naming at publish time.
            const names = new Set(group.tags.map((t) => effectiveGameId(t)));
            const stray = decl.values.filter((v) => !names.has(v));
            if (stray.length === decl.values.length) {
              report({ severity: "error", path, where: effectiveGameId(group), message: `boundBy "${group.boundBy}" can never name a tag in this group (its values are ${decl.values.join(", ")})` });
            } else if (stray.length > 0) {
              report({ severity: "warning", path, where: effectiveGameId(group), message: `boundBy "${group.boundBy}" may hold ${stray.join(", ")}, which name no tag here; the group goes unbound then, so every card in the axis is eligible` });
            }
          }
        }
      }
      // A name declared both on the group and on one of its tags: the flatten
      // would put two of it on that tag, and there is no honest winner.
      for (const decl of group.properties ?? []) {
        for (const t of group.tags) {
          if ((t.properties ?? []).some((own) => own.name === decl.name)) {
            report({ severity: "error", path, where: `${effectiveGameId(group)}/${effectiveGameId(t)}`,
              message: `"${decl.name}" is declared both on the group "${effectiveGameId(group)}" and on its tag "${effectiveGameId(t)}"; declare it once, on the group if every tag has it` });
          }
        }
      }
      // A starting value needs something to be the value OF, and has to fit it.
      for (const t of group.tags) {
        for (const [name, v] of Object.entries(t.values ?? {})) {
          const decl = (group.properties ?? []).find((d) => d.name === name);
          if (!decl) {
            report({ severity: "error", path, where: `${effectiveGameId(group)}/${effectiveGameId(t)}`,
              message: `"${name}" has a value here but the group "${effectiveGameId(group)}" declares no such property; a tag sets values, its group declares them` });
          } else if (!valueFits(decl, v)) {
            report({ severity: "error", path, where: `${effectiveGameId(group)}/${effectiveGameId(t)}`,
              message: `"${name}" is ${decl.type} on the group, so ${JSON.stringify(v)} is not a value it can start at` });
          }
        }
      }
      legalPropertyName("hand", group.properties, path);

      const compiled: TagGroup = {
        id: group.id,
        gameId: effectiveGameId(group),
        ...(title(group.purpose) !== undefined ? { purpose: group.purpose } : {}),
        // The axis's own configuration, unlike `templates` (source-only): the
        // runtime needs both to bind the group and to refuse untagged cards.
        ...(group.boundBy !== undefined ? { boundBy: group.boundBy } : {}),
        ...(group.required === true ? { required: true } : {}),
        // Template-of-play extras (`templates`) are source-only: never compiled.
        // Group-level declarations are FLATTENED onto every tag here
        // (design/hand-typing.md step B), each carrying that tag's own
        // starting value when it set one. The bundle therefore keeps exactly
        // the per-tag shape every runtime already reads, and the DRY source
        // costs nothing downstream.
        tags: byId(group.tags.map((t) => {
          const own = t.properties ?? [];
          const fromGroup = (group.properties ?? []).map((decl) => {
            const v = t.values?.[decl.name];
            return v === undefined ? decl : { ...decl, default: v };
          });
          const properties = [...own, ...fromGroup];
          return {
            id: t.id,
            gameId: t.gameId,
            ...(properties.length > 0 ? { properties } : {}),
          };
        })),
      };
      tagGroups.push(compiled);
      groupsById.set(group.id, compiled);
    }
    // Hand ids, up front: card home tags reference them (schema 2.4).
    const handIds = new Set(sourceBox.hands.hands.map((h) => h.id));

    const checkTags = (
      path: string, where: string, tags: Record<string, string[]> | undefined,
    ): void => {
      for (const [groupId, tagIds] of Object.entries(tags ?? {})) {
        if (groupId === PLACE_GROUP) {
          // The reserved group: its tags are the box's hand ids (schema 2.4).
          for (const handId of tagIds) {
            if (!handIds.has(handId)) {
              report({ severity: "error", path, where, field: "tags", message: `place tag points at a hand that is not in this box (id ${handId})` });
            }
          }
          continue;
        }
        const group = groupsById.get(groupId);
        if (!group) {
          report({ severity: "error", path, where, field: "tags", message: `points at a tag group that is not in this box (id ${groupId})` });
          continue;
        }
        for (const tagId of tagIds) {
          if (!group.tags.some((t) => t.id === tagId)) {
            report({
              severity: "error", path, where, field: "tags",
              message: `points at a tag that is not in "${effectiveGameId(group)}" (id ${tagId})`,
              fix: { kind: "repoint-tag", holder: where, group: group.id, bad: tagId, options: group.tags.map((t) => ({ id: t.id, label: effectiveGameId(t) })) },
            });
          }
        }
      }
    };

    // Decks and cards.
    const fieldDecls = new Map((boxDecl.fields ?? []).map((f) => [f.name, f]));
    const decks: Deck<Expression>[] = [];
    for (const { path, shard } of sourceBox.decks) {
      const deckDecl = shard.deck;
      claimId(deckDecl.id, path, effectiveGameId(deckDecl));
      // A deck's gameId names its FILE, so this one is not merely an address.
      checkGameId("deck", deckDecl, path);
      legalPropertyName("deck", deckDecl.properties, path);
      const deckSchema = schemaFor(sourceBox, deckDecl.properties ?? []);
      const cards: Card<Expression>[] = [];
      for (const card of shard.cards) {
        claimId(card.id, path, effectiveGameId(card));
        checkGameId("card", card, path);
        uniqueGameIds("card", cardGameIds, effectiveGameId(card), path);
        checkTags(path, effectiveGameId(card), card.tags);
        // A redraw the engine will SILENTLY IGNORE must not compile clean.
        // `redraw` is "always" | "never" | a number; a digit string ("4") is
        // none of those, so `typeof redraw === "number"` never matches, no
        // cooldown is ever recorded, and the card behaves as `always` with
        // nothing said anywhere. The Village carried sixteen of them from its
        // port and every finite cooldown in it was inert - found 2026-08-30,
        // when the sample client dealt the same card twice in a row and the
        // author asked why. Storyletter itself writes numbers (mutate.ts
        // `coerceRedraw`), so this catches imported and hand-edited shards.
        if (card.redraw !== undefined && typeof card.redraw !== "number"
          && card.redraw !== "always" && card.redraw !== "never") {
          const asNumber = Number(card.redraw);
          report({ severity: "error", path, where: effectiveGameId(card), field: "redraw",
            message: Number.isInteger(asNumber) && asNumber >= 0
              ? `redraw is the string ${JSON.stringify(card.redraw)}, so its cooldown never fires: write it as the number ${asNumber}`
              : `redraw must be "always", "never" or a whole number of turns (got ${JSON.stringify(card.redraw)})` });
        }
        if (card.copies !== undefined && (!Number.isInteger(card.copies) || card.copies < 1)) {
          report({ severity: "error", path, where: effectiveGameId(card), field: "copies", message: `copies must be an integer >= 1 (got ${JSON.stringify(card.copies)})` });
        }
        if (card.sharedCopies !== undefined && (!Number.isInteger(card.sharedCopies) || card.sharedCopies < 1)) {
          report({ severity: "error", path, where: effectiveGameId(card), field: "sharedCopies", message: `sharedCopies must be an integer >= 1 (got ${JSON.stringify(card.sharedCopies)})` });
        }
        // sharedCopies is the WORLD cap and copies the per-flow one, so a world
        // cap below the per-flow cap says two contradictory things and the
        // smaller silently wins. Refuse it rather than pick (design/shared-scarcity 9.1).
        if (card.sharedCopies !== undefined && card.sharedCopies < (card.copies ?? 1)) {
          report({ severity: "error", path, where: effectiveGameId(card), field: "sharedCopies", message: `sharedCopies (${card.sharedCopies}) is below copies (${card.copies ?? 1}): the world cannot hold fewer than one participant may` });
        }
        // sharedCopies only means anything on a shared card; the deck may be
        // what makes it shared, so this is a warning about a dead setting
        // rather than an error.
        if (card.sharedCopies !== undefined && (card.shared ?? deckDecl.shared) !== true) {
          report({ severity: "warning", path, where: effectiveGameId(card), field: "sharedCopies", message: "sharedCopies is set but the card is not shared, so it does nothing" });
        }

        for (const [name, value] of Object.entries(card.fields ?? {})) {
          const decl = fieldDecls.get(name);
          if (!decl) {
            report({ severity: "error", path, where: effectiveGameId(card), field: "fields", message: `field "${name}" is not in the box's card template` });
            continue;
          }
          const ok = decl.type === "number" ? typeof value === "number"
            : decl.type === "boolean" ? typeof value === "boolean"
            : decl.type === "flags" ? Array.isArray(value) && value.every((x) => typeof x === "string" && (decl.values ?? []).includes(x))
            : decl.type === "enum" ? typeof value === "string" && (decl.values ?? []).includes(value)
            : typeof value === "string";
          if (!ok) {
            report({ severity: "error", path, where: effectiveGameId(card), field: "fields", message: `field "${name}" does not match its declared type "${decl.type}"` });
          }
        }

        const outcomeGameIds = new Map<string, string>();
        const outcomes: Outcome<Expression>[] = [];
        for (const outcome of byDisplayOrder(card.outcomes ?? [])) {
          claimId(outcome.id, path, `${effectiveGameId(card)}/${effectiveGameId(outcome)}`);
          checkGameId("outcome", outcome, path);
          uniqueGameIds(`outcome (card "${effectiveGameId(card)}")`, outcomeGameIds, effectiveGameId(outcome), path);
          const changes: Record<string, Expression> = {};
          for (const [target, src] of Object.entries(outcome.changes ?? {})) {
            const match = /^@(world|story|box|deck|hand)\.[a-z][a-z0-9_-]*$/.exec(target);
            if (!match) {
              report({ severity: "error", path, where: `${effectiveGameId(card)}/${effectiveGameId(outcome)}`, field: "changes", message: `change target "${target}" is not a property reference (@scope.name)` });
              continue;
            }
            const [, scope] = match;
            if (scope === "hand") {
              // @hand has no single owner to declare into, so no quick-fix, but
              // two faults are worth naming. A tag group's name is the CHOSEN
              // TAG: it is what the ask asked for, not state, and the runtime
              // has always thrown on the write. Now publish says so first.
              const name = target.slice(1).split(".")[1]!;
              const group = sourceBox.tags.groups.find((g) => effectiveGameId(g) === name);
              if (group) {
                report({ severity: "error", path, where: `${effectiveGameId(card)}/${effectiveGameId(outcome)}`, field: "changes",
                  message: `change target "${target}" is the chosen tag of group "${name}", which cannot be written: it is what the hand asked for, not state it carries` });
              } else if (!handSchemaFor(sourceBox).has(name)) {
                report({ severity: "error", path, where: `${effectiveGameId(card)}/${effectiveGameId(outcome)}`, field: "changes",
                  message: `change target "${target}" is not a property any tag, hand or hand template in this box declares` });
              }
            } else {
              const name = target.slice(1).split(".")[1]!;
              const scopeSchema = schemaFor(sourceBox, deckDecl.properties ?? []).properties.get(scope!);
              if (scopeSchema && !scopeSchema.has(name)) {
                report({
                  severity: "error", path, where: `${effectiveGameId(card)}/${effectiveGameId(outcome)}`, field: "changes",
                  message: `change target "${target}" is not a declared property`,
                  // The declaration's home is the scope's owner: @story on the
                  // project, @box on the box, @deck on the deck.
                  fix: {
                    kind: "declare-property", scope: scope!, name,
                    owner: scope === "deck" ? deckDecl.id : scope === "box" ? sourceBox.box.box.id : "",
                    // The value being written usually settles the type, and the
                    // commonest write by far is `true` (a latch). Undeclared
                    // means "could not tell", and the fix keeps its old guess.
                    ...(() => { const g = inferDeclFromWrite(src); return g ? { declType: g.type, declDefault: g.default } : {}; })(),
                  },
                });
              }
            }
            // Read-only @world (Reboot.md 10): the story's own promise not to
            // write a game value, `writable: false` on the declaration, kept
            // here so a card that moves the clock is an error before it is a
            // bug. The game is not bound by it; its resolver is its policy.
            if (scope === "world") {
              const name = target.slice(1).split(".")[1]!;
              const decl = (source.project.world?.properties ?? []).find((d) => d.name === name);
              if (decl && decl.writable === false) {
                report({ severity: "error", path, where: `${effectiveGameId(card)}/${effectiveGameId(outcome)}`, field: "changes",
                  message: `change target "${target}" is read-only to the story (writable: false): the game owns it, and a condition may read it but an outcome may not write it` });
                continue;
              }
            }
            const value = expr(src, deckSchema, path, `${effectiveGameId(card)}/${effectiveGameId(outcome)}`, `change ${target}`, "changes");
            if (value) changes[target] = value;
          }
          outcomes.push({
            id: outcome.id,
            gameId: effectiveGameId(outcome),
            ...(title(outcome.title) !== undefined ? { title: outcome.title } : {}),
            ...(title(outcome.purpose) !== undefined ? { purpose: outcome.purpose } : {}),
            ...(!blank(outcome.condition)
              ? { condition: expr(outcome.condition!, deckSchema, path, `${effectiveGameId(card)}/${effectiveGameId(outcome)}`, "outcome condition", "condition") }
              : {}),
            changes: sortRecord(changes),
          });
        }

        cards.push({
          id: card.id,
          gameId: effectiveGameId(card),
          ...(title(card.title) !== undefined ? { title: card.title } : {}),
          ...(title(card.purpose) !== undefined ? { purpose: card.purpose } : {}),
          ...(!blank(card.condition)
            ? { condition: expr(card.condition!, deckSchema, path, effectiveGameId(card), "condition") }
            : {}),
          priority: typeof card.priority === "string"
            ? (blank(card.priority) ? 0 : expr(card.priority, deckSchema, path, effectiveGameId(card), "priority") ?? 0)
            : card.priority ?? 0,
          redraw: card.redraw ?? "always",
          ...(card.copies !== undefined ? { copies: card.copies } : {}),
          ...(card.shared !== undefined ? { shared: card.shared } : {}),
          ...(card.sharedCopies !== undefined ? { sharedCopies: card.sharedCopies } : {}),
          ...(card.tags !== undefined ? { tags: sortRecord(card.tags) } : {}),
          ...(card.fields !== undefined ? { fields: sortRecord(card.fields) } : {}),
          outcomes,   // already in display order: the loop above walked them that way
        });
      }
      decks.push({
        id: deckDecl.id,
        gameId: effectiveGameId(deckDecl),
        ...(title(deckDecl.title) !== undefined ? { title: deckDecl.title } : {}),
        ...(title(deckDecl.purpose) !== undefined ? { purpose: deckDecl.purpose } : {}),
        ...(!blank(deckDecl.condition)
          ? { condition: expr(deckDecl.condition!, schemaFor(sourceBox, deckDecl.properties ?? []), path, effectiveGameId(deckDecl), "deck gate", "condition") }
          : {}),
        ...(deckDecl.shared !== undefined ? { shared: deckDecl.shared } : {}),
        properties: deckDecl.properties ?? [],
        cards: byId(cards),
      });
    }

    // Hand templates and hands (schema 2.6).
    const handsPath = `${sourceBox.path}/hands`;
    const handSchema = schemaFor(sourceBox, undefined);
    const checkBindings = (where: string, bindings: Record<string, string> | undefined): void => {
      for (const [groupId, tagId] of Object.entries(bindings ?? {})) {
        const group = groupsById.get(groupId);
        if (!group) {
          report({ severity: "error", path: handsPath, where, message: `binds a tag group that is not in this box (id ${groupId})` });
          continue;
        }
        if (!group.tags.some((t) => t.id === tagId)) {
          report({ severity: "error", path: handsPath, where, message: `binds a tag that is not in "${effectiveGameId(group)}" (id ${tagId})` });
        }
      }
    };
    const handTemplates: HandTemplate<Expression>[] = [];
    for (const template of sourceBox.hands.templates) {
      claimId(template.id, handsPath, effectiveGameId(template));
      checkGameId("hand template", template, handsPath);
      checkBindings(effectiveGameId(template), template.bindings);
      legalPropertyName("hand", template.properties, handsPath);
      for (const groupId of template.chooses ?? []) {
        if (!groupsById.has(groupId)) {
          report({ severity: "error", path: handsPath, where: effectiveGameId(template), message: `asks each hand to choose from a tag group that is not in this box (id ${groupId})` });
        } else if (template.bindings?.[groupId] !== undefined) {
          report({ severity: "error", path: handsPath, where: effectiveGameId(template), message: `binds "${effectiveGameId(groupsById.get(groupId)!)}" and also asks each hand to choose one: a template can do either, not both` });
        }
      }
      handTemplates.push({
        id: template.id,
        gameId: effectiveGameId(template),
        ...(title(template.title) !== undefined ? { title: template.title } : {}),
        ...(title(template.purpose) !== undefined ? { purpose: template.purpose } : {}),
        ...(template.bindings !== undefined ? { bindings: sortRecord(template.bindings) } : {}),
        ...(template.chooses !== undefined ? { chooses: [...template.chooses].sort() } : {}),
        ...(!blank(template.condition)
          ? { condition: expr(template.condition!, handSchema, handsPath, effectiveGameId(template), "template condition", "condition") }
          : {}),
        slots: template.slots ?? "unbounded",
        properties: template.properties ?? [],
      });
    }
    const templatesById = new Map(handTemplates.map((t) => [t.id, t]));
    const hands: Hand<Expression>[] = [];
    for (const hand of sourceBox.hands.hands) {
      claimId(hand.id, handsPath, effectiveGameId(hand));
      checkGameId("hand", hand, handsPath);
      uniqueGameIds("hand", handGameIds, effectiveGameId(hand), handsPath);
      if ((hand.template === undefined) === (hand.rule === undefined)) {
        report({ severity: "error", path: handsPath, where: effectiveGameId(hand), message: "a hand carries exactly one of template / rule" });
        continue;
      }
      if (hand.template !== undefined) {
        const template = templatesById.get(hand.template);
        if (!template) {
          report({ severity: "error", path: handsPath, where: effectiveGameId(hand), message: `uses a hand template that is not in this box (id ${hand.template})` });
          continue;
        }
        for (const groupId of template.chooses ?? []) {
          const tagId = hand.chosen?.[groupId];
          const group = groupsById.get(groupId);
          if (tagId === undefined) {
            // The one an author meets by accident: dragging a pin off every zone
            // empties this. It names the group and says what is expected of the
            // hand, because "missing chosen tag for group d_zone" told somebody
            // holding a mouse nothing they could act on.
            report({ severity: "error", path: handsPath, where: effectiveGameId(hand),
              message: `nothing chosen for the tag group ${named(group, groupId)}: a hand fills every hole its template declares` });
          } else if (group && !group.tags.some((t) => t.id === tagId)) {
            report({
              severity: "error", path: handsPath, where: effectiveGameId(hand),
              message: `the tag chosen for "${effectiveGameId(group)}" is not in that group (id ${tagId})`,
              fix: { kind: "repoint-tag", holder: hand.id, group: group.id, bad: tagId as string, options: group.tags.map((t) => ({ id: t.id, label: effectiveGameId(t) })) },
            });
          }
        }
        for (const groupId of Object.keys(hand.chosen ?? {})) {
          if (!(template.chooses ?? []).includes(groupId)) {
            report({ severity: "error", path: handsPath, where: effectiveGameId(hand),
              message: `chooses a tag for ${named(groupsById.get(groupId), groupId)}, which the template "${effectiveGameId(template)}" does not ask for` });
          }
        }
      } else if (hand.rule) {
        checkBindings(effectiveGameId(hand), hand.rule.bindings);
      }
      hands.push({
        id: hand.id,
        gameId: effectiveGameId(hand),
        ...(title(hand.title) !== undefined ? { title: hand.title } : {}),
        ...(title(hand.purpose) !== undefined ? { purpose: hand.purpose } : {}),
        ...(hand.template !== undefined ? { template: hand.template } : {}),
        ...(hand.chosen !== undefined ? { chosen: sortRecord(hand.chosen) } : {}),
        ...(hand.rule !== undefined ? {
          rule: {
            ...(hand.rule.bindings !== undefined ? { bindings: sortRecord(hand.rule.bindings) } : {}),
            ...(!blank(hand.rule.condition)
              ? { condition: expr(hand.rule.condition!, handSchema, handsPath, effectiveGameId(hand), "hand condition", "condition") }
              : {}),
            slots: hand.rule.slots ?? "unbounded",
          },
        } : {}),
        ...(hand.slots !== undefined ? { slots: hand.slots } : {}),
        ...(hand.properties !== undefined ? { properties: hand.properties } : {}),
        // Template-of-play extras (`templates`) are source-only: never compiled.
      });
    }

    boxes.push({
      id: boxDecl.id,
      gameId: effectiveGameId(boxDecl),
      ...(title(boxDecl.title) !== undefined ? { title: boxDecl.title } : {}),
      ...(title(boxDecl.purpose) !== undefined ? { purpose: boxDecl.purpose } : {}),
      ranking: { specificity: boxDecl.ranking?.specificity ?? true },
      fields: boxDecl.fields ?? [],
      properties: boxDecl.properties ?? [],
      tagGroups: byId(tagGroups),
      decks: byId(decks),
      handTemplates: byId(handTemplates),
      hands: byId(hands),
    });
  }

  // The coverage block (authoring config, never compiled) still validates at
  // the publish gate: a driver on an undeclared property or a mistyped
  // domain is a config bug the author should see immediately.
  const coverage = source.project.coverage;
  if (coverage) {
    const worldDecls = new Map((source.project.world?.properties ?? []).map((d) => [d.name, d]));
    const matches = (value: unknown, type: string, values?: string[]): boolean =>
      type === "number" ? typeof value === "number"
      : type === "boolean" ? typeof value === "boolean"
      : type === "flags" ? Array.isArray(value) && value.every((x) => typeof x === "string" && (values ?? []).includes(x))
      : type === "enum" ? typeof value === "string" && (values ?? []).includes(value)
      : typeof value === "string";
    for (const [ref, driver] of Object.entries(coverage.drivers ?? {})) {
      const match = /^@world\.([a-z][a-z0-9_-]*)$/.exec(ref);
      const decl = match ? worldDecls.get(match[1]!) : undefined;
      if (!decl) {
        report({ severity: "error", path: source.path, where: ref, message: "coverage driver ref must name a declared @world property (the host seam is the only drivable scope)" });
        continue;
      }
      if (driver.kind !== "initial" && driver.kind !== "recurring") {
        report({ severity: "error", path: source.path, where: ref, message: `coverage driver kind must be "initial" or "recurring"` });
      }
      for (const value of driver.values) {
        if (!matches(value, decl.type, decl.values)) {
          report({ severity: "error", path: source.path, where: ref, message: `coverage driver value ${JSON.stringify(value)} does not match the property's type "${decl.type}"` });
        }
      }
    }
  }

  if (issues.some((i) => i.severity === "error")) {
    return { issues };
  }
  // Authoring geometry, carried only when the project asked for it (maps.ts
  // explains why this is the one exception to "templates are source-only").
  const maps = source.project.export?.map === true ? compileMaps(source) : undefined;
  const bundle: Bundle = {
    schema: BUNDLE_SCHEMA,
    content: {
      project: source.project.project.id,
      version: source.project.project.version,
      hash: projectHash(source),
    },
    metadata: strip ? "stripped" : "full",
    settings: { playAdvancesTurns: source.project.settings?.playAdvancesTurns ?? 1 },
    world: {
      properties: source.project.world?.properties ?? [],
      ...(source.project.world?.registry !== undefined ? { registry: source.project.world.registry } : {}),
    },
    story: { properties: source.project.story?.properties ?? [] },
    boxes: byId(boxes),
    ...(maps !== undefined ? { maps } : {}),
  };
  return { bundle, issues };
}
