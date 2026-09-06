// @vitest-environment jsdom
// The push dialog: a note, where the project stands, and the one refusal with a
// way through it.
//
// Expectations hand-written from what the dialog promises (design/engine-server.md
// 9.1): Push is not offered while any break is unticked, a break's own words are
// what is shown, and the key that goes back is the far end's, never ours.

import { beforeAll, describe, expect, it } from "vitest";
import { askPush } from "./server-dialog.js";

// jsdom carries the <dialog> element but not its modal behaviour, so the two
// methods the dialog calls are supplied here. Nothing under test depends on
// modality: what is tested is what the dialog asks and what it answers with.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto["showModal"] !== "function") {
    proto["showModal"] = function (this: HTMLDialogElement) { this.open = true; };
  }
  if (typeof proto["close"] !== "function") {
    proto["close"] = function (this: HTMLDialogElement) { this.open = false; };
  }
});

const dialog = (): HTMLDialogElement => document.querySelector("dialog.push-dialog")!;
const button = (label: string): HTMLButtonElement =>
  [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
const ticks = (): HTMLInputElement[] => [...dialog().querySelectorAll<HTMLInputElement>(".push-tick")];
const note = (): HTMLInputElement => dialog().querySelector<HTMLInputElement>(".confirm-body input[type=text]")!;

const tick = (box: HTMLInputElement): void => {
  box.checked = true;
  box.dispatchEvent(new Event("change"));
};

const BREAKS = [
  { key: "hand:h_inn", message: "A station deals this hand." },
  { key: "box:b_village", message: "This box is ticked every 60s." },
];

describe("the push dialog", () => {
  it("sends the note, and nothing to acknowledge when there was nothing to tick", async () => {
    const answered = askPush({ status: "3 edits unpushed" });
    note().value = "  the second act  ";
    button("Push").click();
    // Trimmed, because a note is for reading and a stray space is not part of it.
    expect(await answered).toEqual({ note: "the second act", acknowledge: [] });
  });

  it("says where the project stands, in the words the menu uses", async () => {
    const answered = askPush({ status: "3 edits unpushed" });
    expect(dialog().querySelector(".push-status")?.textContent).toBe("3 edits unpushed");
    button("Cancel").click();
    expect(await answered).toBeNull();
  });

  it("keeps Push back until every break is ticked, then names the ticked ones", async () => {
    const answered = askPush({
      status: "In sync",
      note: "kept from the first attempt",
      refusal: "That push breaks 2 things this end depends on.",
      breaks: BREAKS,
    });
    // The far end's own sentences, one tick each, and its refusal above them.
    expect(dialog().querySelector(".push-refusal")?.textContent)
      .toBe("That push breaks 2 things this end depends on.");
    expect([...dialog().querySelectorAll(".push-break span")].map((e) => e.textContent))
      .toEqual(["A station deals this hand.", "This box is ticked every 60s."]);
    // The note the author already typed is still there: a refusal must not cost
    // them what they wrote.
    expect(note().value).toBe("kept from the first attempt");

    expect(button("Push").disabled).toBe(true);
    tick(ticks()[0]!);
    expect(button("Push").disabled, "one of two ticked is not an acknowledgement").toBe(true);
    tick(ticks()[1]!);
    expect(button("Push").disabled).toBe(false);

    button("Push").click();
    expect(await answered).toEqual({
      note: "kept from the first attempt",
      acknowledge: ["hand:h_inn", "box:b_village"],
    });
  });

  it("closes on Cancel with the breaks unacknowledged, so nothing is sent", async () => {
    const answered = askPush({ status: "In sync", breaks: BREAKS });
    tick(ticks()[0]!);
    button("Cancel").click();
    expect(await answered).toBeNull();
    expect(document.querySelector("dialog.push-dialog")).toBeNull();
  });
});
