// A Storylet extension's problems in the bar, worded for the writer through the family's rules
// (@wildwinter/app-shell/extension-copy) with Storyletter's names for its items.

import { describe, expect, it } from "vitest";
import { extensionProblemLine } from "./extension-problems.js";
import type { ProjectDto } from "../../shared/api.js";

const project = {
  boxes: [],
  extensions: [{
    id: "probe", name: "Probe", version: "1.1.0",
    targets: {
      card: {
        fields: [{ name: "note", type: "text", label: "Note" }, { name: "cue", type: "record", label: "cue", fields: [{ name: "sound", type: "text", label: "sound" }] }],
      },
      project: { fields: [{ name: "places", type: "list", label: "Places", of: { type: "text" } }] },
    },
    values: {},
  }],
  extensionNodes: { card: [{ id: "c_bell", label: "bell" }], outcome: [{ id: "o_ring", label: "bell/ring" }] },
} as unknown as ProjectDto;
const line = (message: string, detail?: string, where?: string) =>
  extensionProblemLine({ message, extension: "probe", ...(detail ? { detail } : {}), ...(where ? { where } : {}) }, project);

describe("a Storylet extension's problem for the writer", () => {
  it("words a value's problem by its code, naming the item and the field as the author knows them", () => {
    expect(line('entries.card.c_bell.cue.sound: "cue.sound" is required and not set', "required")).toBe("Probe: The card “bell” needs a sound in cue.");
    expect(line('entries.card.c_bell.act: "act" is "opening", a stage this extension has since renamed "setup"', "renamed-stage"))
      .toBe("Probe: Act on the card “bell” is “opening”, a stage Probe has since renamed “setup”. Pick “setup” to update it.");
    expect(line('entries.card.c_gone: an entry for card "c_gone", which no longer exists; it is kept, and not compiled', "orphan"))
      .toBe("Probe: There are values for a card that isn't in the project any more. They're kept, but your game won't get them.");
  });

  it("words the project's own checks", () => {
    expect(line('the project takes the Storylet extension "probe", but has no manifest for it at extensions/probe.extension.json; its data is left as it is, and not compiled'))
      .toBe("This project takes the extension “probe”, but its manifest isn't in the extensions folder. Its data is kept, but your game won't get it.");
    expect(line(`the project's pin for "probe" has settings, which extensions no longer have; they're ignored`))
      .toBe("Probe: The project still holds settings for this extension, which extensions don't have any more. They're ignored.");
  });

  it("words a pick's problems: a value not among its choices, one two sources hold, and the project's clash", () => {
    expect(line('entries.card.c_bell.note: "note" is "Qauy", which is not one of its choices', "not-a-choice"))
      .toBe("Probe: Note on the card “bell” is “Qauy”, which isn't one of its choices. Pick one on its page.");
    expect(line('entries.card.c_bell.note: "note" is "c_tide", which is a card and an entry of the list "places"', "pick-ambiguous"))
      .toBe("Probe: Note on the card “bell” is “c_tide”, which is a card and an entry of the list “places”, so it's ambiguous. Rename one of them.");
    expect(line('the Storylet extension "probe": "Gate" is a card and an entry of the list "places", so a value naming it is ambiguous', "pick-clash"))
      .toBe("Probe: “Gate” is a card and an entry of the list “Places”, so a value naming it is ambiguous. Rename one of them.");
  });

  it("leaves a problem with no extension, or a shape it does not know, to the table", () => {
    expect(extensionProblemLine({ message: "condition: oops" }, project)).toBeUndefined();
    expect(line("manifest targets.storylets.card.fields[2].max: the range runs from 20 down to 10", "range")).toBeUndefined();
  });
});
