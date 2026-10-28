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
  hostScopes: [{ token: "world", declarations: [] }], story: [], drivers: [],
  bundlePath: "build/saltmarsh.storyletsc", metadata: "full", exportMap: false,
  playAdvancesTurns: 1, play: "solo", ladder: { solo: [], shared: [] },
  warnUnreadWrites: false, patterProject: "", vcs: "",
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

describe("Project Settings, the Patterpad review (2026-10-07)", () => {
  it("draws its switches as the family's settings toggle, with the sentence as the field's hint", async () => {
    document.body.replaceChildren();
    const panel = createProjectSettings(studio(), () => {}, () => {}, () => false);
    panel.open();
    const frame = await opened();
    const toggle = [...frame.querySelectorAll<HTMLElement>(".shell-toggle")].find((t) => t.textContent?.includes("Warn about unread state"));
    expect(toggle).toBeDefined();
    const box = toggle!.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    const hint = document.getElementById(box.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toContain("no condition reads");
    expect(frame.querySelector(".set-inline")).toBeNull();
    expect(frame.querySelector(".shell-inline input")).not.toBeNull();
  });

  it("stays open with the edits in it when the save is refused, saying why", async () => {
    document.body.replaceChildren();
    const said: string[] = [];
    let saved = 0;
    const panel = createProjectSettings(studio(), () => { saved++; }, (msg) => said.push(msg), () => false);
    panel.open();
    const frame = await opened();
    const name = frame.querySelector<HTMLInputElement>(".settings-panels input")!;
    name.value = "Saltmarsh, renamed";
    name.dispatchEvent(new Event("input"));
    frame.querySelector<HTMLButtonElement>(".settings-save")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(said).toEqual(["not reached in these tests"]);
    expect(saved).toBe(0);
    expect(frame.open).toBe(true);
    expect(name.value).toBe("Saltmarsh, renamed");
  });
});

describe("Project Settings > Game scopes (host scopes like Patter's)", () => {
  const withPlayer = (): ProjectSettingsDto => ({
    ...settings(),
    hostScopes: [
      { token: "world", declarations: [{ name: "danger", type: "number", default: "0" }] },
      { token: "player", writable: false, declarations: [{ name: "hp", type: "number", default: "10" }] },
    ],
    drivers: [{ ref: "@player.hp", kind: "recurring", cadence: "sometimes", values: [1, 5] }],
  });
  const host = (dto: ProjectSettingsDto, saved: ProjectSettingsDto[] = []): StudioApi => ({
    projectSettings: async () => dto,
    saveProjectSettings: async (d: ProjectSettingsDto) => { saved.push(structuredClone(d)); return { error: "stop here" }; },
    proposeDrivers: async () => [],
    stageGates: async () => 0,
  } as unknown as StudioApi);
  const panelOf = (frame: HTMLDialogElement): HTMLElement =>
    [...frame.querySelectorAll<HTMLElement>(".settings-panels > *")].find((p) => p.querySelector(".host-scopes")) ?? frame;
  const save = async (frame: HTMLDialogElement): Promise<void> => {
    frame.querySelector<HTMLButtonElement>(".settings-save")!.click();
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };

  it("draws @world first with a fixed name, then each other scope with its own", async () => {
    document.body.replaceChildren();
    createProjectSettings(host(withPlayer()), () => {}, () => {}).open("world");
    const frame = await opened();
    expect([...frame.querySelectorAll(".settings-tab")].some((t) => t.textContent === "Game scopes")).toBe(true);
    const blocks = [...panelOf(frame).querySelectorAll<HTMLElement>(".host-scope")];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.querySelector("h3")!.textContent).toBe("@world");
    expect(blocks[0]!.querySelector(".host-scope-token")).toBeNull();
    expect(blocks[0]!.textContent).not.toContain("Any name, unchecked");
    expect(blocks[1]!.querySelector<HTMLInputElement>(".host-scope-token")!.value).toBe("player");
    // The scope's own Read-only, ticked from the DTO.
    const ro = [...blocks[1]!.querySelectorAll<HTMLElement>(".shell-toggle")].find((t) => t.textContent?.includes("Read-only to the story"))!;
    expect(ro.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
    // The driver offers the scopes as a choice now there are two.
    expect(panelOf(frame).querySelector<HTMLSelectElement>("select.set-scope")!.value).toBe("player");
  });

  it("adds a scope, makes it opaque, and saves it with the rest", async () => {
    document.body.replaceChildren();
    const saved: ProjectSettingsDto[] = [];
    createProjectSettings(host(withPlayer(), saved), () => {}, () => {}).open("world");
    const frame = await opened();
    const panel = panelOf(frame);
    [...panel.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "+ Add scope")!.click();
    const token = [...panel.querySelectorAll<HTMLInputElement>(".host-scope-token")].at(-1)!;
    token.value = "weather";
    token.dispatchEvent(new Event("input"));
    const block = token.closest<HTMLElement>(".host-scope")!;
    const opaque = [...block.querySelectorAll<HTMLElement>(".shell-toggle")].find((t) => t.textContent?.includes("Any name, unchecked"))!;
    const box = opaque.querySelector<HTMLInputElement>("input")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect([...panel.querySelectorAll<HTMLElement>(".host-scope")].at(-1)!.textContent).toContain("Any @weather name is accepted");
    await save(frame);
    expect(saved[0]!.hostScopes.map((h) => [h.token, h.opaque === true])).toEqual([["world", false], ["player", false], ["weather", true]]);
  });

  it("won't save a scope named for the engine's own, and says why", async () => {
    document.body.replaceChildren();
    const saved: ProjectSettingsDto[] = [];
    createProjectSettings(host(withPlayer(), saved), () => {}, () => {}).open("world");
    const frame = await opened();
    const token = panelOf(frame).querySelector<HTMLInputElement>(".host-scope-token")!;
    token.value = "story";
    token.dispatchEvent(new Event("input"));
    expect(token.classList.contains("illegal")).toBe(true);
    expect(token.dataset.tip).toContain("Storylet Engine's own scope");
    await save(frame);
    expect(saved).toEqual([]);
  });

  it("removes a scope", async () => {
    document.body.replaceChildren();
    const saved: ProjectSettingsDto[] = [];
    createProjectSettings(host(withPlayer(), saved), () => {}, () => {}).open("world");
    const frame = await opened();
    const block = panelOf(frame).querySelectorAll<HTMLElement>(".host-scope")[1]!;
    block.querySelector<HTMLButtonElement>("button[title='Remove scope'], button[aria-label='Remove scope']")!.click();
    expect(panelOf(frame).querySelectorAll(".host-scope")).toHaveLength(1);
    // The driver feeding @player.hp now names a scope that isn't there, which holds Save.
    await save(frame);
    expect(saved).toEqual([]);
    panelOf(frame).querySelector<HTMLButtonElement>("button[title='Remove driver'], button[aria-label='Remove driver']")!.click();
    await save(frame);
    expect(saved[0]!.hostScopes.map((h) => h.token)).toEqual(["world"]);
  });
});
