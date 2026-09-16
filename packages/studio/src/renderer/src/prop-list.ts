// ---------------------------------------------------------------------------
// THE property/field declaration list - one component for every scope that
// declares { name, type, default, values? } rows: world + story (the Project
// Settings dialog), the box's card fields and @box state, @deck state, @hand
// state, and a dimension value's properties (rules 6 of
// design/studio-editing-structure.md).
//
// The list itself is the shell's since the 2026-09 review (property-list.ts:
// type-driven defaults, values as tag chips, a quality's stages in order,
// reorder, add-then-focus, the duplicate and illegal-name gates), so it is the
// same list Patterpad's settings draw. What stays here is what the shell must
// not know: this DTO stores the default as the string the field showed ("" for
// none, the shell's `typed: false`), and the three switches a declaration can
// carry in this app (Read-only, Shared, Durable) plus the Story page's "uses"
// affordance, which arrive through `extraLine` / `extraDetails`.
//
// The dialog host passes no onChange (it saves whole on Save and reads
// firstInvalid for the gate); centre editors pass onChange to feed the
// debounced autosave.
// ---------------------------------------------------------------------------

import { el } from "./dom.js";
import { defaultControl, labelled, mountPropertyList as mountShellPropertyList } from "@wildwinter/app-shell";
import type { PropertyListHandle } from "@wildwinter/app-shell";
import type { PropertyDeclDto } from "../../shared/api.js";
import { shows } from "./play-ladder.js";

/** The type-appropriate control for a property's VALUE: a stage picker for a
 *  quality, the value list for an enum, a true / false picker for a boolean, a
 *  number or text field otherwise. Exported because a tag's own starting value
 *  wants exactly the same control as its group declaration's default
 *  (design/hand-typing.md step B) and there should be one of these, not two.
 *  It is the shell's `defaultControl`, in this DTO's string encoding. */
export function valueControl(p: PropertyDeclDto, onChange?: () => void): HTMLElement {
  return defaultControl(p, onChange);
}

export interface PropListOptions {
  /** Called after every mutation - centre editors feed their autosave here. */
  onChange?: () => void;
  addLabel?: string;
  /** An extra control at the row's end (before the reorder pair), keyed by the
   *  declaration: the Story page hangs its "uses" affordance here - the answer
   *  to "where do I see everything that reads or writes this?", which the
   *  audit found the window could not give at the property itself. */
  rowExtras?: (decl: PropertyDeclDto) => HTMLElement | null;
  /** The @world list only: offer the Read-only switch (`writable: false`),
   *  the story's promise not to write a value the game owns. Patterpad has the
   *  same switch on its World Properties, in the same words. */
  readOnlySwitch?: boolean;
  /**
   * Offer the two axes a declaration can sit on: Shared (design/flows.md) and
   * Durable (design/engine-server.md 4.2). Default true.
   *
   * Off for the @world list, where both are compile errors (@world is the
   * game's own state), and off for a box's card TEMPLATE, whose fields are
   * data for the host and carry no state at all. The play ladder decides
   * whether either one is drawn even where they are offered.
   */
  sharingSwitches?: boolean;
  /** Is this scope shared unless the declaration says otherwise? True for
   *  @story, false for box / deck / hand / tag - the runtime's own defaults.
   *  The switch writes the flag only when it DIFFERS from this, so a shard
   *  keeps saying what the author chose rather than what the app assumed. */
  sharedByDefault?: boolean;
}

/** A labelled checkbox row for one of the declaration's flags. */
function flagRow(label: string, tip: string, checked: boolean, onChange: (on: boolean) => void): HTMLElement {
  const box = el("input") as HTMLInputElement;
  box.type = "checkbox"; box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  const row = labelled(label, box);
  row.dataset["tip"] = tip;
  return row;
}

/** The switches this app's declarations carry, behind the row's disclosure. */
function switches(p: PropertyDeclDto, opts: PropListOptions, changed: () => void): (HTMLElement | null)[] {
  const details: (HTMLElement | null)[] = [];
  if (opts.readOnlySwitch) {
    // Checked means writable: false. Unticking DELETES the key rather than
    // writing true, so a shard that never had the flag is not rewritten.
    details.push(flagRow("Read-only",
      "The story can read this value but not set it, because the game owns it. Writing to it's a validation error.",
      p.writable === false,
      (on) => { if (on) p.writable = false; else delete p.writable; changed(); }));
  }
  // The two axes (design/flows.md; design/engine-server.md 4.2), drawn only
  // where the project's rung shows them - absent, never greyed, since the
  // answer in a solo project is "not in this kind of project" and the Play
  // field in Project Settings is where that is said.
  if (opts.sharingSwitches !== false) {
    const shareDefault = opts.sharedByDefault === true;
    if (shows("sharing")) {
      details.push(flagRow("Shared",
        shareDefault
          ? "One value for everyone playing, rather than a copy each. It's on by default for story state. Untick it for a value each playthrough keeps to itself."
          : "One value for everyone playing, rather than a copy each. A single-player game is unaffected.",
        p.shared ?? shareDefault,
        (on) => { if (on === shareDefault) delete p.shared; else p.shared = on; changed(); }));
    }
    // A declaration that is ALREADY durable keeps its switch at every
    // rung. Hiding must not swallow content in use, and here it would
    // strand it: venue is the Storylet Server's rung to set, so the only
    // way out the compiler can name is "remove the flag", and a control
    // that is not drawn is one an author cannot use to remove it. Sharing
    // needs no such escape: moving up a rung is a move Storyletter offers.
    if (shows("durable") || p.durable === true) {
      // Durable is never a scope default: absent means run-scoped everywhere.
      details.push(flagRow("Durable",
        "The value survives the end of a run. Shared and durable is the installation's memory. Durable on its own is what one player carries back with them.",
        p.durable === true,
        (on) => { if (on) p.durable = true; else delete p.durable; changed(); }));
    }
  }
  return details;
}

/** Mount the declaration list into `host`. Mutates `decls` in place. */
export function mountPropertyList(host: HTMLElement, decls: PropertyDeclDto[], opts: PropListOptions = {}): PropertyListHandle {
  const changed = (): void => opts.onChange?.();
  // The noun the add button names ("+ Add property", "+ Field"), pluralised for the empty sentence.
  const noun = (opts.addLabel ?? "+ Add property").replace(/^\+\s*(Add\s+)?/i, "").toLowerCase();
  const emptyNoun = noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`;
  return mountShellPropertyList(host, decls, {
    onChange: changed,
    ...(opts.addLabel !== undefined ? { addLabel: opts.addLabel } : {}),
    emptyText: `No ${emptyNoun} yet. Add one below.`,
    // A new row starts as text, with the DTO's blank default already there.
    newDecl: () => ({ name: "", type: "string", default: "" }),
    extraLine: (decl) => [opts.rowExtras?.(decl) ?? null],
    extraDetails: (decl) => switches(decl, opts, changed),
  });
}
