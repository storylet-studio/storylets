// ---------------------------------------------------------------------------
// THE coverage-driver list, edited beside the @world declarations it feeds
// (Project Settings > World). A driver is the answer to "my game sets this,
// so the test harness has to set it too": without one, every card gated on
// @world reads as never dealt, which is honest but useless.
//
// Drivers only ever address @world - the host seam. @story is written by
// outcomes, so play covers it; @box / @deck / @hand belong to the content.
// So the ref is fixed "@world." chrome plus a name, as in Patterpad, and the
// author cannot address the wrong scope by typing.
//
// Built on the same shell list core as prop-list.ts, so the two lists in the
// World section read as one grammar.
// ---------------------------------------------------------------------------

import { el } from "./dom.js";
import { bindPropertyRef, dupGuard, expandableRow, firstIllegalPropertyName, focusNewRow, iconBtn,
  labelled, moveItem } from "@wildwinter/app-shell";
import type { SettingsSectionHandle } from "@wildwinter/app-shell";
import type { CoverageDriverDto } from "../../shared/api.js";
import type { ScalarValue } from "@storylet-studio/model";

const WORLD = "@world.";

/** The pool as typed: `true`/`false` are booleans, bare numerals numbers, the
 *  rest text - so "50" drives a number and "fifty" drives a string. */
export function parseValues(raw: string): ScalarValue[] {
  return raw.split(",").map((s) => s.trim()).filter((s) => s !== "").map((s): ScalarValue => {
    if (s === "true") return true;
    if (s === "false") return false;
    const n = Number(s);
    return Number.isFinite(n) && String(n) === s ? n : s;
  });
}

export const valuesText = (values: ScalarValue[]): string => values.map((v) => String(v)).join(", ");

/** The property name half of a ref ("@world.danger" -> "danger"). */
const refName = (ref: string): string => (ref.startsWith(WORLD) ? ref.slice(WORLD.length) : ref.replace(/^@+/, ""));

export interface DriverListOptions {
  /** "Propose from story": the auto-proposal, which REPLACES the list. */
  onPropose?: () => Promise<CoverageDriverDto[]>;
  onChange?: () => void;
  /** The @world property names currently DECLARED, read fresh on every check. A driver may only point
   *  at one of these, so the list has to come from the editor beside this one rather than be captured:
   *  declaring a property should clear the complaint on the driver naming it, without a re-render. */
  knownWorldProperties?: () => string[];
}

/** Mount the driver list into `host`. Mutates `drivers` in place. */
export function mountDriverList(host: HTMLElement, drivers: CoverageDriverDto[], opts: DriverListOptions = {}): SettingsSectionHandle {
  const changed = (): void => opts.onChange?.();
  const guard = dupGuard();
  const list = el("div", { className: "set-list" });

  function render(): void {
    guard.reset();
    list.replaceChildren();
    if (drivers.length === 0) {
      list.append(el("p", {
        className: "set-empty",
        text: "No drivers. Content gated on @world will read as never dealt.",
      }));
    }
    drivers.forEach((d, i) => {
      const name = el("input", { className: "set-name" });
      name.value = refName(d.ref);
      name.placeholder = "<property>";
      name.spellcheck = false;
      guard.track(name);
      const ref = el("span", { className: "set-ref" }, el("span", { className: "set-scope", text: WORLD }), name);
      // Bound AFTER the input is in the tree: the shell attaches its datalist as a SIBLING, so binding
      // an unparented input silently gets no autocomplete at all.
      //
      // A REFERENCE, not a declaration, so it takes the other rule: case is fine (expressions fold
      // every reference), but a hyphen, a space, a leading digit or a keyword can never match any
      // declaration - and neither can a name nobody declared. That last one is the point: a driver
      // aimed at a property that does not exist feeds a value nobody reads, and the cards gated on it
      // are reported as never dealt, which reads as "this content is unreachable" rather than "that
      // name is a typo". Declare-then-reference, so this blocks Save; the declared names are offered
      // as a datalist to keep that from being merely pedantic.
      bindPropertyRef(name, (v) => { d.ref = WORLD + v.trim().replace(/^@+/, ""); changed(); }, {
        known: () => opts.knownWorldProperties?.() ?? [],
        scope: "world",
        hint: "The @world property this driver feeds. Declare it above first.",
      });

      const values = el("input", { className: "set-values" });
      values.value = valuesText(d.values);
      values.placeholder = "<values, comma separated>";
      values.addEventListener("input", () => { d.values = parseValues(values.value); changed(); });

      const kind = el("select");
      for (const [v, lbl] of [["recurring", "each turn"], ["initial", "at the start"]] as [string, string][]) {
        const o = el("option", { text: lbl }); o.value = v; if (v === d.kind) o.selected = true; kind.append(o);
      }

      const cadence = el("select");
      for (const [v, lbl] of [["rarely", "rarely"], ["sometimes", "sometimes"], ["often", "often"]] as [string, string][]) {
        const o = el("option", { text: lbl }); o.value = v; if (v === (d.cadence ?? "sometimes")) o.selected = true; cadence.append(o);
      }
      cadence.addEventListener("change", () => { d.cadence = cadence.value as CoverageDriverDto["cadence"]; changed(); });
      const cadenceRow = labelled("How often", cadence);
      const syncCadence = (): void => { cadenceRow.hidden = d.kind !== "recurring"; };
      kind.addEventListener("change", () => {
        d.kind = kind.value as CoverageDriverDto["kind"];
        if (d.kind === "recurring") d.cadence ??= "sometimes"; else delete d.cadence;
        syncCadence(); changed();
      });
      syncCadence();

      const up = iconBtn("↑", "Move up", () => { if (moveItem(drivers, i, -1)) { render(); changed(); } }, i === 0);
      const down = iconBtn("↓", "Move down", () => { if (moveItem(drivers, i, 1)) { render(); changed(); } }, i === drivers.length - 1);
      const del = iconBtn("✕", "Remove", () => { drivers.splice(i, 1); render(); changed(); }, false, true);

      list.append(expandableRow({ line: [ref, values, kind, up, down, del], details: [cadenceRow] }));
    });
    guard.check();
  }
  render();

  const add = el("button", { className: "settings-add", text: "+ Add driver" });
  add.addEventListener("click", () => {
    drivers.push({ ref: WORLD, kind: "recurring", cadence: "sometimes", values: [] });
    render(); changed(); focusNewRow(list);
  });
  const actions = el("div", { className: "set-actions" }, add);
  if (opts.onPropose) {
    const propose = el("button", { className: "settings-add", text: "Propose from the cards" });
    propose.addEventListener("click", () => {
      void (async () => {
        propose.disabled = true;
        try {
          // A proposal reads the conditions, so it stands in for the whole
          // list rather than merging into a half-edited one.
          drivers.splice(0, drivers.length, ...await opts.onPropose!());
          render(); changed();
        } finally { propose.disabled = false; }
      })();
    });
    actions.append(propose);
  }
  host.append(list, actions);
  // The Save gate takes both faults: a name that clashes with another, and one no @world property
  // answers to. The field's own rollover says which it is.
  return { firstInvalid: () => guard.firstDuplicate() ?? firstIllegalPropertyName(list) };
}
