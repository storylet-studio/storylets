// ---------------------------------------------------------------------------
// Storylet extensions on the document pages (patterkit design/proposals/
// patter-storylet-extensions.md, "Tier 1: fields" and "Where fields go"): an
// extension's own fields for a node, drawn by the shell's value rows (every type
// an extension declares, records, maps and lists included), in a group headed by
// the extension's name.
//
// Where each kind's group goes is the page's business, by the placement rules
// (design/studio-editing-structure.md section 2): a card's after the box's own
// Fields, an outcome's in its block, a deck's, box's, hand template's and hand's
// on a tab named for the extension, a tag group's and a tag's beside their
// properties, the project's in Settings. This module only draws.
//
// Every page folds an extension's section to the fields the node sets (the
// shell's extensionFold, Pattershot's brief F1 to F9, shared with Patterpad):
// the extension's name is the disclosure and counts them. Project Settings
// draws every field, unfolded.
//
// A value commits as typed, through the save queue, so typing coalesces into one
// write and one undo step per node. Until the write lands the value the author
// typed is what is shown, so a redraw in between never puts the old one back.
// ---------------------------------------------------------------------------

import { el } from "@wildwinter/app-shell";
import { extensionFold, isRecordMap, isSet, recordMapSummary, valueRows } from "@wildwinter/app-shell/value-rows";
import type { ValueAdapter, ValueDecl } from "@wildwinter/app-shell/value-rows";
import { pickLists, valueProblems } from "@wildwinter/toolkit/extensions";
import type { TargetDecl, TypeDecl } from "@wildwinter/toolkit/extensions";
import { EXTENSION_PROJECT_OWNER, extensionVcKey } from "../../shared/api.js";
import type { ExtensionDto, ExtensionFieldDto, ProjectDto } from "../../shared/api.js";
import { lockControls } from "./vc-view.js";

export interface ExtensionHost {
  /** The open project, for its extensions, their values and the nodes they choose from. */
  project(): ProjectDto | undefined;
  /** Queue one value; `landed` is told once the write has come back. */
  save(extension: string, nodeId: string, field: string, value: unknown, landed?: () => void): void;
  /** Drawn but not editable (a project open read-only). */
  readOnly?: boolean;
  /** An extension's project values as they stand, for a pick's project lists, when they differ from the
   *  project's saved ones: Project Settings' edits not yet saved. */
  projectEntry?(extension: string): Readonly<Record<string, unknown>> | undefined;
  /** Open (or bring forward) the Fields window on a node, where a map of records is edited as a grid
   *  (Pattershot's brief, H1). Absent: such a map is drawn in place, as any other field. */
  openFields?(kind: string, nodeId: string): void;
  /** Whether a view of an extension opens on this machine; with `openView`, a field naming it as its `editor`
   *  opens it from Edit instead of the Fields window (Y5). */
  viewInstalled?(extension: string, view: string): boolean;
  /** Open (or bring forward) a view of an extension; it follows the page's node. */
  openView?(extension: string, view: string): void;
}

const rows = valueRows();
/** Values typed but not yet written, by `extension:node:field`. */
const pending = new Map<string, unknown>();
const pendingKey = (ext: string, node: string, field: string): string => `${ext}\u0000${node}\u0000${field}`;

/** Save one value through the host, shown as typed until the write lands: a page's row and the Fields window
 *  both commit through here, so an edit from either is the same save and the same undo step. */
export function commitExtensionValue(host: ExtensionHost, extension: string, nodeId: string, field: string, value: unknown): void {
  const key = pendingKey(extension, nodeId, field);
  pending.set(key, value);
  host.save(extension, nodeId, field, value, () => { if (pending.get(key) === value) pending.delete(key); });
}

/** A node's value for one field as the author last made it: one typed but not yet written, else the saved one. */
export function shownValue(extension: ExtensionDto, nodeId: string, field: string): unknown {
  const key = pendingKey(extension.id, nodeId, field);
  return pending.has(key) ? pending.get(key) : extension.values[nodeId]?.[field];
}

/** A node's values for one extension as the author last made them: the saved entry with every value typed but
 *  not yet written laid over it (a cleared one gone). Undefined when it has none. */
