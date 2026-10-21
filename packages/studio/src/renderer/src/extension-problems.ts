// ---------------------------------------------------------------------------
// A Storylet extension's problems, worded for the writer: "Probe: The card
// “bell” needs a sound in cue." The rules are the family's, in the shell
// (`@wildwinter/app-shell/extension-copy`, Patterpad's first), so the two apps
// read alike; what is Storyletter's is passed in: how it names a card or a tag,
// its words for its node kinds, and that a value is changed on the item's page.
// The project's own checks (the pin and the manifest) are worded here
// from their shapes, as Patterpad words its own. A shape this does not know
// stands as the compiler said it.
// ---------------------------------------------------------------------------

import { entryProblemLine, extensionLine, quoted } from "@wildwinter/app-shell/extension-copy";
import type { FieldWordsDecl } from "@wildwinter/app-shell/extension-copy";
import type { Problem, ProjectDto } from "../../shared/api.js";

const KIND_WORD: Record<string, string> = {
  box: "box", deck: "deck", card: "card", outcome: "outcome", tag: "tag", tagGroup: "tag group",
  hand: "hand", handTemplate: "hand template", project: "project",
};
const kindWord = (kind: string): string => KIND_WORD[kind] ?? kind;
const PLACE = "on its page";

/** A node as the author knows it: "the card “bell”", "the outcome “ring” on “bell”", "the project". */
function nodePhrase(project: ProjectDto | undefined, kind: string, id: string): string {
  if (kind === "project") return "the project";
  const label = project?.extensionNodes?.[kind]?.find((n) => n.id === id)?.label;
  if (label === undefined) return `the ${kindWord(kind)} ${id}`;
  if (kind === "outcome") {
    const [card, outcome] = label.split("/");
    return outcome !== undefined ? `the outcome ${quoted(outcome)} on ${quoted(card!)}` : `the outcome ${quoted(label)}`;
  }
  return `the ${kindWord(kind)} ${quoted(label)}`;
}

/** The bar's line for a Storylet extension's problem, or undefined to show it as the table words it. */
export function extensionProblemLine(p: Pick<Problem, "message" | "detail" | "extension" | "where">, project: ProjectDto | undefined): string | undefined {
  if (p.extension === undefined) return undefined;
  const x = project?.extensions?.find((e) => e.id === p.extension);
  const name = x?.name ?? quoted(p.extension);
  const m = p.message;
  const say = (text: string, next?: string): string | undefined => extensionLine(name, { text, ...(next !== undefined ? { next } : {}) });

  const misplaced = /^entries\.(\w+)\.(\S+) belongs /.exec(m);
  if (misplaced) return say(`The values for ${nodePhrase(project, misplaced[1]!, misplaced[2]!)} are kept in another box's file.`, "They're used all the same.");
  const entry = entryProblemLine(m, p.detail, {
    extension: name, place: PLACE, kindWord,
    fields: (kind) => (x?.targets[kind]?.fields ?? []) as unknown as FieldWordsDecl[],
    node: (kind, id) => nodePhrase(project, kind, id),
  });
  if (entry !== undefined) return entry;

  // The project's side: its pin and its manifest.
  const noManifest = /^the project takes the Storylet extension "([^"]+)", but has no manifest for it/.exec(m);
  if (noManifest) return `This project takes the extension ${quoted(noManifest[1]!)}, but its manifest isn't in the extensions folder. Its data is kept, but your game won't get it.`;
  const version = /^the project takes "[^"]+" (?:at version (\S+)|with no version), but its manifest is version ([^;]+);/.exec(m);
  if (version) {
    return say(version[1] ? `The project takes version ${version[1]}, but the manifest is version ${version[2]}.` : `The project doesn't say which version it takes, and the manifest is version ${version[2]}.`,
      "Run storyletengine format to take the manifest's version.");
  }
  if (/^the project's pin for "[^"]+" has settings, /.test(m)) {
    return say("The project still holds settings for this extension, which extensions don't have any more.", "They're ignored.");
  }
  // A name two of a pick's sources hold: `the Storylet extension "<x>": "<name>" is <sources>, so a value naming it is ambiguous`.
  const pickClash = /^the Storylet extension "[^"]+": "([^"]*)" is (.+), so a value naming it is ambiguous$/.exec(m);
  if (pickClash) {
    const listLabel = (list: string): string => x?.targets["project"]?.fields.find((f) => f.name === list)?.label ?? list;
    const sources = pickClash[2]!.replace(/the list "([^"]*)"/g, (_, list: string) => `the list ${quoted(listLabel(list))}`)
      .replace(/"([^"]*)"/g, (_, s: string) => quoted(s));
    return say(`${quoted(pickClash[1]!)} is ${sources}, so a value naming it is ambiguous.`, "Rename one of them.");
  }
  const notTaken = /^data for the Storylet extension "([^"]+)", which the project does not take/.exec(m);
  if (notTaken) return `There's data here for the extension ${quoted(notTaken[1]!)}, which this project doesn't take. It's kept, but your game won't get it.`;
  return undefined;
}
