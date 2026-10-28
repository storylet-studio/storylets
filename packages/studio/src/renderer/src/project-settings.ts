// ---------------------------------------------------------------------------
// Project Settings: the storylet-specific sections over the shared settings
// dialog (@wildwinter/app-shell). The framework (dialog, tabs, save gate) and
// the list-editing core (expandableRow / dupGuard / tagChips) come from the
// shell; here we supply the sections - General, Game scopes (carrying the
// coverage drivers that feed them), Export - reading and
// mutating a ProjectSettingsDto that saves whole.
// ---------------------------------------------------------------------------

import { mountHostScopes } from "./host-scopes.js";
import { el, mountSettingsDialog, labelled, labelledToggle, lockControls } from "@wildwinter/app-shell";
import { shapeNotice } from "./vc-view.js";
import { ok } from "./results.js";
import type { SettingsDialog, SettingsSectionHandle } from "@wildwinter/app-shell";
import type { OpenResult, PlayRung, ProjectDto, ProjectSettingsDto, PropertyDeclDto, StageTargetDto, StudioApi, VcsSetting } from "../../shared/api.js";
import { VCS_OPTIONS } from "../../shared/api.js";
import { extensionFields, extensionsFor } from "./extension-rows.js";
import type { ExtensionHost } from "./extension-rows.js";
import { PLAY_RUNGS, RUNG_BLURB, RUNG_LABEL } from "./play-ladder.js";

/** A text field in the Settings dialog, which saves whole on Save rather than
 *  as it is typed (a dialog, not a document; the documents' fields are
 *  fields.ts). */
