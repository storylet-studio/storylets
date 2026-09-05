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
import type { OpenResult, PlayRung, ProjectSettingsDto, PropertyDeclDto, StudioApi } from "../../shared/api.js";
import { PLAY_RUNGS, RUNG_BLURB, RUNG_LABEL } from "./play-ladder.js";

function textField(value: string, onInput: (v: string) => void): HTMLInputElement {
  const input = el("input");
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
  return input;
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
      refusal.textContent = `Not while the project uses it: ${above.join(", ")}. `
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
            ...playField(d),
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
          // Neither sharing axis on @world: both are compile errors there,
          // @world being the game's own state (flows.md; engine-server.md 4.2).
          const props = mountPropertyList(h, data!.world, { readOnlySwitch: true, sharingSwitches: false });
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
        { id: "export", label: "Publish", group: "Project", mount: (h) => {
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
            el("p", { className: "set-note", text: "How far a play moves the clock of the box the card came from. It does not apply to a timed box: a box whose Turns setting counts seconds is advanced by the game's clock, and its plays advance nothing." }),
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
