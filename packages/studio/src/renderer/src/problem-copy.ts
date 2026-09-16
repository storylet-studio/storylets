// ---------------------------------------------------------------------------
// Problem copy: every diagnostic the compiler raises, rewritten for the person
// at the keyboard.
//
// "Diagnostics name what the author can see" (design-language.md): a problem
// names the thing it is about by its title, says what is wrong in a plain
// sentence, and gives the next step when there is one. The problems bar used
// to show the compiler's own string, which is written for the shard ("copies
// must be an integer >= 1 (got "x")") and labelled it with a storage path
// (ui-review-2026-09, finding 17).
//
// The translator is the shell's `describeProblem` and the shared codes are its
// `defaultProblemCopy`; this file is Storyletter's table over it. The
// compiler's `Issue` carries NO code (severity, path, where, field, message),
// and it raises about sixty message shapes across parse.ts, compile.ts and
// play-ladder.ts, so adding a code at the source is not a one-line change.
// Instead `problemCode` derives the code from the SHAPE of the message, with
// one regex per shape, and each table entry reads the specifics (the property
// name, the value, the group) back out of the same message. When the compiler
// grows a `code`, the classifier goes and the table stays.
//
// The table names the item through `problemName`: its title in curly quotes
// when the caller resolved one, "(id ...)" only for a DANGLING reference, and
// "This" otherwise (the bar's "go to" shows the reader what "this" is).
// ---------------------------------------------------------------------------

import { defaultProblemCopy, problemLine, problemName } from "@wildwinter/app-shell";
import type { ProblemCopyTable, ProblemLike } from "@wildwinter/app-shell";
import type { Problem } from "../../shared/api.js";

/** The author-facing names a caller could resolve for a problem: `title` is
 *  what the problem is about, `where` the container it sits in (the bar's
 *  mono segment). Either may be missing. */
export interface ProblemNames {
  title?: string;
  where?: string;
}

/** One message shape, and the code it means. First match wins, so a more
 *  specific shape sits above a looser one that would also match it. */