function dialogField(value: string, onInput: (v: string) => void): HTMLInputElement {
  const input = el("input");
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

/**
 * The version control system (Patterpad's Version control section, in its words): which system
 * Storyletter talks to, and what a switch rewrites. "Not set" is offered only to a project that has
 * not chosen, which every project made before the setting is: Storyletter then works it out from the
 * folders, as it always did, and once a system is chosen the choice is the project's.
 */
function vcsField(d: ProjectSettingsDto): HTMLElement {
  const sel = el("select");
  if (d.vcs === "") sel.append(new Option("Not set (found from the folders)", ""));
  for (const [value, label] of VCS_OPTIONS) sel.append(new Option(label, value));
  sel.value = d.vcs;
  sel.addEventListener("change", () => { d.vcs = sel.value as VcsSetting; });
  return labelled("Version control system", sel,
    "Storyletter checks a file out before writing where the system locks files, and writes straight away where it merges. Switching systems rewrites the project's vcs-setup.md and ignore rules.");
}

/**
 * The play ladder's one field (design/engine-server.md 4.10): what kind of game
 * this is, which decides how much of itself the editor shows.
 *
 * One sentence per rung, under the field rather than beside every control the
 * rung governs: this is the only place the ladder is mentioned, which is the
 * point of it being one setting rather than a page of toggles.
 *
 * TWO RUNGS ARE OFFERED, NOT THREE (ruling of 2026-09-05). Solo and Shared
 * world are the author's: they simplify the editor. Venue is the licensed
 * Storylet Server's, written into the shards of the projects it seeds and
 * hands back, and it is not something off-the-shelf Storyletter offers or
 * names anywhere else. A project that already carries it must still be able to
 * SAY so, or the field would misreport the file, so the option appears for
 * exactly that project, reading where it came from. From it an author may
 * still move down, under the same refusal as any other move down.
 *
 * Going DOWN is refused while the project contains what the rung would hide,
 * and the refusal names what is in the way. It has to be a refusal rather than
 * a warning: a hidden feature that is silently still in use is exactly the
 * thing this setting exists to make impossible. The list comes from main,
 * counted by the same compiler check that raises the validate warning, so the
 * dialog and the file cannot disagree.
 */
function playField(d: ProjectSettingsDto): HTMLElement[] {
  const sel = el("select");
  // Venue is in the list only when the project is already on it. Once it is
  // there it stays for the life of the dialog, so an author who tries the move
  // down and thinks better of it can put the project back before saving.
  const server = d.play === "venue";
  for (const rung of PLAY_RUNGS) {
    if (rung === "venue" && !server) continue;
    const o = el("option", { text: RUNG_LABEL[rung] });
    o.value = rung;
    if (d.play === rung) o.selected = true;
    sel.append(o);
  }
  const note = el("p", { className: "set-note" });
  const refusal = el("p", { className: "set-note refusal" });
  const paint = (): void => { note.textContent = RUNG_BLURB[d.play]; };
  sel.addEventListener("change", () => {
    const next = sel.value as PlayRung;
    const above = next === "venue" ? [] : d.ladder[next];
    if (above.length > 0) {
      sel.value = d.play;   // the field goes on saying what the project IS
      refusal.textContent = `Not while the project uses it (${above.join(", ")}). `
        + "Take those out first, or leave Play where it is.";
      return;
    }
    refusal.textContent = "";
    d.play = next;
    paint();
  });
  paint();
  return [labelled("Play", sel), note, refusal];
}

/**
 * Build the dialog once; each open re-reads the settings and re-mounts.
 *
 * `readOnly` is the role's rule (design/engine-server.md 9.1): the project file
 * is the shape, so under an author's key this dialog opens to be READ. Greyed
 * first rather than refused on Save, which is what it used to do, with the far
 * end's own sentence arriving as a toast after the typing was done.
 */
export function createProjectSettings(
  studio: StudioApi, onSaved: (result: OpenResult) => void, onError: (msg: string) => void,
  readOnly: () => boolean = () => false,
  /** The open project, for its Storylet extensions' project-level values: a section each. */
  project: () => ProjectDto | undefined = () => undefined,
  /** Lock the extension sections whose shard somebody else holds (vc-view.ts), after each mount. */
  lockExtensions: (frame: HTMLElement) => void = () => {},
): { open(section?: string): void } {
  let data: ProjectSettingsDto | undefined;
  /** Storylet extension values set since the dialog opened, carried at Save: extension, field, value. */
  const extensionEdits: { extension: string; field: string; value: unknown }[] = [];
  /** The extensions the dialog was built with: a project taking others rebuilds it. */
  let builtFor = "";
  const extensionHost: ExtensionHost = {
    project,
    save: (extension, _node, field, value, landed) => {
      const at = extensionEdits.findIndex((e) => e.extension === extension && e.field === field);
      if (at >= 0) extensionEdits.splice(at, 1);
      extensionEdits.push({ extension, field, value });
      landed?.();
    },
    // A pick's project lists as they stand in the dialog: the saved values with this dialog's edits over them.
    projectEntry: (extension) => {
      const p = project();
      const saved = p?.projectNode !== undefined ? p.extensions?.find((x) => x.id === extension)?.values[p.projectNode] : undefined;
      const edits = extensionEdits.filter((e) => e.extension === extension);
      if (edits.length === 0) return saved;
      const entry: Record<string, unknown> = { ...(saved ?? {}) };
      for (const e of edits) { if (e.value === undefined) delete entry[e.field]; else entry[e.field] = e.value; }
      return entry;
    },
  };
  /** Host-scope stages and properties renamed since the dialog opened, carried at Save. */
  const worldRenames: { target: StageTargetDto; from: string; to: string; property?: true }[] = [];
  let dialog: SettingsDialog | undefined;
  /** The shell hands back open/destroy and keeps its modal to itself, so the
   *  frame is the node it just appended: what the read-only pass greys, and
   *  where the notice and the missing Save live. */
  let frame: HTMLDialogElement | undefined;
  let notice: HTMLElement | undefined;

  function build(): SettingsDialog {
    // One section per Storylet extension with project-level fields, named for the extension, in the Project
    // group: the project's own values, which have no page but this dialog.
    const extensionSections = extensionsFor(project(), "project").map((extension) => ({
      id: `ext-${extension.id}`, label: extension.name, group: "Project",
      mount: (h: HTMLElement) => {
        const node = project()?.projectNode;
        if (node !== undefined) h.append(extensionFields(extensionHost, extension, "project", node));
        return {};
      },
    }));
    return mountSettingsDialog({
      title: "Project settings",
      sections: [
        { id: "general", label: "General", group: "Project", mount: (h) => {
          const d = data!;
          // The paired Patter project: typed, or chosen, as a path relative to this project.
          d.patterProject ??= "";
          const patter = dialogField(d.patterProject, (v) => { d.patterProject = v; });
          patter.placeholder = "None";
          const choose = el("button", { className: "set-choose", text: "Choose…" });
          choose.type = "button";
          choose.addEventListener("click", () => void (async () => {
            const picked = await studio.choosePatterProject();
            if (picked) { patter.value = picked.path; d.patterProject = picked.path; }
          })());
          const patterRow = el("div", { className: "shell-inline" });
          patterRow.append(patter, choose);
          h.append(
            labelled("Name", dialogField(d.name, (v) => { d.name = v; })),
            labelled("Version", dialogField(d.version, (v) => { d.version = v; })),
            ...playField(d),
            labelledToggle("Warn about unread state", {
              checked: d.warnUnreadWrites,
              hint: "Also flag state an outcome writes that no condition reads. It's off by default, because cards are often written ahead of the content that will read them. A gate on state nothing writes always warns, whatever this says.",
              onChange: (on) => { d.warnUnreadWrites = on; },
            }).row,
            labelled("Patter project", patterRow,
              "The Patter project whose scenes these cards play, named after them. Each card is checked against its scene in the Patter project's published bundle, and Edit ▸ Show Scene in Patterpad opens it."),
          );
          return {};
        } },
        { id: "vcs", label: "Version control", group: "Project", mount: (h) => {
          h.append(vcsField(data!));
          return {};
        } },
        // Story properties are NOT here: they are the designers' daily working
        // vocabulary, so they live as a first-class document behind the
        // navigator's Story row. This dialog keeps the game-facing contract.
        // The host scopes are the host seam, so the coverage drivers live with them: the
        // declarations say what the game owns, the drivers say what the test harness should
        // feed them (Patterpad's World Properties tab). The id stays "world", which every
        // surface that lands an author here already names.
        { id: "world", label: "Game scopes", group: "Story data", mount: (h) => mountHostScopes(h, data!, {
          // A stage or property renamed here waits for Save with the rest of the dialog, and is
          // carried first, in order, so the save that follows finds it done.
          renameStage: (target, from, to) => { worldRenames.push({ target, from, to }); },
          renameProperty: (target, from, to) => { worldRenames.push({ target, from, to, property: true }); },
          stageGates: (target) => studio.stageGates(target),
          proposeDrivers: () => studio.proposeDrivers(),
        }) },
        { id: "export", label: "Publish", group: "Project", mount: (h) => {
          const d = data!;
          const meta = el("select");
          for (const m of ["full", "stripped"]) { const o = el("option", { text: m }); o.value = m; if (d.metadata === m) o.selected = true; meta.append(o); }
          meta.addEventListener("change", () => { d.metadata = meta.value as "full" | "stripped"; });
          const turns = el("input"); turns.type = "number"; turns.value = String(d.playAdvancesTurns);
          turns.addEventListener("input", () => { const n = Number(turns.value); if (Number.isFinite(n)) d.playAdvancesTurns = n; });
          h.append(
            labelled("Bundle path", dialogField(d.bundlePath, (v) => { d.bundlePath = v; })),
            labelled("Metadata", meta),
            // Beside Metadata, because it is the same kind of switch: authoring
            // data that may or may not ship.
            labelledToggle("Include the maps", {
              checked: d.exportMap,
              hint: "Zone shapes and background pictures ship with the bundle, and the pictures are written beside it. The engine ignores them. This is for a host that draws its own map.",
              onChange: (on) => { d.exportMap = on; },
            }).row,
            labelled("Play advances turns", turns,
              "How far a play moves the clock of the box the card came from. A timed box (one whose Turns setting counts seconds) is advanced by the game's clock instead, so its plays advance nothing."),
          );
          return {};
        } },
        ...extensionSections,
      ],
      onSave: async () => {
        for (const r of worldRenames.splice(0)) {
          const renamed = r.property ? studio.renameProperty(r.target, r.from, r.to) : studio.renameStage(r.target, r.from, r.to);
          if (!ok(await renamed, onError)) return false;
        }
        let result = await studio.saveProjectSettings(data!);
        // Refused (a lock, say): the dialog stays open with the edits in it.
        if (!ok(result, onError)) return false;
        const node = project()?.projectNode;
        for (const e of extensionEdits.splice(0)) {
          if (node === undefined) break;
          const written = await studio.setExtensionValue(e.extension, node, e.field, e.value);
          if (!ok(written, onError)) return false;
          result = written;
        }
        onSaved(result);
      },
    });
  }

  /**
   * Grey what was just mounted, or hand it back.
   *
   * After `open`, never before: the shell re-mounts every section on each open,
   * so a control disabled last time is a brand new control this time.
   * The PANELS only - the tab rail stays live, because reading the other tabs
   * is the whole of what a read-only settings dialog is for.
   */
  function applyReadOnly(): void {
    if (!frame) return;
    const off = readOnly();
    const panels = frame.querySelector<HTMLElement>(".settings-panels");
    if (panels) lockControls(panels, off, "");
    const save = frame.querySelector<HTMLButtonElement>(".settings-save");
    if (save) save.hidden = off;
    if (off && notice === undefined) {
      notice = shapeNotice();
      frame.querySelector(".settings-body")?.before(notice);
    }
    if (notice) notice.hidden = !off;
    lockExtensions(frame);
  }

  return {
    // `section` lets another surface land the author where the setting is:
    // the Coverage window's "Coverage drivers..." opens straight at World.
    open(section = "general") {
      void (async () => {
        const s = await studio.projectSettings();
        if (!s) return;
        data = s;
        extensionEdits.length = 0;
        const shape = extensionsFor(project(), "project").map((x) => x.id).join(",");
        if (dialog && shape !== builtFor) { dialog.destroy(); dialog = undefined; frame = undefined; notice = undefined; }
        builtFor = shape;
        if (!dialog) {
          dialog = build();
          frame = document.body.lastElementChild as HTMLDialogElement;
        }
        dialog.open(section);
        applyReadOnly();
      })();
    },
  };
}
