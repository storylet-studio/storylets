// ---------------------------------------------------------------------------
// THE property/field declaration list - one component for every scope that
// declares { name, type, default, values? } rows: world + story (the Project
// Settings dialog), the box's card fields and @box state, @deck state, @hand
// state, and a dimension value's properties (rules 6 of
// design/studio-editing-structure.md).
//
// Type-driven defaults (boolean / enum pickers, not free text), enum/flags
// values as tag chips, reorder, and a duplicate-name guard. Built on the
// shared shell's list core so it matches Patterpad's settings lists.
//
// The dialog host passes no onChange (it saves whole on Save and reads
// firstInvalid for the gate); centre editors pass onChange to feed the
// debounced autosave.
// ---------------------------------------------------------------------------

import { el } from "./dom.js";
import { bindPropertyName, dupGuard, expandableRow, firstIllegalPropertyName, focusNewRow, iconBtn,
  labelled, moveItem, PROPERTY_NAME_HINT, tagChips } from "@wildwinter/app-shell";
import type { SettingsSectionHandle } from "@wildwinter/app-shell";
import type { PropertyDeclDto } from "../../shared/api.js";

export const PROP_TYPES = ["string", "number", "boolean", "enum", "flags", "quality"];

/** A type-driven default control for one declaration (string/number/boolean/
 *  enum; flags hold a set, so no single default). */
/** The type-appropriate control for a property's VALUE: a stage picker for a
 *  quality, the value list for an enum, a checkbox-ish select for a boolean, a
 *  number or text field otherwise. Exported because a tag's own starting value
 *  wants exactly the same control as its group declaration's default
 *  (design/hand-typing.md step B) and there should be one of these, not two. */
export function valueControl(p: PropertyDeclDto, onChange?: () => void): HTMLElement {
  return defaultControl(p, onChange);
}

function defaultControl(p: PropertyDeclDto, onChange?: () => void): HTMLElement {
  if (p.type === "boolean") {
    const sel = el("select");
    for (const [v, lbl] of [["", "(unset)"], ["true", "true"], ["false", "false"]] as [string, string][]) {
      const o = el("option", { text: lbl }); o.value = v; if (p.default === v) o.selected = true; sel.append(o);
    }
    sel.addEventListener("change", () => { p.default = sel.value; onChange?.(); });
    return sel;
  }
  if (p.type === "enum") {
    const sel = el("select");
    const none = el("option", { text: "(none)" }); none.value = ""; sel.append(none);
    for (const v of p.values ?? []) { const o = el("option", { text: v }); o.value = v; if (p.default === v) o.selected = true; sel.append(o); }
    sel.addEventListener("change", () => { p.default = sel.value; onChange?.(); });
    return sel;
  }
  if (p.type === "flags") return el("span", { className: "set-dim", text: "starts empty" });
  if (p.type === "quality") {
    // The default is a STAGE; blank means the first rung, which is what a
    // quality nearly always wants (design/quality.md).
    const sel = el("select");
    const first = el("option", { text: "(first stage)" }); first.value = ""; sel.append(first);
    for (const v of p.stages ?? []) { const o = el("option", { text: v }); o.value = v; if (p.default === v) o.selected = true; sel.append(o); }
    sel.addEventListener("change", () => { p.default = sel.value; onChange?.(); });
    return sel;
  }
  const input = el("input");
  input.type = p.type === "number" ? "number" : "text";
  input.value = p.default; input.placeholder = "<starting value>";
  input.addEventListener("input", () => { p.default = input.value; onChange?.(); });
  return input;
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
}

/** Mount the declaration list into `host`. Mutates `decls` in place. */
export function mountPropertyList(host: HTMLElement, decls: PropertyDeclDto[], opts: PropListOptions = {}): SettingsSectionHandle {
  const changed = (): void => opts.onChange?.();
  const guard = dupGuard();
  const list = el("div", { className: "set-list" });
  function render(): void {
    guard.reset();
    list.replaceChildren();
    decls.forEach((p, i) => {
      const name = el("input", { className: "set-name" });
      name.value = p.name; name.placeholder = "<name>";
      name.title = PROPERTY_NAME_HINT;
      bindPropertyName(name, (v) => { p.name = v; changed(); }, { hint: PROPERTY_NAME_HINT });
      guard.track(name);
      const type = el("select");
      for (const t of PROP_TYPES) { const o = el("option", { text: t }); o.value = t; if (t === p.type) o.selected = true; type.append(o); }
      type.addEventListener("change", () => {
        p.type = type.value; p.default = "";
        if (p.type === "enum" || p.type === "flags") p.values ??= []; else delete p.values;
        if (p.type === "quality") p.stages ??= []; else delete p.stages;
        render(); changed();
      });
      let def = defaultControl(p, changed);
      const up = iconBtn("↑", "Move up", () => { if (moveItem(decls, i, -1)) { render(); changed(); } }, i === 0);
      const down = iconBtn("↓", "Move down", () => { if (moveItem(decls, i, 1)) { render(); changed(); } }, i === decls.length - 1);
      const del = iconBtn("✕", "Remove", () => { decls.splice(i, 1); render(); changed(); }, false, true);
      const details: HTMLElement[] = [];
      // Every type gets a purpose: it is the pill's hover tip in the condition
      // and outcome editors, so writing one here teaches every reader of the
      // expression what the name means.
      const purpose = el("input");
      purpose.value = p.purpose ?? ""; purpose.placeholder = "<what this property is for>";
      purpose.addEventListener("input", () => {
        if (purpose.value.trim()) p.purpose = purpose.value; else delete p.purpose;
        changed();
      });
      details.push(labelled("Purpose", purpose));
      if (p.type === "enum" || p.type === "flags") {
        details.push(labelled("Values", tagChips(p as { values?: string[] }, () => {
          const nd = defaultControl(p, changed); def.replaceWith(nd); def = nd; changed();
        })));
      }
      if (p.type === "quality") {
        // The ladder, in order: the chips ARE the meaning here, so the same
        // editor enum values use, over `stages`. Reorder matters and the chip
        // editor preserves authored order.
        const holder = { get values() { return (p as { stages?: string[] }).stages; }, set values(v) { (p as { stages?: string[] }).stages = v; } };
        details.push(labelled("Stages", tagChips(holder as { values?: string[] }, () => {
          const nd = defaultControl(p, changed); def.replaceWith(nd); def = nd; changed();
        })));
      }
      const extra = opts.rowExtras?.(p);
      list.append(expandableRow({ line: [name, type, def, ...(extra ? [extra] : []), up, down, del], details }));
    });
    guard.check();
  }
  render();
  const add = el("button", { className: "settings-add", text: opts.addLabel ?? "+ Add property" });
  add.addEventListener("click", () => { decls.push({ name: "", type: "string", default: "" }); render(); changed(); focusNewRow(list); });
  host.append(list, add);
  // The Save gate takes both faults: a name that clashes with another, and a name no
  // expression could reach. The field's own rollover says which it is.
  return { firstInvalid: () => guard.firstDuplicate() ?? firstIllegalPropertyName(host) };
}
