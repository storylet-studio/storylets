// ---------------------------------------------------------------------------
// Storylet extensions: the one manifest-driven pass (patterkit
// design/proposals/patter-storylet-extensions.md, "The command lines").
//
// The compiler knows that extension data exists, and its shape, never its
// meaning. Everything about the shape is `@wildwinter/toolkit/extensions`' (the
// manifest's checks, the value checks, what a bundle carries of a declaration
// and of a value); what is this format's is where the data sits (one shard per
// extension per box, and one at the root), which nodes there are, and how a
// claim meets the fields a box declares.
//
// Pure, and a function of the source alone, so the content hash can ask it
// for the compiled data without compiling the rest.
// ---------------------------------------------------------------------------

import { EXTENSIONS_DIR, MANIFEST_EXTENSION, isTextFieldType } from "@storylet-studio/model";
import type { BundleExtension, ExtensionFieldDecl, FieldDecl, NodeExtensions } from "@storylet-studio/model";
import {
  HOSTS, claimClashes, compileEntry, compiledTarget, effectiveClaim, entryProblems, manifestProblems, orphanedEntries,
  pickClashes, pickLists, resolvedClaims, settingValues, targetOf, valueProblems,
} from "@wildwinter/toolkit/extensions";
import type { Manifest, Problem, ResolvedClaim, TypeDecl, ValueContext } from "@wildwinter/toolkit/extensions";
import type { Issue, SourceExtension, SourceProject } from "./project.js";

/** What the pass hands the bundle. */
export interface CompiledExtensions {
  /** The bundle's `extensions` section, by extension id. Empty when the project takes none. */
  readonly bundle: Record<string, BundleExtension>;
  /** Each node's compiled values, by node id: what goes on the node as `extensions`. */
  readonly nodes: ReadonlyMap<string, NodeExtensions>;
}

/** A node the project has: its kind, and the box it belongs to (none for the project's own). */
interface NodeInfo { readonly kind: string; readonly box?: string }

/** Every node an extension can attach to, by id. Ids are project-unique. */
export function extensionNodes(source: SourceProject): Map<string, NodeInfo> {
  const nodes = new Map<string, NodeInfo>();
  nodes.set(source.project.project.id, { kind: "project" });
  const group = source.map?.group;
  if (group !== undefined) {
    nodes.set(group.id, { kind: "tagGroup" });
    for (const tag of group.tags ?? []) nodes.set(tag.id, { kind: "tag" });
  }
  for (const box of source.boxes) {
    const b = box.box.box.id;
    nodes.set(b, { kind: "box", box: b });
    for (const g of box.tags.groups ?? []) {
      nodes.set(g.id, { kind: "tagGroup", box: b });
      for (const tag of g.tags ?? []) nodes.set(tag.id, { kind: "tag", box: b });
    }
    for (const t of box.hands.templates ?? []) nodes.set(t.id, { kind: "handTemplate", box: b });
    for (const h of box.hands.hands ?? []) nodes.set(h.id, { kind: "hand", box: b });
    for (const deck of box.decks) {
      nodes.set(deck.shard.deck.id, { kind: "deck", box: b });
      for (const card of deck.shard.cards ?? []) {
        nodes.set(card.id, { kind: "card", box: b });
        for (const outcome of card.outcomes ?? []) nodes.set(outcome.id, { kind: "outcome", box: b });
      }
    }
  }
  return nodes;
}

/** A problem from the shared checks, in this compiler's report shape. */
const issueOf = (path: string, p: Problem, prefix = "", field?: string, extension?: string): Issue => ({
  severity: p.severity, path,
  ...(field !== undefined ? { field } : {}),
  message: p.path === "" ? `${prefix}${p.message}` : `${prefix}${p.path}: ${p.message}`,
  ...(extension !== undefined ? { extension, detail: p.code } : {}),
});

/** The extensions a project takes and the manifests it has, matched up. */
interface Taken {
  readonly id: string;
  readonly version: string;
  readonly settings: Readonly<Record<string, unknown>>;
  /** The manifest, when the project has a sound one. */
  readonly manifest?: Manifest;
}

/**
 * Validate every extension, and compile what may be compiled. Issues are the
 * pass's report; `compiled` is what the bundle carries. Data whose manifest is
 * missing or unsound is reported and left out of the bundle, never changed.
 */
