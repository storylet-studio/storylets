// ---------------------------------------------------------------------------
// What the Fields window shows (Pattershot's brief, "a map of records edited in
// a helper window", H1 to H5), built in the editor, which owns the document:
// the item it is on, and each map of records the item's kind has, with what the
// grid's cells need from the project (nodes, names and project lists) sent as
// data, because an adapter's functions can't cross to another window.
// Patterpad's fields-state.ts, with Storyletter's items for its nodes.
//
// Which item: with Follow selection on, the one an Edit button named until the
// selection moves on, else the deepest selected item whose kind has a map of
// records, else the deepest selected item; off, the item it was on.
//
// A map whose field names one of its extension's views as its `editor` is that view's, once the view is
// installed here (Y5), so the window leaves it out (`withoutViewEdited`): one editor per field, not two.
// ---------------------------------------------------------------------------

import { isRecordMap } from "@wildwinter/app-shell/value-rows";
import type { ValueDecl } from "@wildwinter/app-shell/value-rows";
import { adapterOf, shownValue } from "./extension-rows.js";
import type { ExtensionHost } from "./extension-rows.js";
import type { Focus } from "./views.js";
import type { Inspected } from "./inspector.js";
import type { ExtensionDto, ExtensionFieldDto, FieldsGrid, FieldsWinState, ProjectDto } from "../../shared/api.js";

/** An item an extension can hold values on: its extension kind and id. */
export interface FieldsNode { kind: string; id: string }

/** The editor's selection as the window follows it: the open page, the document on it, and the card the
 *  author last touched in a deck's views. */
export interface FieldsSelection { focus?: Focus; inspected?: Inspected; cursor?: string }

/** The selection's items that carry extension values, deepest first: a card, then its deck, then its box. */
export function selectedNodes(sel: FieldsSelection): FieldsNode[] {
  const d = sel.inspected;
  if (d !== undefined) {
    const box = { kind: "box", id: d.box };
    switch (d.kind) {
      case "card": return [{ kind: "card", id: d.card }, { kind: "deck", id: d.deck }, box];
      case "deck": return [{ kind: "deck", id: d.deck }, box];
      case "template": return [{ kind: "handTemplate", id: d.template }, box];
      case "hand": return [{ kind: "hand", id: d.hand }, box];
      case "tagGroup": return [{ kind: "tagGroup", id: d.group }, box];
      case "box": return [box];
    }
  }
  const f = sel.focus;
  if (f === undefined || f.box === undefined) return [];
  const box = { kind: "box", id: f.box };
  if (f.kind === "deck") {
    return [...(sel.cursor !== undefined ? [{ kind: "card", id: sel.cursor }] : []), { kind: "deck", id: f.deck }, box];
  }
  return [box];
}

/** The maps of records an extension declares for a kind (H2: any map whose values are records). */
export function recordMapFields(extensions: readonly ExtensionDto[], kind: string): { extension: ExtensionDto; decl: ExtensionFieldDto }[] {
  const out: { extension: ExtensionDto; decl: ExtensionFieldDto }[] = [];
  for (const extension of extensions) {
    for (const decl of extension.targets[kind]?.fields ?? []) {
      if (isRecordMap(decl as unknown as ValueDecl)) out.push({ extension, decl });
    }
  }
  return out;
}

/** The item the window follows to: the deepest selected one whose kind has a map of records, else the deepest. */
/** The project with every field a view edits here taken out of its extensions: a field whose `editor` names one
 *  of the extension's views that `installed` says opens on this machine. */
export function withoutViewEdited(project: ProjectDto | undefined, installed: (extension: string, view: string) => boolean): ProjectDto | undefined {
  if (!project?.extensions) return project;
  let changed = false;
  const extensions = project.extensions.map((x) => {
    const edited = (f: ExtensionFieldDto): boolean => f.editor !== undefined && (x.views ?? []).some((v) => v.id === f.editor) && installed(x.id, f.editor);
    if (!Object.values(x.targets).some((t) => t.fields.some(edited))) return x;
    changed = true;
    return { ...x, targets: Object.fromEntries(Object.entries(x.targets).map(([kind, t]) => [kind, { ...t, fields: t.fields.filter((f) => !edited(f)) }])) };
  });
  return changed ? { ...project, extensions } : project;
}

export function followTarget(nodes: readonly FieldsNode[], extensions: readonly ExtensionDto[]): FieldsNode | null {
  return nodes.find((n) => recordMapFields(extensions, n.kind).length > 0) ?? nodes[0] ?? null;
}

export const KIND_WORD: Record<string, string> = {
  card: "card", outcome: "outcome", deck: "deck", box: "box", handTemplate: "hand template", hand: "hand",
  tagGroup: "tag group", tag: "tag",
};

/** "a, b, or c", with the Oxford comma. */
const joined = (xs: readonly string[], word: string): string =>
  xs.length <= 2 ? xs.join(` ${word} `) : `${xs.slice(0, -1).join(", ")}, ${word} ${xs[xs.length - 1]}`;