export function shownEntry(extension: ExtensionDto, nodeId: string): Record<string, unknown> | undefined {
  let entry: Record<string, unknown> | undefined = extension.values[nodeId];
  const prefix = pendingKey(extension.id, nodeId, "");
  for (const [key, value] of pending) {
    if (!key.startsWith(prefix)) continue;
    entry = { ...(entry ?? {}) };
    const field = key.slice(prefix.length);
    if (value === undefined) delete entry[field]; else entry[field] = value;
  }
  return entry !== undefined && Object.keys(entry).length > 0 ? entry : undefined;
}

/** The extensions that declare fields for this kind of node, in the project's order. */
export function extensionsFor(project: ProjectDto | undefined, kind: string): ExtensionDto[] {
  return (project?.extensions ?? []).filter((e) => (e.targets[kind]?.fields.length ?? 0) > 0);
}

/** How many of a node's extension fields are set, for a tab's count: the fold's rule (`isSet`, a value that is
 *  not the field's default), so a tab's count and its section's caption agree. */
export function extensionCount(extension: ExtensionDto, kind: string, nodeId: string): number {
  const values = extension.values[nodeId] ?? {};
  return (extension.targets[kind]?.fields ?? []).filter((d) => isSet(d as unknown as ValueDecl, values[d.name])).length;
}

/** The adapter for one extension's rows: the project's nodes, and that extension's project lists for a pick's
 *  `list` sources, read off its project values (the toolkit's `pickLists`) when a choice is asked for, so a list
 *  entry added in Project Settings is offered before Save. */
export function adapterOf(host: ExtensionHost, extension: ExtensionDto): ValueAdapter {
  const project = host.project();
  const target = { fields: extension.targets["project"]?.fields ?? [] } as unknown as TargetDecl;
  const saved = project?.projectNode !== undefined ? extension.values[project.projectNode] : undefined;
  return {
    nodes: (kind) => project?.extensionNodes?.[kind] ?? [],
    // A held node by its name wherever the project has it; undefined, so "gone", only when it has none.
    label: (kind, id) => project?.extensionNodes?.[kind]?.find((n) => n.id === id)?.label,
    list: (name) => pickLists(target, host.projectEntry?.(extension.id) ?? saved)(name),
  };
}

/** Whose extension shards hold a node's values: its box's id, or the project's own owner for the project and
 *  the map's tags. */
export function extensionOwner(project: ProjectDto | undefined, kind: string, nodeId: string): string {
  if (kind === "project") return EXTENSION_PROJECT_OWNER;
  return project?.extensionNodes?.[kind]?.find((n) => n.id === nodeId)?.box ?? EXTENSION_PROJECT_OWNER;
}

/** One extension's parts for one node: its fields, the values shown (a value typed but not yet written over the
 *  saved one), a row per field and a heading per group. Drawn whole (`extensionFields`) or folded
 *  (`extensionSection`). */
function extensionParts(host: ExtensionHost, extension: ExtensionDto, kind: string, nodeId: string): {
  fields: readonly ExtensionFieldDto[]; entry: Record<string, unknown> | undefined;
  row: (decl: ExtensionFieldDto) => HTMLElement; group: (name: string) => HTMLElement;
} {
  const fields = extension.targets[kind]?.fields ?? [];
  const saved = extension.values[nodeId];
  let entry = saved;
  for (const decl of fields) {
    const key = pendingKey(extension.id, nodeId, decl.name);
    if (pending.has(key)) entry = { ...(entry ?? {}), [decl.name]: pending.get(key) };
  }
  const adapter = adapterOf(host, extension);
  const row = (decl: ExtensionFieldDto): HTMLElement => {
    if (host.openFields && isRecordMap(decl as unknown as ValueDecl)) {
      const view = decl.editor !== undefined ? extension.views?.find((v) => v.id === decl.editor) : undefined;
      const here = view !== undefined && host.openView !== undefined && host.viewInstalled?.(extension.id, view.id) === true;
      return recordMapSummaryRow(decl, entry?.[decl.name], adapter, () => host.openFields!(kind, nodeId),
        view ? { name: view.name, ...(here ? { open: () => host.openView!(extension.id, view.id) } : {}) } : null, extension.name);
    }
    const value = entry?.[decl.name];
    // A stage the extension has since renamed says so, in place of the row's "not one of the stages".
    const renamedTo = decl.type === "quality" && typeof value === "string" && !(decl.stages ?? []).includes(value)
      ? decl.renamedStages?.[value] : undefined;
    return rows.row(`${extension.id}:${nodeId}:${decl.name}`, {
      decl: decl as unknown as ValueDecl,
      value,
      adapter,
      // The card Fields tab's row classes, so an extension's rows line up with the box's own.
      className: "doc-row doc-row-top", labelClassName: "doc-row-label", controlClassName: "insp-input",
      ...(renamedTo !== undefined ? { replaceProblem: `${extension.name} has since renamed this stage “${renamedTo}”. Pick “${renamedTo}” to update it.` } : {}),
      ...(host.readOnly ? {} : { onCommit: (v: unknown) => commitExtensionValue(host, extension.id, nodeId, decl.name, v) }),
    });
  };
  return { fields, entry, row, group: (name) => el("h4", "ext-group", name) };
}

