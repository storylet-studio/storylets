// ---------------------------------------------------------------------------
// THE coverage-driver list, edited beside the host-scope declarations it feeds
// (Project Settings > Game scopes). A driver is the answer to "my game sets
// this, so the test harness has to set it too": without one, every card gated
// on @world (or @player, ...) reads as never dealt, which is honest but useless.
//
// Drivers only ever address a host scope - the host seam. @story is written by
// outcomes, so play covers it; @box / @deck / @hand belong to the content.
// So the ref is the scope as chrome plus a name, as in Patterpad: fixed
// "@world." while @world is the only host scope, and a choice of the project's
// host scopes once there are more, so the author cannot address the wrong
// scope by typing.
//
// Built on the same shell list core as prop-list.ts, so the two lists in the
// World section read as one grammar.
// ---------------------------------------------------------------------------

import { bindPropertyRef, dupGuard, el, expandableRow, firstIllegalPropertyName, focusNewRow, iconBtn,
  labelled, moveItem, revalidatePropertyRefs } from "@wildwinter/app-shell";
import type { SettingsSectionHandle } from "@wildwinter/app-shell";
import type { CoverageDriverDto } from "../../shared/api.js";
import type { ScalarValue } from "@storylet-studio/model";

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

/** A ref as its scope and name ("@player.hp" -> player, hp). A ref with no scope is @world's,
 *  as every driver was before there were other host scopes. */
export function splitRef(ref: string): { scope: string; name: string } {
  const m = /^@([A-Za-z_][A-Za-z0-9_]*)\.(.*)$/.exec(ref);
  return m ? { scope: m[1]!, name: m[2]! } : { scope: "world", name: ref.replace(/^@+/, "") };
}

/** One host scope a driver may feed: its token, its declared names, and whether it is
 *  opaque (any name, unchecked). */
export interface DriverScope { token: string; names: string[]; opaque?: boolean }

export interface DriverListOptions {
  /** "Propose from story": the auto-proposal, which REPLACES the list. */
  onPropose?: () => Promise<CoverageDriverDto[]>;
  onChange?: () => void;
  /** The host scopes and the property names each currently DECLARES, read fresh on every check. A
   *  driver may only point at one of these (any name on an opaque scope), so the list has to come from
   *  the editor beside this one rather than be captured: declaring a property should clear the
   *  complaint on the driver naming it, without a re-render. Absent: @world, declaring nothing. */
  hostScopes?: () => DriverScope[];
}

/** The driver list's handle: the Save gate, and a redraw for when the scopes beside it change. */
export interface DriverListHandle extends SettingsSectionHandle {
  render(): void;
  /** Re-check every driver's name against the declarations, without a redraw. */
  revalidate(): void;
}

/** Mount the driver list into `host`. Mutates `drivers` in place. */
export function mountDriverList(host: HTMLElement, drivers: CoverageDriverDto[], opts: DriverListOptions = {}): DriverListHandle {
  const changed = (): void => opts.onChange?.();
  const scopes = (): DriverScope[] => opts.hostScopes?.() ?? [{ token: "world", names: [] }];
  const guard = dupGuard();
  const list = el("div", { className: "set-list" });

  function render(): void {
    guard.reset();
    list.replaceChildren();
    if (drivers.length === 0) {
      list.append(el("p", {
        className: "empty set-empty",
        text: scopes().length > 1
          ? "No drivers. Content gated on the game's scopes will read as never dealt."
          : "No drivers. Content gated on @world will read as never dealt.",
      }));
    }
    const all = scopes();
    drivers.forEach((d, i) => {
      const parts = splitRef(d.ref);
      const name = el("input", { className: "set-name" });
      name.value = parts.name;
      name.placeholder = "Property name";
      name.spellcheck = false;
      // Keyed on the whole ref, so @world.hp and @player.hp are two drivers, not a clash.
      guard.track(name, () => `${parts.scope}.${name.value.trim()}`);
      // The scope: fixed chrome while @world is the only one (as it always was), a choice of
      // the host scopes once there are more. A driver naming a scope since removed keeps it on
      // the list, so the row says what it holds and the name check says it no longer answers.
      let scopeEl: HTMLElement;
      const tokens = all.map((s) => s.token);
      if (tokens.length <= 1 && parts.scope === (tokens[0] ?? "world")) {
        scopeEl = el("span", { className: "set-scope", text: `@${parts.scope}.` });
      } else {
        const pick = el("select", { className: "set-scope" });
        pick.setAttribute("aria-label", "Scope");
        for (const t of tokens.includes(parts.scope) ? tokens : [...tokens, parts.scope]) {
          const o = el("option", { text: `@${t}.` }); o.value = t; if (t === parts.scope) o.selected = true; pick.append(o);
        }
        pick.addEventListener("change", () => {
          parts.scope = pick.value;
          d.ref = `@${parts.scope}.${name.value.trim().replace(/^@+/, "")}`;
          revalidatePropertyRefs(list);
          changed();
        });
        scopeEl = pick;
      }
      const ref = el("span", { className: "set-ref" }, scopeEl, name);
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
      bindPropertyRef(name, (v) => { d.ref = `@${parts.scope}.${v.trim().replace(/^@+/, "")}`; changed(); }, {
        // An opaque scope answers to any name: the typed one is offered back as declared.
        known: () => {
          const s = scopes().find((x) => x.token === parts.scope);
          return s === undefined ? [] : s.opaque === true ? [name.value.trim()] : s.names;
        },
        scope: parts.scope,
        hint: `The @${parts.scope} property this driver feeds. Declare it above first.`,
      });

      const values = el("input", { className: "set-values" });
      values.value = valuesText(d.values);
      values.placeholder = "Values, comma separated";
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

      const up = iconBtn("up", "Move up", () => { if (moveItem(drivers, i, -1)) { render(); changed(); } }, i === 0);
      const down = iconBtn("down", "Move down", () => { if (moveItem(drivers, i, 1)) { render(); changed(); } }, i === drivers.length - 1);
      const del = iconBtn("close", "Remove driver", () => { drivers.splice(i, 1); render(); changed(); }, false, true);

      list.append(expandableRow({ line: [ref, values, kind, up, down, del], details: [cadenceRow] }));
    });
    guard.check();
  }
  render();

  const add = el("button", { className: "settings-add", text: "+ Add driver" });
  add.addEventListener("click", () => {
    drivers.push({ ref: `@${scopes()[0]?.token ?? "world"}.`, kind: "recurring", cadence: "sometimes", values: [] });
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
  return {
    firstInvalid: () => guard.firstDuplicate() ?? firstIllegalPropertyName(list),
    render,
    revalidate: () => revalidatePropertyRefs(list),
  };
}
