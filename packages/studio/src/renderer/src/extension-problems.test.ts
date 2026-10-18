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
        claims: [{ field: "mood", decl: { name: "mood", type: "enum", label: "Mood" } }],
      },
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

  it("words a claimed field's value, and the project's own checks", () => {
    expect(line('field "mood", as the Storylet extension "probe" claims it: the value is "wild", which is not one of its values', "not-a-value", "bell"))
      .toBe("Probe: Mood on the card “bell” is “wild”, which isn't one of its choices. Pick one on its page.");
    expect(line('the project takes the Storylet extension "probe", but has no manifest for it at extensions/probe.extension.json; its data is left as it is, and not compiled'))
      .toBe("This project takes the extension “probe”, but its manifest isn't in the extensions folder. Its data is kept, but your game won't get it.");
    expect(line("the Storylet extension \"probe\" claims the card field \"temper\", which no box declares; set the extension's \"moodField\" setting to the field's name, or declare it"))
      .toBe("Probe: It reads the card field “temper”, which no box declares. Declare it on a box's Card template tab, or give the extension's setting the field's name.");
  });

  it("leaves a problem with no extension, or a shape it does not know, to the table", () => {
    expect(extensionProblemLine({ message: "condition: oops" }, project)).toBeUndefined();
    expect(line("manifest targets.storylets.card.fields[2].max: the range runs from 20 down to 10", "range")).toBeUndefined();
  });
});