export function extensionPass(source: SourceProject): { issues: Issue[]; compiled: CompiledExtensions } {
  const issues: Issue[] = [];
  const projectPath = source.path;
  const taken = source.project.extensions ?? {};
  const manifests = new Map<string, { path: string; manifest: unknown; sound: boolean }>();

  // --- the manifests --------------------------------------------------------------
  for (const m of source.manifests ?? []) {
    const problems = manifestProblems(m.manifest);
    for (const p of problems) issues.push(issueOf(m.path, p, "manifest ", undefined, m.id));
    let sound = !problems.some((p) => p.severity === "error");
    const id = (m.manifest as { id?: unknown } | null)?.id;
    if (sound && id !== m.id) {
      issues.push({ severity: "error", path: m.path,
        message: `the manifest's id is "${String(id)}", but its file is named for "${m.id}"; a manifest is called <id>${MANIFEST_EXTENSION}` });
      sound = false;
    }
    if (sound && (m.manifest as Manifest).targets.storylets === undefined) {
      issues.push({ severity: "warning", path: m.path,
        message: `"${m.id}" is not a Storylet extension: its manifest targets no Storylets node kind, so it adds nothing here` });
    }
    manifests.set(m.id, { path: m.path, manifest: m.manifest, sound });
  }

  // --- what the project takes ---------------------------------------------------------
  const takenList: Taken[] = [];
  for (const [id, entry] of Object.entries(taken)) {
    const m = manifests.get(id);
    const version = typeof entry?.version === "string" ? entry.version : "";
    const settings = (entry?.settings ?? {}) as Record<string, unknown>;
    if (m === undefined) {
      issues.push({ extension: id, severity: "warning", path: projectPath, field: "extensions",
        message: `the project takes the Storylet extension "${id}", but has no manifest for it at ${EXTENSIONS_DIR}/${id}${MANIFEST_EXTENSION}; its data is left as it is, and not compiled` });
      takenList.push({ id, version, settings });
      continue;
    }
    if (!m.sound) { takenList.push({ id, version, settings }); continue; }
    const manifest = m.manifest as Manifest;
    if (version !== manifest.version) {
      issues.push({ extension: id, severity: "warning", path: projectPath, field: "extensions",
        message: `the project takes "${id}" ${version === "" ? "with no version" : `at version ${version}`}, but its manifest is version ${manifest.version}; run \`storyletengine format\` to take it (renamed stages are renamed in the data as it does)` });
    }
    const known = new Set((manifest.settings ?? []).map((s) => s.name));
    for (const [name, value] of Object.entries(settings)) {
      if (!known.has(name)) {
        issues.push({ extension: id, severity: "warning", path: projectPath, field: "extensions",
          message: `"${id}" has no setting "${name}"; it is ignored` });
      } else if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        issues.push({ extension: id, severity: "error", path: projectPath, field: "extensions",
          message: `"${id}"'s setting "${name}" names a field, so it is a field name, not ${JSON.stringify(value)}` });
      }
    }
    takenList.push({ id, version, settings, manifest });
  }
  const sound = new Map(takenList.filter((t) => t.manifest !== undefined).map((t) => [t.id, t.manifest!]));
  const settingsOf = new Map(takenList.map((t) => [t.id, t.settings]));

  // --- claims on host fields ----------------------------------------------------------
  const claims: ResolvedClaim[] = takenList.flatMap((t) => (t.manifest ? resolvedClaims(t.manifest, "storylets", t.settings) : []));
  for (const p of claimClashes(claims)) issues.push({ severity: p.severity, path: projectPath, field: "extensions", message: p.message });
  issues.push(...claimIssues(source, claims));

  // --- the data ---------------------------------------------------------------------------
  const nodes = extensionNodes(source);
  const exists = (kind: string, id: string): boolean => nodes.get(id)?.kind === kind;
  const values = new Map<string, NodeExtensions>();
  const projectValues = new Map<string, Record<string, unknown>>();
  const shards: { file: SourceExtension; box?: string }[] = [
    ...(source.extensions ?? []).map((file) => ({ file })),
    ...source.boxes.flatMap((b) => (b.extensions ?? []).map((file) => ({ file, box: b.box.box.id }))),
  ];
  // A pick's choices: the project's nodes by kind, and each extension's own project lists, read off its
  // project entry wherever that entry sits (it belongs in the root shard, but any shard may hold it).
  const projectId = source.project.project.id;
  const projectEntries = new Map<string, Record<string, unknown>>();
  for (const { file } of shards) {
    const entry = (file.shard.entries as Record<string, Record<string, unknown> | undefined> | undefined)?.["project"]?.[projectId];
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry) && !projectEntries.has(file.shard.extension)) {
      projectEntries.set(file.shard.extension, entry as Record<string, unknown>);
    }
  }
  const contexts = new Map<string, ValueContext>();
  for (const [ext, manifest] of sound) {
    contexts.set(ext, { exists, list: pickLists(targetOf(manifest, "storylets", "project"), projectEntries.get(ext)) });
  }
  const nodesOf = (kind: string): { id: string }[] => [...nodes].filter(([, n]) => n.kind === kind).map(([id]) => ({ id }));
  for (const [ext, manifest] of [...sound].sort(([a], [b]) => a.localeCompare(b))) {
    // A name two of a pick's sources hold, once for the project however many fields offer it.
    const said = new Set<string>();
    for (const decl of pickDecls(manifest)) {
      for (const p of pickClashes(decl, { nodes: nodesOf, list: contexts.get(ext)!.list! })) {
        if (said.has(p.message)) continue;
        said.add(p.message);
        issues.push({ extension: ext, severity: p.severity, path: projectPath, field: "extensions", detail: p.code,
          message: `the Storylet extension "${ext}": ${p.message}` });
      }
    }
  }
  for (const { file, box } of shards) {
    const stem = file.path.split("/").pop()!.replace(/\.storyletextension$/, "");
    const shard = file.shard;
    if (shard.extension !== stem) {
      issues.push({ extension: stem, severity: "error", path: file.path, field: "extension",
        message: `this shard says it holds "${String(shard.extension)}", but it is named for "${stem}"` });
      continue;
    }
    const takenHere = Object.prototype.hasOwnProperty.call(taken, stem);
    if (!takenHere) {
      issues.push({ extension: stem, severity: "warning", path: file.path,
        message: `data for the Storylet extension "${stem}", which the project does not take; it is left as it is, and not compiled` });
      continue;
    }
    const manifest = sound.get(stem);
    const entries = shard.entries;
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
      issues.push({ extension: stem, severity: "error", path: file.path, field: "entries", message: "entries are an object, by node kind and then node id" });
      continue;
    }
    for (const p of orphanedEntries(shard, exists)) issues.push(issueOf(file.path, p, "", undefined, stem));
    if (manifest === undefined) continue;   // reported above; the data stays as it is
    for (const [kind, byNode] of Object.entries(entries)) {
      if (!HOSTS.storylets.kinds.includes(kind)) {
        issues.push({ extension: stem, severity: "warning", path: file.path, field: "entries",
          message: `entries.${kind}: "${kind}" is not a Storylets node kind; these entries are kept, and not compiled` });
        continue;
      }
      const target = targetOf(manifest, "storylets", kind);
      if (target === undefined) {
        issues.push({ extension: stem, severity: "warning", path: file.path, field: "entries",
          message: `entries.${kind}: "${stem}" declares nothing for a ${kind}; these entries are kept, and not compiled` });
        continue;
      }
      if (typeof byNode !== "object" || byNode === null || Array.isArray(byNode)) continue;
      for (const [id, entry] of Object.entries(byNode)) {
        const node = nodes.get(id);
        if (node === undefined || node.kind !== kind) continue;   // an orphan: reported above
        if (node.box !== box) {
          issues.push({ extension: stem, severity: "warning", path: file.path, where: id,
            message: `entries.${kind}.${id} belongs ${node.box === undefined ? "in the project's own shard" : "in its own box's shard"}; it is compiled from here all the same` });
        }
        const problems = entryProblems(target, entry, contexts.get(stem) ?? { exists });
        for (const p of problems) issues.push(issueOf(file.path, p, `entries.${kind}.${id}${p.path === "" ? ": " : "."}`, "entries", stem));
        if (problems.some((p) => p.severity === "error")) continue;
        const compiled = compileEntry(target, entry as Record<string, unknown>);
        if (compiled === undefined) continue;
        if (kind === "project") { projectValues.set(stem, compiled); continue; }
        values.set(id, { ...(values.get(id) ?? {}), [stem]: compiled });
      }
    }
  }

  // --- the bundle's section ---------------------------------------------------------------
  const bundle: Record<string, BundleExtension> = {};
  for (const [id, manifest] of [...sound.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const fields: Record<string, ExtensionFieldDecl[]> = {};
    for (const kind of Object.keys(manifest.targets.storylets ?? {}).sort()) {
      const target = targetOf(manifest, "storylets", kind);
      if (target !== undefined) fields[kind] = compiledTarget(target) as unknown as ExtensionFieldDecl[];
    }
    const project = projectValues.get(id);
    // Every setting, resolved, so a game reads which host field a claim presents as the project chose it.
    const settings = (manifest.settings ?? []).length > 0 ? settingValues(manifest, settingsOf.get(id)) : undefined;
    bundle[id] = {
      version: manifest.version, fields,
      ...(project !== undefined ? { project } : {}),
      ...(settings !== undefined ? { settings } : {}),
    };
  }
  return { issues, compiled: { bundle, nodes: values } };
}

