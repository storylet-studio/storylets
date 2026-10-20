// ---------------------------------------------------------------------------
// Storylet extensions on the document pages (patterkit design/proposals/
// patter-storylet-extensions.md, "Tier 1: fields" and "Where fields go"): an
// extension's own fields for a node, drawn by the shell's value rows (every type
// an extension declares, records, maps and lists included), in a group headed by
// the extension's name, and its claims on a box's own fields.
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
import { extensionFold, isSet, valueRows } from "@wildwinter/app-shell/value-rows";
import type { ValueAdapter, ValueDecl } from "@wildwinter/app-shell/value-rows";
import { pickLists } from "@wildwinter/toolkit/extensions";
import type { TargetDecl } from "@wildwinter/toolkit/extensions";
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
}

const rows = valueRows();
/** Values typed but not yet written, by `extension:node:field`. */
const pending = new Map<string, unknown>();
const pendingKey = (ext: string, node: string, field: string): string => `${ext}\u0000${node}\u0000${field}`;

/** The extensions that declare fields for this kind of node, in the project's order. */
export function extensionsFor(project: ProjectDto | undefined, kind: string): ExtensionDto[] {
  return (project?.extensions ?? []).filter((e) => (e.targets[kind]?.fields.length ?? 0) > 0);
}

/** The extension claiming a box's own field of this kind, when one does: its control and help for it. */
export function claimOn(project: ProjectDto | undefined, kind: "card" | "outcome", field: string): { extension: ExtensionDto; decl: ExtensionFieldDto } | undefined {
  for (const extension of project?.extensions ?? []) {
    const claim = extension.targets[kind]?.claims.find((c) => c.field === field);
    if (claim) return { extension, decl: claim.decl };
  }
  return undefined;
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
    const key = pendingKey(extension.id, nodeId, decl.name);
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
      ...(host.readOnly ? {} : {
        onCommit: (v: unknown) => {
          pending.set(key, v);
          host.save(extension.id, nodeId, decl.name, v, () => { if (pending.get(key) === v) pending.delete(key); });
        },
      }),
    });
  };
  return { fields, entry, row, group: (name) => el("h4", "ext-group", name) };
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
