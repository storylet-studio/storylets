// @vitest-environment jsdom
// The push dialog: a note, where the project stands, and the one refusal with a
// way through it.
//
// Expectations hand-written from what the dialog promises (design/engine-server.md
// 9.1): Push is not offered while any break is unticked, a break's own words are
// what is shown, and the key that goes back is the far end's, never ours.

import { beforeAll, describe, expect, it } from "vitest";
import { askLeave, askPush, settleLeave } from "./server-dialog.js";

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

describe("the leaving prompt", () => {
  const leaveDialog = (): HTMLDialogElement | null =>
    document.querySelector("dialog.leave-dialog");
  const leaveButton = (label: string): HTMLButtonElement =>
    [...leaveDialog()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
  /** One turn of the event loop, which is all a zero-length hold needs. */
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  const QUITTING = {
    message: "This Room: 3 edits unpushed",
    detail: "This Room has edits the server has not seen.",
    buttons: ["Push to server", "Quit without pushing", "Cancel"],
    defaultId: 0, cancelId: 2,
  };

  it("wears the app's own dialog, with the named status line as its headline", async () => {
    const answered = askLeave(QUITTING);
    // The push dialog's classes, because the app has one dialog style and the
    // only native surfaces are the file and folder pickers.
    expect(leaveDialog()!.classList.contains("confirm-dialog")).toBe(true);
    // It NAMES its project: the one moment it is asked is the moment a second
    // project is arriving over this one.
    expect(leaveDialog()!.querySelector(".confirm-title")?.textContent)
      .toBe("This Room: 3 edits unpushed");
    expect(leaveDialog()!.querySelector(".confirm-body")?.textContent)
      .toBe("This Room has edits the server has not seen.");
    leaveButton("Cancel").click();
    expect(await answered).toBe(2);
    // The dialog is HELD past the click, because main answers it: a push takes
    // as long as the far end takes. Nothing to say means it just goes.
    expect(leaveDialog()).not.toBeNull();
    settleLeave({ holdMs: 0 });
    expect(leaveDialog()).toBeNull();
  });

  it("answers with the INDEX of the button, whichever it is", async () => {
    const pushed = askLeave(QUITTING);
    leaveButton("Push to server").click();
    expect(await pushed).toBe(0);
    settleLeave({ holdMs: 0 });

    const left = askLeave(QUITTING);
    leaveButton("Quit without pushing").click();
    expect(await left).toBe(1);
    settleLeave({ holdMs: 0 });
  });

  it("turns into the revision the push landed as, and holds it there", async () => {
    // The person is leaving, and the last thing they see must be that the work
    // is safe. The buttons go at the click; the closing word replaces the
    // question, and the dialog takes itself down after the same beat main is
    // waiting out.
    const answered = askLeave(QUITTING);
    leaveButton("Push to server").click();
    expect(await answered).toBe(0);
    expect(leaveDialog()!.querySelector(".confirm-actions"), "the buttons have been used").toBeNull();

    settleLeave({ message: "Pushed as revision 12", holdMs: 0 });
    expect(leaveDialog()!.querySelector(".confirm-title")?.textContent).toBe("Pushed as revision 12");
    expect(leaveDialog()!.querySelector(".confirm-body")).toBeNull();
    expect([...leaveDialog()!.querySelectorAll("button")]).toEqual([]);
    await tick();
    expect(leaveDialog()).toBeNull();
  });

  it("names the act it is in the middle of, and offers no push when offline", async () => {
    const closing = askLeave({
      message: "This Room: 1 edit unpushed",
      detail: "This Room has edits the server has not seen, and the server cannot be reached.",
      buttons: ["Close without pushing", "Cancel"],
      defaultId: 0, cancelId: 1,
    });
    expect([...leaveDialog()!.querySelectorAll("button")].map((b) => b.textContent))
      .toEqual(["Close without pushing", "Cancel"]);
    leaveButton("Close without pushing").click();
    expect(await closing).toBe(0);
    settleLeave({ holdMs: 0 });
  });

  it("offers one way out of a refusal, and it is not a way out", async () => {
    // The refusal prompt is this same dialog with the far end's sentence in it.
    const answered = askLeave({
      message: "This Room: 1 edit unpushed",
      detail: "pull as designer to change the shape",
      buttons: ["Stay"],
      defaultId: 0, cancelId: 0,
    });
    expect(leaveDialog()!.querySelector(".confirm-body")?.textContent)
      .toBe("pull as designer to change the shape");
    expect([...leaveDialog()!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Stay"]);
    leaveButton("Stay").click();
    expect(await answered).toBe(0);
    settleLeave({ holdMs: 0 });
  });

  it("reads Esc as Cancel: main is waiting on an index, not on silence", async () => {
    const answered = askLeave(QUITTING);
    leaveDialog()!.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(await answered).toBe(2);
    settleLeave({ holdMs: 0 });
  });

  it("ignores a last word when there is no dialog to say it to", () => {
    // Main fell back to the native box, so nothing here was ever drawn.
    expect(() => settleLeave({ message: "Pushed as revision 3", holdMs: 0 })).not.toThrow();
    expect(leaveDialog()).toBeNull();
  });
});