const SHAPES: [RegExp, string][] = [
  // parse.ts: files and folders
  [/^unparseable JSON5: /, "unparseable"],
  [/^shard must be a JSON5 object$/, "not-an-object"],
  [/^schema tag .* is not "/, "wrong-schema"],
  [/^a project has exactly one \*\.storyletproj at its root; found /, "project-count"],
  [/^box folder has no box\.storyletbox$/, "box-without-shard"],
  [/^the map lives in map\.storyletmap now|^this project's map lives in the view shard/, "stale-view-map"],
  [/^unexpected file in decks\/|^unrecognised file in a box folder/, "stray-file"],
  // compile.ts: ids and addresses
  [/^duplicate id "/, "duplicate-id"],
  [/^duplicate \S+ gameId "/, "duplicate-gameid"],
  [/ gameId "[^"]*" is not a legal address/, "invalid-gameid"],
  [/ address "[^"]*" cannot contain "\/"/, "address-slash"],
  // properties and qualities
  [/^quality "[^"]*" declares no stages/, "quality-no-stages"],
  [/^quality "[^"]*" lists stage "[^"]*" twice$/, "quality-stage-twice"],
  [/^quality "[^"]*" defaults to .*, which is not one of its stages$/, "quality-bad-default"],
  [/^property name "[^"]*" cannot be used \(/, "reserved-property-name"],
  [/^@world\.\w+ declares "(shared|durable)"/, "world-flag"],
  [/^@hand\.\w+ is declared as \w+ on .* and as \w+ on /, "hand-property-type-clash"],
  [/^turn\.seconds must be an integer >= 1/, "turn-seconds"],
  // tags
  [/^"place" is the reserved tag group/, "reserved-tag-group"],
  [/^tag gameId "[^"]*" is used by group "/, "duplicate-tag-gameid"],
  [/^boundBy "[^"]*" must be a @world or @story property reference$/, "boundby-not-ref"],
  [/^boundBy "[^"]*" is not a declared \w+ property$/, "boundby-undeclared"],
  [/^boundBy "[^"]*" is a \w+ property; /, "boundby-type"],
  [/^boundBy "[^"]*" can never name a tag in this group/, "boundby-never-matches"],
  [/^boundBy "[^"]*" may hold .*, which name no tag here/, "boundby-stray-values"],
  [/^"[^"]*" is declared both on the group "[^"]*" and on its tag "/, "tag-property-twice"],
  [/^"[^"]*" has a value here but the group "[^"]*" declares no such property/, "tag-value-undeclared"],
  [/^"[^"]*" is \w+ on the group, so .* is not a value it can start at$/, "tag-value-type"],
  [/^place tag points at a hand that is not in this box \(id /, "dangling-place"],
  [/points at a tag group that is not in this box \(id |^binds a tag group that is not in this box \(id |^asks each hand to choose from a tag group that is not in this box \(id /, "dangling-tag-group"],
  [/^points at a tag that is not in "[^"]*" \(id |^binds a tag that is not in "[^"]*" \(id |^the tag chosen for "[^"]*" is not in that group \(id /, "dangling-tag"],
  // cards
  [/^field "[^"]*" is not in the box's /, "unknown-field"],
  [/^field "[^"]*" does not match its declared type "/, "field-type"],
  [/^redraw is the string .*, so its cooldown never fires: write it as the number /, "redraw-string"],
  [/^redraw must be "always", "never" or a whole number of turns/, "redraw-invalid"],
  [/^copies must be an integer >= 1/, "copies"],
  [/^sharedCopies must be an integer >= 1/, "shared-copies"],
  [/^sharedCopies \(\d+\) is below copies \(/, "shared-copies-below"],
  [/^sharedCopies is set but the card is not shared/, "shared-copies-unused"],
  [/^durable, but its redraw is /, "durable-redraw"],
  // outcomes: changes
  [/^change target "[^"]*" is not a property reference/, "change-not-ref"],
  [/^change target "[^"]*" is the chosen tag of group "/, "change-chosen-tag"],
  [/^change target "[^"]*" is not a property any tag, hand or hand template in this box declares$|^change target "[^"]*" is not a declared property$/, "unknown-property"],
  [/^change target "[^"]*" is read-only to the story/, "change-read-only"],
  // decks
  [/^durable, but nothing in it is spent for good/, "durable-deck-idle"],
  [/^timed, but nothing in it rests/, "timed-deck-idle"],
  // hands and templates
  [/^"place" cannot be filled from a property/, "place-from-property"],
  [/^"[^"]*" for "[^"]*" must be a @hand, @world or @story property reference$/, "hole-not-ref"],
  [/^"[^"]*" for "[^"]*" is not a property this hand declares$|^"[^"]*" for "[^"]*" is not a declared \w+ property$/, "hole-undeclared"],
  [/^"[^"]*" for "[^"]*" is a \w+ property; a hole filled from a property needs/, "hole-type"],
  [/^"[^"]*" for "[^"]*" can never name a tag in that group/, "hole-never-matches"],
  [/^"[^"]*" for "[^"]*" may hold .*, which name no tag there/, "hole-stray-values"],
  [/^binds "[^"]*", a property reference; a template's own bindings/, "template-binds-ref"],
  [/^binds "[^"]*" and also asks each hand to choose one/, "template-binds-and-asks"],
  [/^a hand carries exactly one of template \/ rule$/, "hand-template-or-rule"],
  [/^uses a hand template that is not in this box \(id /, "dangling-template"],
  [/^nothing chosen for the tag group .*: a hand fills every hole/, "hand-hole-unfilled"],
  [/^chooses a tag for .*, which the template "[^"]*" does not ask for$/, "hand-choice-unasked"],
  // the play ladder and the coverage block
  [/^this project is set to \w+ play; /, "play-ladder"],
  [/^coverage driver ref must name a declared @world property/, "driver-ref"],
  [/^coverage driver kind must be "initial" or "recurring"$/, "driver-kind"],
  [/^coverage driver value .* does not match the property's type "/, "driver-value-type"],
  // expressions: the compiler prefixes the field ("condition: ...", "change
  // @story.gold: ...") to whatever the expression validator said. An
  // unresolved reference is the one shape that has its own idea; the rest are
  // one code, and the entry passes the validator's sentence through.
  [/^[^:]+: unresolved (\w+ )?property reference '/, "unknown-property"],
  [/^[^:]+: /, "expression"],
];

/** The code for a compiler message, from its shape; undefined for one the
 *  table has never seen, which `describeProblem` then shows titled and raw. */
export function problemCode(message: string): string | undefined {
  for (const [shape, code] of SHAPES) if (shape.test(message)) return code;
  return undefined;
}

// --- the specifics, read back out of the message --------------------------------

/** The n-th capture of `re` over the message, or "" when it does not match. */
const pick = (p: ProblemLike, re: RegExp, n = 1): string => re.exec(p.message)?.[n] ?? "";
/** The file a path-only problem is about, as the reader sees it in the folder. */
const fileName = (p: ProblemLike): string => p.path?.split("/").pop() ?? "this file";
/** A shard field, in the words the editor uses for it. */
const fieldWord = (label: string): string => {
  switch (label) {
    case "condition": return "condition";
    case "outcome condition": return "outcome condition";
    case "deck gate": return "gate";
    case "template condition": return "condition";
    case "hand condition": return "rule";
    case "priority": return "priority";
    default: return label;
  }
};
const quoted = (s: string): string => `“${s}”`;
/** A JSON value the compiler embedded, spoken: `"foo"` reads as “foo”. */
const spoken = (raw: string): string => {
  const trimmed = raw.trim();
  if (/^".*"$/.test(trimmed)) return quoted(trimmed.slice(1, -1));
  return trimmed;
};

/** `${name}'s` for a titled thing; "Its" when there is no title, because
 *  "This's" is not a word. */
const owner = (p: ProblemLike): string => (p.title ? `${problemName(p)}’s` : "Its");
/** The id a dangling reference points at, from the compiler's "(id ...)"
 *  tail: the one place an internal id is shown, because the thing it named
 *  no longer has a name to give. Undefined when the message has no such tail. */
export const danglingId = (message: string): string | undefined => /\(id ([^)]+)\)$/.exec(message)?.[1];
/** "(id ...)" for the entry's text: the reference is DANGLING, so the raw id
 *  is the honest thing to show, and the holder is named beside it. */
const idTail = (p: ProblemLike): string => (p.where ? ` (id ${p.where})` : "");

/**
 * Storyletter's table, over the shell's shared floor. Every code
 * `problemCode` can return has an entry here (problem-copy.test.ts checks).
 * Each entry is one plain sentence naming the item, and a next step where
 * there is one thing to do.
 */
export const STORYLETTER_PROBLEM_COPY: ProblemCopyTable = {
  ...defaultProblemCopy,

  // --- files and folders -----------------------------------------------------
  "unparseable": (p) => ({
    text: `The file ${fileName(p)} can’t be read: ${pick(p, /^unparseable JSON5: (.*)$/)}.`,
    next: "Fix it in a text editor, then reopen the project.",
  }),
  "not-an-object": (p) => ({
    text: `The file ${fileName(p)} should hold one object at the top level.`,
    next: "Fix it in a text editor, then reopen the project.",
  }),
  "wrong-schema": (p) => ({
    text: `The file ${fileName(p)} says it’s ${pick(p, /^schema tag (.*) is not (".*")$/)}, but this folder expects ${pick(p, /^schema tag (.*) is not (".*")$/, 2)}.`,
    next: "Move it where it belongs, or fix its schema tag.",
  }),
  "project-count": (p) => ({
    text: `This project has ${pick(p, /found (\d+)$/)} project files at its root; it needs exactly one.`,
    next: "Remove the extra ones.",
  }),
  "box-without-shard": (p) => ({
    text: `The folder ${fileName(p)} has no box file in it.`,
    next: "Add a box.storyletbox, or remove the folder.",
  }),
  "stale-view-map": (p) => (p.message.includes("still carries a copy")
    ? { text: "An old copy of the map is still in the view file; it’s ignored.", next: "Run storyletengine format to remove it." }
    : { text: "This project’s map is still stored the old way.", next: "Open the map once in Storyletter, or run storyletengine format, to move it." }),
  "stray-file": (p) => ({
    text: `The file ${fileName(p)} isn’t something Storyletter knows, so it’s ignored.`,
    next: "Move it out of the project, or delete it.",
  }),

  // --- ids and addresses -----------------------------------------------------
  "duplicate-id": (p) => ({
    text: `${problemName(p)} shares its internal id with something in ${pick(p, /\(also in (.*)\)$/)}.`,
    next: "Duplicate it from Storyletter rather than copying the file.",
  }),
  "duplicate-gameid": (p) => ({
    text: `The Game ID ${quoted(pick(p, /gameId "([^"]*)"/))} on ${problemName(p)} is already used in ${pick(p, /\(also in (.*)\)$/)}.`,
    next: "Each one must be unique; change one of them.",
  }),
  "invalid-gameid": (p) => ({
    text: `The Game ID ${quoted(pick(p, /gameId "([^"]*)"/))} on ${problemName(p)} isn’t a legal address.`,
    next: "Use lowercase letters, digits and hyphens, starting and ending with a letter or digit.",
  }),
  "address-slash": (p) => ({
    text: `The address ${quoted(pick(p, /address "([^"]*)"/))} on ${problemName(p)} can’t contain a slash.`,
    next: "Use lowercase letters, digits and hyphens.",
  }),

  // --- properties and qualities ----------------------------------------------
  "quality-no-stages": (p) => ({
    text: `The quality ${quoted(pick(p, /^quality "([^"]*)"/))} on ${problemName(p)} has no stages yet.`,
    next: "A quality is its ladder; add its stages in order.",
  }),
  "quality-stage-twice": (p) => ({
    text: `The quality ${quoted(pick(p, /^quality "([^"]*)"/))} on ${problemName(p)} lists the stage ${quoted(pick(p, /lists stage "([^"]*)" twice$/))} twice.`,
    next: "Remove one.",
  }),
  "quality-bad-default": (p) => ({
    text: `The quality ${quoted(pick(p, /^quality "([^"]*)"/))} on ${problemName(p)} starts at ${spoken(pick(p, /defaults to (.*), which is not/))}, which isn’t one of its stages.`,
    next: "Pick a stage as its starting point.",
  }),
  "reserved-property-name": (p) => ({
    text: `The property name ${quoted(pick(p, /^property name "([^"]*)"/))} on ${problemName(p)} can’t be used (${pick(p, /cannot be used \((.*?)\)\./)}).`,
    next: pick(p, /cannot be used \(.*?\)\.\s*(.+)$/) || "Choose another name.",
  }),
  "world-flag": (p) => ({
    text: `@world.${pick(p, /^@world\.(\w+)/)} is marked ${pick(p, /declares "(\w+)"/)}, but @world is the game’s own state and doesn’t take that flag.`,
    next: "Remove it; the flag belongs on @story, box, deck, hand or tag properties.",
  }),
  "hand-property-type-clash": (p) => ({
    text: `@hand.${pick(p, /^@hand\.(\w+)/)} is a ${pick(p, /declared as (\w+) on/)} on ${pick(p, /declared as \w+ on (.*) and as/)} and a ${pick(p, /and as (\w+) on/)} on ${pick(p, /and as \w+ on (.*);/)}.`,
    next: "@hand composes them into one name, so give both the same type.",
  }),
  "turn-seconds": (p) => ({
    text: `The turn length on ${problemName(p)} must be a whole number of seconds, at least 1.`,
  }),

  // --- tags --------------------------------------------------------------------
  "reserved-tag-group": () => ({
    text: "“place” is the reserved tag group, so a group can’t be called that.",
    next: "Rename this group.",
  }),
  "duplicate-tag-gameid": (p) => ({
    text: `The tag ${quoted(pick(p, /^tag gameId "([^"]*)"/))} on ${problemName(p)} is already used in the group ${quoted(pick(p, /used by group "([^"]*)"$/))}.`,
    next: "Tag names are unique across a box; rename one.",
  }),
  "boundby-not-ref": (p) => ({
    text: `${problemName(p)} is bound to ${quoted(pick(p, /^boundBy "([^"]*)"/))}, which isn’t a @world or @story property.`,
    next: "Bind it to a property reference, like @world.zone.",
  }),
  "boundby-undeclared": (p) => ({
    text: `${problemName(p)} is bound to ${quoted(pick(p, /^boundBy "([^"]*)"/))}, which isn’t declared.`,
    next: "Declare it in the project settings, or fix the name.",
  }),
  "boundby-type": (p) => ({
    text: `${problemName(p)} is bound to ${quoted(pick(p, /^boundBy "([^"]*)"/))}, a ${pick(p, /is a (\w+) property;/)} property; a bound group needs a string or enum whose value names one of its tags.`,
  }),
  "boundby-never-matches": (p) => ({
    text: `${problemName(p)} is bound to ${quoted(pick(p, /^boundBy "([^"]*)"/))}, but none of its values (${pick(p, /\(its values are (.*)\)$/)}) name a tag in the group.`,
    next: "Match the property’s values to the tags, or bind another property.",
  }),
  "boundby-stray-values": (p) => ({
    text: `${problemName(p)} is bound to ${quoted(pick(p, /^boundBy "([^"]*)"/))}, which may hold ${pick(p, /may hold (.*), which name no tag here/)}; none of those name a tag here, so the group goes unbound then and every card is eligible.`,
    next: "Add tags for them, or narrow the property.",
  }),
  "tag-property-twice": (p) => ({
    text: `The property ${quoted(pick(p, /^"([^"]*)"/))} is declared on both the group ${quoted(pick(p, /the group "([^"]*)"/))} and its tag ${quoted(pick(p, /its tag "([^"]*)"/))}.`,
    next: "Declare it once, on the group if every tag has it.",
  }),
  "tag-value-undeclared": (p) => ({
    text: `${problemName(p)} sets ${quoted(pick(p, /^"([^"]*)"/))}, but its group ${quoted(pick(p, /the group "([^"]*)"/))} doesn’t declare that property.`,
    next: "A tag sets values and its group declares them; declare it on the group.",
  }),
  "tag-value-type": (p) => ({
    text: `${quoted(pick(p, /^"([^"]*)"/))} is a ${pick(p, /is (\w+) on the group/)} on the group, so ${spoken(pick(p, /so (.*) is not a value/))} isn’t a value ${problemName(p)} can start at.`,
  }),
  // The dangling four: `where` is the id the reference points at (problemText
  // lifts it out of the message), so "(id ...)" names the thing that has no
  // name any more, never the holder, which is named by its title.
  "dangling-place": (p) => ({
    text: `${owner(p)} place points at a hand that’s no longer in this box${idTail(p)}.`,
    next: "Choose a place for it.",
    dangling: true,
  }),
  "dangling-tag-group": (p) => ({
    text: `${problemName(p)} refers to a tag group that’s no longer in this box${idTail(p)}.`,
    next: "Choose another group, or remove the reference.",
    dangling: true,
  }),
  "dangling-tag": (p) => ({
    text: `${problemName(p)} points at a tag that’s no longer in ${quoted(pick(p, /"([^"]*)"/))}${idTail(p)}.`,
    next: "Pick one of the group’s tags.",
    dangling: true,
  }),

  // --- cards -------------------------------------------------------------------
  "unknown-field": (p) => ({
    text: `${problemName(p)} has a field called ${quoted(pick(p, /^field "([^"]*)"/))} that the box doesn’t declare.`,
    next: "Declare it on the box, or remove the field.",
  }),
  "field-type": (p) => ({
    text: `The field ${quoted(pick(p, /^field "([^"]*)"/))} on ${problemName(p)} should be a ${pick(p, /declared type "([^"]*)"$/)}.`,
  }),
  "redraw-string": (p) => ({
    text: `${owner(p)} redraw is written as text, so its cooldown never fires.`,
    next: `Write it as the number ${pick(p, /write it as the number (\d+)$/)}.`,
  }),
  "redraw-invalid": (p) => ({
    text: `${owner(p)} redraw must be always, never, or a whole number of turns.`,
  }),
  "copies": (p) => ({
    text: `${owner(p)} copies must be a whole number, at least 1.`,
  }),
  "shared-copies": (p) => ({
    text: `${owner(p)} shared copies must be a whole number, at least 1.`,
  }),
  "shared-copies-below": (p) => ({
    text: `${problemName(p)} allows ${pick(p, /^sharedCopies \((\d+)\)/)} shared copies but ${pick(p, /below copies \((\d+)\)/)} per participant; the world can’t hold fewer than one participant may.`,
    next: "Raise shared copies, or lower copies.",
  }),
  "shared-copies-unused": (p) => ({
    text: `${problemName(p)} sets shared copies, but it isn’t shared, so that does nothing.`,
    next: "Mark it shared, or clear the value.",
  }),
  "durable-redraw": (p) => ({
    text: `${problemName(p)} is durable, but its redraw is ${spoken(pick(p, /its redraw is (.*): only/))}; only “never” means anything past the run.`,
    next: "Set redraw to never, or drop durable.",
  }),

  // --- outcomes ----------------------------------------------------------------
  "change-not-ref": (p) => ({
    text: `${problemName(p)} changes ${quoted(pick(p, /^change target "([^"]*)"/))}, which isn’t a property reference.`,
    next: "Write it as @scope.name.",
  }),
  "change-chosen-tag": (p) => ({
    text: `${problemName(p)} tries to change ${quoted(pick(p, /^change target "([^"]*)"/))}, the tag chosen for ${quoted(pick(p, /of group "([^"]*)"/))}; that is what the hand asked for, not state it carries.`,
    next: "Change a property instead.",
  }),
  "unknown-property": (p) => {
    const target = pick(p, /^change target "([^"]*)"/) || pick(p, /property reference '([^']*)'/);
    const label = pick(p, /^([^:]+): unresolved/);
    return {
      text: label
        ? `${owner(p)} ${fieldWord(label)} uses ${target}, which isn’t set up yet.`
        : `${problemName(p)} changes ${target}, which isn’t set up yet.`,
      next: "Declare it in the project settings, or fix the name.",
    };
  },
  "change-read-only": (p) => ({
    text: `${problemName(p)} tries to change ${quoted(pick(p, /^change target "([^"]*)"/))}, which the game owns; the story may read it but not write it.`,
    next: "Remove the change, or make the property writable in the project settings.",
  }),

  // --- decks -------------------------------------------------------------------
  "durable-deck-idle": (p) => ({
    text: `${problemName(p)} is durable, but nothing in it is spent for good: every card can be dealt again.`,
    next: "Set a card’s redraw to never, or drop durable.",
  }),
  "timed-deck-idle": (p) => ({
    text: `${problemName(p)} is timed, but nothing in it rests: every card redraws always, so no cooldown ever reads the clock.`,
    next: "Give a card a cooldown, or drop the timing.",
  }),

  // --- hands and templates -----------------------------------------------------
  "place-from-property": (p) => ({
    text: `${problemName(p)} fills its place from a property, but a place is the hand’s own name, not an axis.`,
    next: "Choose a place directly.",
  }),
  "hole-not-ref": (p) => ({
    text: `${problemName(p)} fills ${quoted(pick(p, /^"[^"]*" for "([^"]*)"/))} from ${quoted(pick(p, /^"([^"]*)" for/))}, which isn’t a @hand, @world or @story property.`,
    next: "Write it as a property reference, like @world.zone.",
  }),
  "hole-undeclared": (p) => ({
    text: `${problemName(p)} fills ${quoted(pick(p, /^"[^"]*" for "([^"]*)"/))} from ${quoted(pick(p, /^"([^"]*)" for/))}, which isn’t declared.`,
    next: "Declare it, or fix the name.",
  }),
  "hole-type": (p) => ({
    text: `${problemName(p)} fills ${quoted(pick(p, /^"[^"]*" for "([^"]*)"/))} from ${quoted(pick(p, /^"([^"]*)" for/))}, a ${pick(p, /is a (\w+) property;/)} property; a hole needs a string or enum whose value names one of the group’s tags.`,
  }),
  "hole-never-matches": (p) => ({
    text: `${problemName(p)} fills ${quoted(pick(p, /^"[^"]*" for "([^"]*)"/))} from ${quoted(pick(p, /^"([^"]*)" for/))}, but none of its values (${pick(p, /\(its values are (.*)\)$/)}) name a tag there.`,
    next: "Match the property’s values to the tags, or fill it from another property.",
  }),
  "hole-stray-values": (p) => ({
    text: `${problemName(p)} fills ${quoted(pick(p, /^"[^"]*" for "([^"]*)"/))} from ${quoted(pick(p, /^"([^"]*)" for/))}, which may hold ${pick(p, /may hold (.*), which name no tag there/)}; none of those name a tag there, so the hole goes unbound then and every card is eligible.`,
    next: "Add tags for them, or narrow the property.",
  }),
  "template-binds-ref": (p) => ({
    text: `${problemName(p)} binds ${quoted(pick(p, /^binds "([^"]*)"/))}, a property reference, but a template’s bindings are the same for every instance.`,
    next: "Put a hole that moves on the hand instead.",
  }),
  "template-binds-and-asks": (p) => ({
    text: `${problemName(p)} both binds ${quoted(pick(p, /^binds "([^"]*)"/))} and asks each hand to choose one.`,
    next: "A template can do either, not both.",
  }),
  "hand-template-or-rule": (p) => ({
    text: `${problemName(p)} needs either a template or a rule: not both, and not neither.`,
  }),
  "dangling-template": (p) => ({
    text: `${problemName(p)} uses a hand template that’s no longer in this box${idTail(p)}.`,
    next: "Choose a template.",
    dangling: true,
  }),
  "hand-hole-unfilled": (p) => ({
    text: `${problemName(p)} hasn’t chosen a tag for ${pick(p, /^nothing chosen for the tag group (.*): a hand/)}.`,
    next: "A hand fills every hole its template declares; pick one.",
  }),
  "hand-choice-unasked": (p) => ({
    text: `${problemName(p)} chooses a tag for ${pick(p, /^chooses a tag for (.*), which the template/)}, which its template ${quoted(pick(p, /the template "([^"]*)" does not/))} doesn’t ask for.`,
    next: "Remove the choice, or add the group to the template.",
  }),

  // --- the play ladder and the coverage block ----------------------------------
  "play-ladder": (p) => {
    // Already a sentence with its remedy, from the compiler's own ladder copy.
    const [, rung, rest] = /^this project is set to (\w+) play; (.*)$/.exec(p.message) ?? [];
    const tail = rest ?? p.message;
    return { text: `This project is set to ${rung} play; ${tail}${/[.!?]$/.test(tail) ? "" : "."}` };
  },
  "driver-ref": () => ({
    text: "A coverage driver names a property that isn’t a declared @world property.",
    next: "Only the game’s own state can be driven; pick a @world property.",
  }),
  "driver-kind": () => ({
    text: "A coverage driver’s kind must be initial or recurring.",
  }),
  "driver-value-type": (p) => ({
    text: `A coverage driver sets ${spoken(pick(p, /^coverage driver value (.*) does not match/))}, which isn’t a ${pick(p, /property's type "([^"]*)"$/)}.`,
  }),

  // --- expressions -------------------------------------------------------------
  "expression": (p) => {
    const [, label, detail] = /^([^:]+): (.*)$/.exec(p.message) ?? [];
    return {
      text: `${owner(p)} ${fieldWord(label ?? "expression")} doesn’t hold up: ${detail ?? p.message}.`,
      next: "Open it in the expression editor.",
    };
  },
};

/** Every code the classifier can produce, for the test that checks the table
 *  covers them all. */
export const PROBLEM_CODES: readonly string[] = [...new Set(SHAPES.map(([, code]) => code))];

/** The problems bar's line for `p`: the sentence and its next step, from the
 *  table, naming the item by the title the caller resolved. A message the
 *  table has never seen comes back raw but titled, and never with a `[where]`
 *  on the end. */
export function problemText(p: Problem, names?: ProblemNames): string {
  // The compiler's `where` is the HOLDER (a card, a hand); the shell's is the
  // reference an entry may print as "(id ...)". For a dangling reference that
  // is the id in the message's tail; otherwise nothing, because the holder is
  // named by its title and an id is not something the reader can look for.
  const where = danglingId(p.message);
  return problemLine({
    code: problemCode(p.message),
    message: p.message,
    path: p.path,
    ...(where !== undefined ? { where } : {}),
    ...(names?.title !== undefined ? { title: names.title } : {}),
  }, STORYLETTER_PROBLEM_COPY);
}
