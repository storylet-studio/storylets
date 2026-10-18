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
// A value commits as typed, through the save queue, so typing coalesces into one
// write and one undo step per node. Until the write lands the value the author
// typed is what is shown, so a redraw in between never puts the old one back.
// ---------------------------------------------------------------------------

import { el } from "@wildwinter/app-shell";
import { valueRows } from "@wildwinter/app-shell/value-rows";
import type { ValueAdapter, ValueDecl } from "@wildwinter/app-shell/value-rows";
import type { ExtensionDto, ExtensionFieldDto, ProjectDto } from "../../shared/api.js";

export interface ExtensionHost {
  /** The open project, for its extensions, their values and the nodes they choose from. */
  project(): ProjectDto | undefined;
  /** Queue one value; `landed` is told once the write has come back. */
  save(extension: string, nodeId: string, field: string, value: unknown, landed?: () => void): void;
  /** Drawn but not editable (a project open read-only). */
  readOnly?: boolean;
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

/** How many of a node's extension fields are set, for a tab's count. */
export function extensionCount(extension: ExtensionDto, nodeId: string): number {
  return Object.keys(extension.values[nodeId] ?? {}).length;
}

const adapterOf = (project: ProjectDto | undefined): ValueAdapter => ({
  nodes: (kind) => project?.extensionNodes?.[kind] ?? [],
  // A held node by its name wherever the project has it; undefined, so "gone", only when it has none.
  label: (kind, id) => project?.extensionNodes?.[kind]?.find((n) => n.id === id)?.label,
});

/** One extension's fields for one node: its rows, under a heading for each of the manifest's groups. */
export function extensionFields(host: ExtensionHost, extension: ExtensionDto, kind: string, nodeId: string): HTMLElement {
  const project = host.project();
  const holder = el("div", "ext-fields");
  holder.dataset["extension"] = extension.id;
  const values = extension.values[nodeId] ?? {};
  const adapter = adapterOf(project);
  let group: string | undefined;
  // Editor-only fields included: they are the editor's data, never compiled, and this is the editor.
  for (const decl of extension.targets[kind]?.fields ?? []) {
    if (decl.group !== undefined && decl.group !== group) {
      group = decl.group;
      holder.append(el("h4", "ext-group", group));
    }
    const key = pendingKey(extension.id, nodeId, decl.name);
    const value = pending.has(key) ? pending.get(key) : values[decl.name];
    // A stage the extension has since renamed says so, in place of the row's "not one of the stages".
    const renamedTo = decl.type === "quality" && typeof value === "string" && !(decl.stages ?? []).includes(value)
      ? decl.renamedStages?.[value] : undefined;
    holder.append(rows.row(`${extension.id}:${nodeId}:${decl.name}`, {
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
    }));
  }
  // No sweep: one page draws several extensions and nodes, and a sweep after each would forget the others'
  // rows. The cache holds one row per field of each node opened, which stays small.
  return holder;
}

/** Every extension's fields for one node, each in a group headed by the extension's name: what the card's
 *  Fields tab, an outcome's block, a tag group's page and a tag show. Empty when no extension targets the kind. */
export function extensionGroups(host: ExtensionHost, kind: string, nodeId: string): HTMLElement[] {
  return extensionsFor(host.project(), kind).map((extension) => {
    const section = el("section", "ext-section");
    section.append(el("h3", "ext-heading", extension.name), extensionFields(host, extension, kind, nodeId));
    return section;
  });
}

// --- the tab named for the extension (deck, box, hand template, hand) ------------

const TAB_PREFIX = "ext:";

/** The tabs a page of this kind gains, one per extension declaring fields for it, named for the extension
 *  (an addition to the fixed tab vocabulary, ruled 2026-10-18). Counted by the values the node sets. */
export function extensionTabs(project: ProjectDto | undefined, kind: string, nodeId: string): { key: string; label: string; count: number }[] {
  return extensionsFor(project, kind).map((x) => ({ key: `${TAB_PREFIX}${x.id}`, label: x.name, count: extensionCount(x, nodeId) }));
}

/** A remembered tab that names an extension this page no longer has (another project's, say) is no tab at all:
 *  the page's default instead. */
export function knownTab(project: ProjectDto | undefined, kind: string, tab: string, fallback: string): string {
  if (!tab.startsWith(TAB_PREFIX)) return tab;
  return extensionsFor(project, kind).some((x) => `${TAB_PREFIX}${x.id}` === tab) ? tab : fallback;
}

/** The body of an extension's tab, or undefined when `tab` is not one. */
export function extensionTabBody(host: ExtensionHost, tab: string, kind: string, nodeId: string): HTMLElement | undefined {
  if (!tab.startsWith(TAB_PREFIX)) return undefined;
  const extension = extensionsFor(host.project(), kind).find((x) => `${TAB_PREFIX}${x.id}` === tab);
  if (extension === undefined) return undefined;
  return el("div", { className: "doc-panel" }, extensionFields(host, extension, kind, nodeId));
}
