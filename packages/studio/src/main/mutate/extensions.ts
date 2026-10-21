// ---------------------------------------------------------------------------
// Storylet extension values, written: one field on one node, into the
// extension's shard for the node's box (or the project's own, at the root), as
// one undo step per node, so typing into one node's fields coalesces. And a
// view's write (patterkit design/view-extensions.md): several values on any
// nodes as ONE undo step with the view's label, or refused whole. And Add
// Extension..., which takes an extension's manifest into the project.
// ---------------------------------------------------------------------------

import { extensionNodes } from "@storylet-studio/compiler";
import { planExtensionValue, planExtensionValues, planTakeExtensions } from "@storylet-studio/ops";
import { manifestProblems, pickLists, targetOf, valueProblems } from "@wildwinter/toolkit/extensions";
import type { Manifest, TypeDecl } from "@wildwinter/toolkit/extensions";
import { extensionLine, quoted, valueProblemSentence } from "@wildwinter/app-shell/extension-copy";
import { commit, freshKey, refuse } from "./write-path.js";
import type { Written } from "./write-path.js";
import { heldRefusal } from "../project.js";
import type { ProjectSession } from "../project.js";
import { extensionNodeChoices } from "../extensions.js";
import { readRemote, refuseWrite } from "../remote.js";
import type { ExtensionEditDto, ExtensionWriteRefusal, ExtensionWriteResult } from "../../shared/api.js";

export async function setExtensionValue(
  session: ProjectSession, extension: string, nodeId: string, field: string, value: unknown,
): Promise<Written> {
  const source = session.loaded.source;
  if (source === undefined) return refuse(session, "the project did not load");
  const write = planExtensionValue(session.loaded.dir, source, extension, nodeId, field, value);
  if (write === undefined) return refuse(session, `there is nothing with the id ${nodeId} to set a value on`);
  const name = session.dto.extensions?.find((e) => e.id === extension)?.name ?? extension;
  return commit(session, `Edit ${name}`, `ext:${extension}:${nodeId}`, [write]);
}

/** The words a refusal names a node kind by. */
const KIND_WORD: Record<string, string> = {
  project: "project", box: "box", deck: "deck", card: "card", outcome: "outcome", tag: "tag", tagGroup: "tag group",
  hand: "hand", handTemplate: "hand template",
};

/**
 * A view's write: several values of one extension, on any nodes, as ONE undo step with the view's label, or
 * refused whole. Each value is checked as the Fields rows check it (a field the extension declares for that
 * node's kind, of its type, naming nodes that exist), and nothing is written when one fails (`bad-request`), a
 * node has gone (`gone`), the project may not be written under its key (`read-only`), or somebody else holds a
 * shard the write would change (`held`, naming them, as an undo's refusal does). Every shard the edits touch
 * is written in the one step, so Undo takes the whole write back.
 */
export async function setExtensionValues(
  session: ProjectSession, extension: string, label: string, edits: readonly ExtensionEditDto[],
): Promise<ExtensionWriteResult> {
  const no = (code: ExtensionWriteRefusal, error: string): ExtensionWriteResult => ({ error, code });
  const source = session.loaded.source;
  if (source === undefined) return no("failed", "The project didn't load.");
  const pin = source.project.extensions?.[extension];
  const file = (source.manifests ?? []).find((m) => m.id === extension);
  if (pin === undefined || file === undefined || manifestProblems(file.manifest).some((p) => p.severity === "error")) {
    return no("bad-request", `This project doesn't take ${quoted(extension)}, so nothing was written.`);
  }
  const manifest = file.manifest as Manifest;
  const name = manifest.name;
  const nodes = extensionNodes(source);
  const choices = extensionNodeChoices(source);
  const phrase = (kind: string, id: string): string => {
    if (kind === "project") return "the project";
    const label = choices[kind]?.find((n) => n.id === id)?.label;
    return `the ${KIND_WORD[kind] ?? kind} ${quoted(label ?? id)}`;
  };
  const projectId = source.project.project.id;
  const projectEntry = (session.dto.extensions?.find((x) => x.id === extension)?.values ?? {})[projectId];
  const lists = pickLists(targetOf(manifest, "storylets", "project"), projectEntry);
  const exists = (kind: string, id: string): boolean => nodes.get(id)?.kind === kind;
  for (const edit of edits) {
    const kind = nodes.get(edit.node)?.kind;
    if (kind === undefined) return no("gone", `There's nothing with the id ${edit.node} in this project now, so nothing was written.`);
    const decl = targetOf(manifest, "storylets", kind)?.fields?.find((f) => f.name === edit.field);
    if (decl === undefined) return no("bad-request", `${name} has no field ${quoted(edit.field)} on ${phrase(kind, edit.node)}, so nothing was written.`);
    if (edit.value === undefined) continue;
    const wrong = valueProblems(decl as TypeDecl, edit.value, { exists, list: lists }).find((p) => p.severity === "error");
    if (wrong !== undefined) {
      const field = decl.label ?? decl.name;
      const said = extensionLine(name, valueProblemSentence(wrong.code, wrong.message, {
        extension: name, node: phrase(kind, edit.node), field, place: "on its page", kindWord: (k) => KIND_WORD[k] ?? k,
      }));
      return no("bad-request", `${said ?? `${name}: ${field} on ${phrase(kind, edit.node)}: ${wrong.message}.`} Nothing was written.`);
    }
  }
  const planned = planExtensionValues(session.loaded.dir, source, extension, edits);
  if ("gone" in planned) return no("gone", `There's nothing with the id ${planned.gone} in this project now, so nothing was written.`);
  const paths = planned.map((w) => w.path);
  const role = refuseWrite(readRemote(session.loaded.dir)?.role, paths);
  if (role !== undefined) return no("read-only", `This project came from a server with an author's key, and ${name}'s data is the designer's to change.`);
  const held = await heldRefusal(session, paths);
  if (held !== undefined) return no("held", held);
  const result = await commit(session, label, freshKey("view"), planned);
  return "error" in result ? no("failed", result.error) : result;
}

/**
 * Add Extension...: an extension's manifest, from its package, taken into the project as ONE undo step: the
 * manifest written where the project keeps manifests, the project pinned to its version, and,
 * for an extension the project took at another version, what `storyletengine format` does on a new version
 * (renamed stages, then the pin). `items` holds the extensions it requires that the project lacks first, then
 * it, each with its manifest file as the package has it, so undoing never leaves one without the other.
 */
export async function addExtension(session: ProjectSession, items: readonly { manifest: Manifest; text: string }[]): Promise<Written> {
  const source = session.loaded.source;
  if (source === undefined) return refuse(session, "the project did not load");
  const take = planTakeExtensions(session.loaded.dir, source, items);
  const names = items.map((i) => i.manifest.name);
  const label = `Add ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]}`;
  return commit(session, label, freshKey("ext"), [...take.writes].map(([path, content]) => ({ path, content })));
}
