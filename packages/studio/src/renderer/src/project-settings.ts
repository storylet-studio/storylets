// ---------------------------------------------------------------------------
// Project Settings: the storylet-specific sections over the shared settings
// dialog (@wildwinter/app-shell). The framework (dialog, tabs, save gate) and
// the list-editing core (expandableRow / dupGuard / tagChips) come from the
// shell; here we supply the sections - General, Story/World state properties
// (World carrying the coverage drivers that feed them), Export - reading and
// mutating a ProjectSettingsDto that saves whole.
// ---------------------------------------------------------------------------

import { el } from "./dom.js";
import { mountPropertyList } from "./prop-list.js";
import { mountDriverList } from "./driver-list.js";
import { mountSettingsDialog, labelled } from "@wildwinter/app-shell";
import type { SettingsDialog, SettingsSectionHandle } from "@wildwinter/app-shell";
import type { OpenResult, ProjectSettingsDto, PropertyDeclDto, StudioApi } from "../../shared/api.js";

function textField(value: string, onInput: (v: string) => void): HTMLInputElement {
  const input = el("input");
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

/** Build the dialog once; each open re-reads the settings and re-mounts. */
export function createProjectSettings(studio: StudioApi, onSaved: (result: OpenResult) => void, onError: (msg: string) => void): { open(section?: string): void } {
  let data: ProjectSettingsDto | undefined;
  let dialog: SettingsDialog | undefined;

  function build(): SettingsDialog {
    return mountSettingsDialog({
      title: "Project settings",
      sections: [
        { id: "general", label: "General", group: "Project", mount: (h) => {
          const d = data!;
          const unread = el("input"); unread.type = "checkbox"; unread.checked = d.warnUnreadWrites;
          unread.addEventListener("change", () => { d.warnUnreadWrites = unread.checked; });
          h.append(
            labelled("Name", textField(d.name, (v) => { d.name = v; })),
            labelled("Version", textField(d.version, (v) => { d.version = v; })),
            labelled("Warn about unread state", unread),
            el("p", { className: "set-note", text: "Also flag state an outcome writes that no condition reads. Off by default: cards are often written ahead of the content that will read them. A gate on state nothing writes always warns, whatever this says." }),
          );
          return {};
        } },
        // Story properties are NOT here: they are the designers' daily working
        // vocabulary, so they live as a first-class document behind the
        // navigator's Story row. This dialog keeps the game-facing contract.
        // World is the host seam, so the coverage drivers live with it: the
        // declarations say what the game owns, the drivers say what the test
        // harness should feed them (Patterpad's World Properties tab).
        { id: "world", label: "World", group: "State", mount: (h) => {
          const props = mountPropertyList(h, data!.world, { readOnlySwitch: true });
          h.append(el("h3", { className: "set-cap", text: "Coverage drivers" }));
          h.append(el("p", { className: "set-note", text: "Values the coverage test feeds these properties, so cards gated on them get dealt." }));
          // Tolerate a DTO without the field rather than blanking the panel:
          // a section that throws mid-mount leaves the tab half-built.
          data!.drivers ??= [];
          const drivers = mountDriverList(h, data!.drivers, {
            onPropose: () => studio.proposeDrivers(),
            // The declarations sit in the same panel, and prop-list mutates that array in place, so
            // reading it fresh is enough: declare a property and the driver naming it stops complaining.
            knownWorldProperties: () => data!.world.map((p) => p.name).filter(Boolean),
          });
          return { firstInvalid: () => props.firstInvalid?.() ?? drivers.firstInvalid?.() ?? null };
        } },
        { id: "export", label: "Export", group: "Build", mount: (h) => {
          const d = data!;
          const meta = el("select");
          for (const m of ["full", "stripped"]) { const o = el("option", { text: m }); o.value = m; if (d.metadata === m) o.selected = true; meta.append(o); }
          meta.addEventListener("change", () => { d.metadata = meta.value as "full" | "stripped"; });
          const turns = el("input"); turns.type = "number"; turns.value = String(d.playAdvancesTurns);
          turns.addEventListener("input", () => { const n = Number(turns.value); if (Number.isFinite(n)) d.playAdvancesTurns = n; });
          // Beside Metadata, because it is the same kind of switch: authoring
          // data that may or may not ship.
          const map = el("input"); map.type = "checkbox"; map.checked = d.exportMap;
          map.addEventListener("change", () => { d.exportMap = map.checked; });
          h.append(
            labelled("Bundle path", textField(d.bundlePath, (v) => { d.bundlePath = v; })),
            labelled("Metadata", meta),
            labelled("Include the maps", map),
            el("p", { className: "set-note", text: "Zone shapes and background pictures ship with the bundle, and the pictures are written beside it. The engine ignores them: this is for a host that draws its own map." }),
            labelled("Play advances turns", turns),
          );
          return {};
        } },
      ],
      onSave: async () => {
        const result = await studio.saveProjectSettings(data!);
        if ("error" in result) { onError(result.error); return; }
        onSaved(result);
      },
    });
  }

  return {
    // `section` lets another surface land the author where the setting is:
    // the Coverage window's "Coverage drivers..." opens straight at World.
    open(section = "general") {
      void (async () => {
        const s = await studio.projectSettings();
        if (!s) return;
        data = s;
        if (!dialog) dialog = build();
        dialog.open(section);
      })();
    },
  };
}