/** Where the project's maps of records are, for the window to say when it has none to show: "Select a card
 *  or outcome to edit Performance here." Empty when there are none. */
export function fieldsHint(extensions: readonly ExtensionDto[]): string {
  const kinds: string[] = [];
  const labels: string[] = [];
  for (const kind of Object.keys(KIND_WORD)) {
    const found = recordMapFields(extensions, kind);
    if (found.length === 0) continue;
    kinds.push(KIND_WORD[kind]!);
    for (const f of found) { const l = f.decl.label ?? f.decl.name; if (!labels.includes(l)) labels.push(l); }
  }
  return kinds.length ? `Select ${/^[aeiou]/.test(kinds[0]!) ? "an" : "a"} ${joined(kinds, "or")} to edit ${joined(labels, "and")} here.` : "";
}

/** An item as the author knows it: its game id, an outcome on its card ("ring on bell"), a tag in its group. */
export function fieldsNodeLabel(project: ProjectDto | undefined, kind: string, id: string): string {
  const label = project?.extensionNodes?.[kind]?.find((n) => n.id === id)?.label ?? id;
  const [parent, own] = label.split("/");
  if (own === undefined) return label;
  return kind === "outcome" ? `${own} on ${parent}` : `${own} in ${parent}`;
}

/** The kinds a declaration names, all the way down: its key, its references and its picks' node sources. */
function kindsOf(decl: ValueDecl | undefined, into: Set<string>): void {
  if (!decl) return;
  if (decl.key?.type === "reference" && decl.key.to) into.add(decl.key.to);
  if (decl.type === "reference" && decl.to) into.add(decl.to);
  for (const s of decl.from ?? []) if ("to" in s) into.add(s.to);
  for (const f of decl.fields ?? []) kindsOf(f, into);
  kindsOf(decl.of as ValueDecl | undefined, into);
}

/** The project lists a declaration's picks offer, all the way down. */
function listsOf(decl: ValueDecl | undefined, into: Set<string>): void {
  if (!decl) return;
  for (const s of decl.from ?? []) if ("list" in s) into.add(s.list);
  for (const f of decl.fields ?? []) listsOf(f, into);
  listsOf(decl.of as ValueDecl | undefined, into);
}

/** Every string a value holds, for the names of held nodes the choices may leave out. */
function stringsIn(value: unknown, into: Set<string>): void {
  if (typeof value === "string") into.add(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, into);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { into.add(k); stringsIn(v, into); }
}

export interface FieldsStateInput {
  /** The extensions' host: the project, and its values. */
  host: ExtensionHost;
  /** The item to show; null with nothing selected (or the held item has gone). */
  node: FieldsNode | null;
  /** The sentence when somebody else holds an extension's data for this item ("Probe's data here is locked
   *  by bo."), else null. */
  lock: (extension: ExtensionDto, node: FieldsNode) => string | null;
}

export function fieldsState(o: FieldsStateInput): FieldsWinState {
  const project = o.host.project();
  const extensions = project?.extensions ?? [];
  const hint = fieldsHint(extensions);
  const readOnly = o.host.readOnly === true;
  if (project === undefined) return { hasProject: false, node: null, readOnly: true, grids: [], hint };
  const node = o.node;
  // An item the project no longer has (deleted, or another project's) is nothing selected.
  if (node === null || !(project.extensionNodes?.[node.kind] ?? []).some((n) => n.id === node.id)) {
    return { hasProject: true, node: null, readOnly, grids: [], hint };
  }
  const grids: FieldsGrid[] = recordMapFields(extensions, node.kind).map(({ extension, decl }) => {
    const adapter = adapterOf(o.host, extension);
    const kinds = new Set<string>();
    kindsOf(decl as unknown as ValueDecl, kinds);
    const listNames = new Set<string>();
    listsOf(decl as unknown as ValueDecl, listNames);
    const value = shownValue(extension, node.id, decl.name);
    const held = new Set<string>();
    stringsIn(value, held);
    const nodes: FieldsGrid["nodes"] = {};
    const labels: FieldsGrid["labels"] = {};
    for (const kind of kinds) {
      nodes[kind] = adapter.nodes(kind).map((n) => ({ id: n.id, label: n.label ?? n.id }));
      const offered = new Set(nodes[kind]!.map((n) => n.id));
      for (const id of held) {
        if (offered.has(id)) continue;
        const name = adapter.label?.(kind, id);
        if (name !== undefined) (labels[kind] ??= {})[id] = name;
      }
    }
    const lists: FieldsGrid["lists"] = {};
    for (const name of listNames) { const l = adapter.list?.(name); if (l) lists[name] = [...l]; }
    return {
      extension: extension.id, extensionName: extension.name, field: decl.name, decl, value,
      locked: o.lock(extension, node), nodes, labels, lists,
    };
  });
  return { hasProject: true, node: { ...node, label: fieldsNodeLabel(project, node.kind, node.id) }, readOnly, grids, hint };
}