/** Every pick a manifest declares for Storylets, at any depth (in a record, or as a map's or a list's items). */
function pickDecls(manifest: Manifest): TypeDecl[] {
  const out: TypeDecl[] = [];
  const walk = (decl: TypeDecl): void => {
    if (decl.type === "pick") out.push(decl);
    for (const f of decl.fields ?? []) walk(f);
    if (decl.of !== undefined) walk(decl.of);
  };
  for (const target of Object.values(manifest.targets.storylets ?? {})) for (const f of target.fields ?? []) walk(f);
  return out;
}

/** The family's word for a host field's type: `string` reads as `text`. */
const familyType = (type: string): string => (isTextFieldType(type) && type !== "multiline" ? "text" : type);

/**
 * Claims against the boxes. A box that declares the claimed field with another
 * type is an error naming the box (ruled 2026-10-18: card and outcome fields are
 * declared per box, so one name can have two types); every value the field
 * holds is checked against the claim's own constraints too.
 */
function claimIssues(source: SourceProject, claims: readonly ResolvedClaim[]): Issue[] {
  const issues: Issue[] = [];
  for (const claim of claims) {
    if (claim.kind !== "card" && claim.kind !== "outcome") continue;
    const outcome = claim.kind === "outcome";
    // A claim on a field no box declares presents nothing: most often the
    // project's setting names a field that was renamed. A warning, as Patter
    // gives for a claim on game data its project does not declare. Per claim,
    // not per box: a box without the field is ordinary, as boxes differ.
    const declaredSomewhere = source.boxes.some((box) =>
      ((outcome ? box.box.box.outcomeFields : box.box.box.fields) ?? []).some((d) => d.name === claim.field));
    if (!declaredSomewhere) {
      issues.push({ extension: claim.extension, severity: "warning", path: source.path, field: "extensions",
        message: `the Storylet extension "${claim.extension}" claims the ${claim.kind} field "${claim.field}", which no box declares; set the extension's "${claim.claim.setting}" setting to the field's name, or declare it` });
      continue;
    }
    for (const box of source.boxes) {
      const decls: readonly FieldDecl[] = (outcome ? box.box.box.outcomeFields : box.box.box.fields) ?? [];
      const decl = decls.find((d) => d.name === claim.field);
      if (decl === undefined) continue;
      const boxPath = `${box.path}/box.storyletbox`;
      const boxName = box.box.box.gameId ?? box.box.box.id;
      if (familyType(decl.type) !== familyType(claim.claim.type)) {
        issues.push({ extension: claim.extension, severity: "error", path: boxPath, where: boxName, field: outcome ? "outcomeFields" : "fields",
          message: `the Storylet extension "${claim.extension}" claims the ${claim.kind} field "${claim.field}" as ${claim.claim.type}, but box "${boxName}" declares it as ${decl.type}` });
        continue;
      }
      for (const deck of box.decks) {
        for (const card of deck.shard.cards ?? []) {
          const holders = outcome ? (card.outcomes ?? []).map((o) => ({ where: `${card.gameId ?? card.id}/${o.gameId ?? o.id}`, fields: o.fields }))
            : [{ where: card.gameId ?? card.id, fields: card.fields }];
          for (const h of holders) {
            if (h.fields === undefined || !Object.prototype.hasOwnProperty.call(h.fields, claim.field)) continue;
            // The claim over the box's own declaration: a claim may leave the values or stages to the box's field.
            for (const p of valueProblems(effectiveClaim(claim.claim, decl), h.fields[claim.field])) {
              issues.push({ severity: p.severity, path: deck.path, where: h.where, field: outcome ? "outcomeFields" : "fields",
                message: `field "${claim.field}", as the Storylet extension "${claim.extension}" claims it: ${p.message}`,
                extension: claim.extension, detail: p.code });
            }
          }
        }
      }
    }
  }
  return issues;
}

/** The compiled data the content hash covers: what the bundle carries, and nothing editor-only. */
export function extensionHashInput(source: SourceProject): unknown {
  if (source.project.extensions === undefined && (source.manifests ?? []).length === 0) return undefined;
  const { compiled } = extensionPass(source);
  if (Object.keys(compiled.bundle).length === 0 && compiled.nodes.size === 0) return undefined;
  return { bundle: compiled.bundle, nodes: Object.fromEntries([...compiled.nodes.entries()].sort(([a], [b]) => a.localeCompare(b))) };
}