/**
 * A map of records on a page (Pattershot's brief, H3): too big for a row, so a line per key with the record's
 * set values ("TAM: smile, nod, WREN"), and an Edit button that opens the Fields window, where it is edited as
 * a grid. With no keys, the Edit button alone. A problem inside it is said here too, so the page still shows
 * it's there. The Edit button stays live on a locked shard: it only opens the window, which is then read-only.
 */
function recordMapSummaryRow(decl: ExtensionFieldDto, value: unknown, adapter: ValueAdapter, open: () => void,
  /** A view of the extension's that edits the field (Y5): opening when `open` is given (installed here), else
   *  named in the tip as what would open once it is. */
  editor: { name: string; open?: () => void } | null, extensionName: string): HTMLElement {
  const row = el("div", "shell-fieldrow doc-row doc-row-top ext-summary");
  const label = el("span", "shell-fieldrow-label doc-row-label", decl.label ?? decl.name);
  const body = el("div", "shell-fieldrow-body");
  const lines = recordMapSummary(decl as unknown as ValueDecl, value, adapter);
  if (lines.length) body.append(el("div", "ext-summary-lines", ...lines.map((l) => el("div", "ext-summary-line", l))));
  const edit = el("button", "btn ext-edit", "Edit");
  edit.type = "button";
  const what = decl.label ?? decl.name;
  edit.dataset["tip"] = editor?.open ? `Edit ${what} in the ${editor.name}`
    : editor ? `Edit ${what} in the Fields window. The ${editor.name} opens here instead once ${extensionName} is installed on this machine (File > Add Extension...).`
      : `Edit ${what} in the Fields window`;
  edit.addEventListener("click", editor?.open ?? open);
  body.append(edit);
  const exists = (kind: string, id: string): boolean => adapter.nodes(kind).some((n) => n.id === id) || adapter.label?.(kind, id) !== undefined;
  const inner = value === undefined ? [] : valueProblems(decl as unknown as TypeDecl, value, {
    exists, ...(adapter.list ? { list: (name: string) => adapter.list!(name) } : {}),
  }).filter((p) => p.severity === "error");
  if (inner.length) {
    body.append(el("p", "shell-fieldrow-problem", "Something in here needs a fix: Edit shows where."));
    row.classList.add("has-problem");
  }
  row.append(label, body);
  return row;
}

/** Marks the element holding an extension's rows with the shard they write, for version control: somebody else
 *  holding it locks these rows, and only these (vc-view.ts `applyExtensionLocks`). */
function markShard(holder: HTMLElement, project: ProjectDto | undefined, extension: ExtensionDto, kind: string, nodeId: string): void {
  holder.dataset["extension"] = extension.id;
  holder.dataset["extVc"] = extensionVcKey(extensionOwner(project, kind, nodeId), extension.id);
  holder.dataset["extName"] = extension.name;
}

/** One extension's fields for one node, every one, under a heading for each of the manifest's groups: Project
 *  Settings', which doesn't fold (it's where an author goes to set things). */
