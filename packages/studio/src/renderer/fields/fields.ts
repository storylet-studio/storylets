// ---------------------------------------------------------------------------
// The Fields window (Pattershot's brief, "a map of records edited in a helper
// window", H1 to H5): a map whose values are records (an extension's look,
// expression and gesture for each character on a card, say) is too big for a
// page's row, so it is edited here, as a grid, a row per key and a column per
// record field. The window follows the editor's selection, or stays on its item
// with Follow selection off. The editor owns the document: it sends what to
// show, and every edit goes back to it, to land as the page's own edits do (one
// undo step each). Patterpad's Fields window, on the same shared parts.
// ---------------------------------------------------------------------------

import "../src/fonts.css"; // every face the windows draw, declared once
import "../src/theme.css";
import "../tool-window/base.css";
import "./fields.css";
import "@wildwinter/app-shell/tooltip.css";
import { el, iconNode, pinButton, selectionFollowButton, toolWindowHead } from "@wildwinter/app-shell";
import { recordMapGrid } from "@wildwinter/app-shell/value-rows";
import type { RecordMapGrid, ValueAdapter, ValueDecl } from "@wildwinter/app-shell/value-rows";
import { bootToolWindow } from "../tool-window/boot.js";
import { KIND_WORD } from "../src/fields-state.js";
import type { FieldsGrid, FieldsWinState } from "../../shared/api.js";

const studio = window.studio;
const root = document.getElementById("fields")!;
const body = el("main", { className: "fbody" });

/** The cells' adapter, from what the editor sent: the functions themselves can't cross between windows. */
const adapterOf = (g: FieldsGrid): ValueAdapter => ({
  nodes: (kind) => g.nodes[kind] ?? [],
  list: (name) => g.lists[name],
  label: (kind, id) => g.labels[kind]?.[id],
});

/** The grids, kept across states by item and field, so a cell being edited keeps its focus. */
const grids = new Map<string, { grid: RecordMapGrid; holder: HTMLElement }>();

/** What this window last committed for each grid, as `stable` writes it: a state carrying it back is an echo. */
const committed = new Map<string, string>();
/** A value as text with every record's keys sorted, so the same value written back by the file compares equal. */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) =>
  (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

const empty = (text: string): HTMLElement => el("p", { className: "empty tw-empty", text });

function render(state: FieldsWinState): void {
  if (!state.hasProject) { grids.clear(); body.replaceChildren(empty("No project open.")); return; }
  if (state.node === null) { grids.clear(); body.replaceChildren(empty(state.hint || "Nothing to edit here.")); return; }
  const node = state.node;
  const word = KIND_WORD[node.kind] ?? node.kind;
  const head = el("p", { className: "fnode" }, el("span", { className: "fnode-kind", text: word }), el("span", { text: node.label }));
  if (state.grids.length === 0) {
    grids.clear();
    body.replaceChildren(head, empty(`This ${word} has nothing to edit here.${state.hint ? ` ${state.hint}` : ""}`));
    return;
  }
  const used = new Set<string>();
  const parts: HTMLElement[] = [head];
  for (const g of state.grids) {
    const key = `${node.id}\u0000${g.extension}\u0000${g.field}`;
    used.add(key);
    const disabled = state.readOnly || g.locked !== null;
    const opts = {
      decl: g.decl as unknown as ValueDecl, value: g.value, adapter: adapterOf(g), disabled,
      ...(disabled ? {} : { onCommit: (v: unknown) => {
        committed.set(key, stable(v));
        void studio.commitFields({ nodeId: node.id, extension: g.extension, field: g.field, value: v });
      } }),
    };
    let had = grids.get(key);
    // A cell keeps what is typed in it while it has focus. A value that isn't the echo of this window's own last
    // edit is the editor's word (an undo there, say), so the window lets go of the cell and draws again once the
    // shell's focus keeper has let go too (it holds the row until then). A cell commits as typed, never on
    // blur, so letting go commits nothing.
    const active = document.activeElement;
    if (had && active instanceof HTMLElement && had.holder.contains(active) && stable(g.value) !== committed.get(key)) {
      committed.delete(key);
      active.blur();
      setTimeout(() => render(state), 0);
      return;
    }
    if (had) had.grid.update(opts);
    else {
      had = { grid: recordMapGrid(opts), holder: el("section", { className: "fgrid" }) };
      grids.set(key, had);
    }
    const cap = el("h2", { className: "fcap", text: `${g.extensionName}: ${g.decl.label ?? g.decl.name}` });
    const lock = g.locked ? [el("p", { className: "flock" }, iconNode("locked"), el("span", { text: g.locked }))] : [];
    had.holder.replaceChildren(cap, ...lock, had.grid.el);
    parts.push(had.holder);
  }
  for (const k of [...grids.keys()]) if (!used.has(k)) { grids.delete(k); committed.delete(k); }
  body.replaceChildren(...parts);
}

/** The pin, built once and driven with `set`: main re-pins the window on Reset View and tells it after. */
const pin = pinButton({ pinned: true, onToggle: (on) => { void studio.setFieldsPinned(on); } });
/** Follow selection (the kit's words for a window that shows what the editor has selected). Off, the window
 *  stays on the item it shows. Remembered by main; on by default. */
const follow = selectionFollowButton({ on: true, onToggle: (on) => { void studio.setFieldsFollow(on); } });
const head = toolWindowHead({ title: "Fields", pin, trail: [follow.el], onClose: () => void studio.closeFields() });

// A state can land before the boot read does: the newer one wins.
let fresh = false;
studio.onFieldsState((state) => { fresh = true; render(state); });
// A different project under the window: what it shows is the old one's until the editor sends again.
studio.onProjectChanged(() => { void studio.fieldsState().then(render); });

async function boot(): Promise<void> {
  const state = await bootToolWindow({ onPinned: (on) => pin.set(on) });
  pin.set(state.fieldsPinned);
  follow.set(state.fieldsFollow);
  root.replaceChildren(head, body);
  const shown = await studio.fieldsState();
  if (!fresh) render(shown);
}
void boot();
