// @vitest-environment jsdom
// Project Settings under the key the project was pulled with.
//
// The project file is a SHAPE shard, so an author's key may not change it
// (design/engine-server.md 9.1). It used to let the author type and then refuse
// on Save with the far end's sentence as a toast; this holds it to greying the
// fields first, taking Save away, and saying why in the same words every other
// read-only document says it in.

import { beforeAll, describe, expect, it } from "vitest";
import { createProjectSettings } from "./project-settings.js";
import type { ProjectSettingsDto, StudioApi } from "../../shared/api.js";

// jsdom carries <dialog> but not its modal behaviour; the settings frame is
// otherwise ordinary DOM, which is what is under test here.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto["showModal"] !== "function") {
    proto["showModal"] = function (this: HTMLDialogElement) { this.open = true; };
  }
  if (typeof proto["close"] !== "function") {
    proto["close"] = function (this: HTMLDialogElement) { this.open = false; };
  }
});

const settings = (): ProjectSettingsDto => ({
  name: "Saltmarsh", version: "0.1.0",
  world: [], story: [], drivers: [],
  bundlePath: "build/saltmarsh.storyletsc", metadata: "full", exportMap: false,
  playAdvancesTurns: 1, play: "solo", ladder: { solo: [], shared: [] },
  warnUnreadWrites: false,
});

/** Enough of the bridge for this dialog: it reads the settings and, on Save,
 *  writes them. Nothing else here talks to main. */
const studio = (): StudioApi => ({
  projectSettings: async () => settings(),
  saveProjectSettings: async () => ({ error: "not reached in these tests" }),
} as unknown as StudioApi);

/** Let the dialog's own `await studio.projectSettings()` settle. */
const opened = async (): Promise<HTMLDialogElement> => {
  await Promise.resolve();
  await Promise.resolve();
  return document.querySelector<HTMLDialogElement>("dialog.settings-dialog")!;
};

const fields = (frame: HTMLDialogElement): HTMLInputElement[] =>
  [...frame.querySelectorAll<HTMLInputElement>(".settings-panels input")];

describe("Project Settings under an author's key", () => {
  it("opens to be read: greyed fields, no Save, and the reason", async () => {
    const panel = createProjectSettings(studio(), () => {}, () => {}, () => true);
    panel.open();
    const frame = await opened();

    expect(fields(frame).length, "the General tab has fields to grey").toBeGreaterThan(0);
    expect(fields(frame).every((f) => f.disabled)).toBe(true);
    expect(frame.querySelector<HTMLButtonElement>(".settings-save")!.hidden).toBe(true);
    expect(frame.querySelector(".vc-lock")?.textContent)
      .toContain("pull as designer to change the shape");
    // Reading the OTHER tabs is the whole of what a read-only settings dialog
    // is for, so the rail is not greyed with the fields.
    expect([...frame.querySelectorAll<HTMLButtonElement>(".settings-tab")].some((t) => t.disabled)).toBe(false);
  });

  it("is an ordinary dialog under a designer's key, and for a project with no server", async () => {
    document.body.replaceChildren();
    const panel = createProjectSettings(studio(), () => {}, () => {}, () => false);
    panel.open();
    const frame = await opened();
    expect(fields(frame).some((f) => f.disabled)).toBe(false);
    expect(frame.querySelector<HTMLButtonElement>(".settings-save")!.hidden).toBe(false);
    expect(frame.querySelector(".vc-lock")).toBeNull();
  });

  it("takes the rule back off when the same dialog is opened again", async () => {
    document.body.replaceChildren();
    let author = true;
    const panel = createProjectSettings(studio(), () => {}, () => {}, () => author);
    panel.open();
    let frame = await opened();
    expect(fields(frame).every((f) => f.disabled)).toBe(true);

    // A pull as designer, then the same dialog: the fields it greyed are new
    // ones (the shell re-mounts every section), and the notice goes with them.
    author = false;
    panel.open();
    frame = await opened();
    expect(fields(frame).some((f) => f.disabled)).toBe(false);
    expect(frame.querySelector<HTMLElement>(".vc-lock")!.hidden).toBe(true);
    expect(frame.querySelector<HTMLButtonElement>(".settings-save")!.hidden).toBe(false);
  });
});