export function extensionFields(host: ExtensionHost, extension: ExtensionDto, kind: string, nodeId: string): HTMLElement {
  const holder = el("div", "ext-fields");
  markShard(holder, host.project(), extension, kind, nodeId);
  const parts = extensionParts(host, extension, kind, nodeId);
  let group: string | undefined;
  // Editor-only fields included: they are the editor's data, never compiled, and this is the editor.
  for (const decl of parts.fields) {
    if (decl.group !== undefined && decl.group !== group) { group = decl.group; holder.append(parts.group(group)); }
    holder.append(parts.row(decl));
  }
  // No sweep: one page draws several extensions and nodes, and a sweep after each would forget the others'
  // rows. The cache holds one row per field of each node opened, which stays small.
  return holder;
}

/** The pages' fold, kept across their redraws: each extension's section stays folded or open as the author
 *  left it, from node to node (the shell's extensionFold; Pattershot's brief, F4). */
const fold = extensionFold();

/** At the end of each page draw: forget the rows the fold kept for nodes the draw didn't show, so a value
 *  cleared while folded keeps its row until the author leaves the node (F5). */
export function sweepExtensionFold(): void { fold.sweep(); }

/**
 * One extension's section for one node, folded: the extension's name as the caption and disclosure, counting
 * what the node sets ("Probe (3 set)"), then only the fields set here until the author opens it to every field
 * (the shell's extensionFold, Pattershot's brief F1 to F7). `panel` sits the rows in a panel, for a page whose
 * other sections are panelled.
 */
export function extensionSection(host: ExtensionHost, extension: ExtensionDto, kind: string, nodeId: string, o: { panel?: boolean } = {}): HTMLElement {
  const parts = extensionParts(host, extension, kind, nodeId);
  const section = fold.section({
    extension: extension.id, caption: extension.name, node: `${kind}\u0000${nodeId}`,
    fields: parts.fields as unknown as ValueDecl[], entry: parts.entry,
    row: (decl) => parts.row(decl as unknown as ExtensionFieldDto), group: parts.group,
    className: "doc-sect ext-section", captionClassName: "ext-heading insp-label",
  });
  markShard(section, host.project(), extension, kind, nodeId);
  if (o.panel) section.querySelector(":scope > .shell-fold-body")?.classList.add("doc-panel");
  // Opening the fold draws rows the page's lock never saw: lock them as it locked the rest.
  section.querySelector(":scope > .shell-fold-cap")?.addEventListener("click", () => {
    const off = section.closest<HTMLElement>(".vc-readonly");
    if (off) lockControls(off, true);
  });
  return section;
}

/** Every extension's section for one node, folded: what the card's Fields tab shows after the box's own
 *  fields. Empty when no extension targets the kind. */
export function extensionGroups(host: ExtensionHost, kind: string, nodeId: string): HTMLElement[] {
  return extensionsFor(host.project(), kind).map((extension) => extensionSection(host, extension, kind, nodeId));
}

// --- the tab named for the extension (deck, box, hand template, hand) ------------

const TAB_PREFIX = "ext:";

/** The tabs a page of this kind gains, one per extension declaring fields for it, named for the extension
 *  (an addition to the fixed tab vocabulary, ruled 2026-10-18). Counted by the values the node sets. */
export function extensionTabs(project: ProjectDto | undefined, kind: string, nodeId: string): { key: string; label: string; count: number }[] {
  return extensionsFor(project, kind).map((x) => ({ key: `${TAB_PREFIX}${x.id}`, label: x.name, count: extensionCount(x, kind, nodeId) }));
}

/** A remembered tab that names an extension this page no longer has (another project's, say) is no tab at all:
 *  the page's default instead. */
export function knownTab(project: ProjectDto | undefined, kind: string, tab: string, fallback: string): string {
  if (!tab.startsWith(TAB_PREFIX)) return tab;
  return extensionsFor(project, kind).some((x) => `${TAB_PREFIX}${x.id}` === tab) ? tab : fallback;
}

/** The body of an extension's tab, or undefined when `tab` is not one: its section, folded as every node's is, so
 *  an extension left alone doesn't clutter the page. */
export function extensionTabBody(host: ExtensionHost, tab: string, kind: string, nodeId: string): HTMLElement | undefined {
  if (!tab.startsWith(TAB_PREFIX)) return undefined;
  const extension = extensionsFor(host.project(), kind).find((x) => `${TAB_PREFIX}${x.id}` === tab);
  if (extension === undefined) return undefined;
  return el("div", { className: "doc-panel" }, extensionSection(host, extension, kind, nodeId));
}
