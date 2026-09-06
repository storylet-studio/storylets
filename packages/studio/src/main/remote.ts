// ---------------------------------------------------------------------------
// The pack exchange: pack bytes over plain HTTP, to and from a server whose
// address and code somebody was given.
//
// This is the generic half of the round trip the send envelope already has
// (pack-merge-back.md). A pack goes out, a pack comes back, and the merge is
// the one the editor and the CLI already use; what this file adds is three
// calls, a small record of where a project came from, and the rule about which
// shards a key may change.
//
// Electron-free on purpose, like project.ts: everything here is testable
// against a real server on a loopback port, and main does the dialogs.
//
// WHAT IS WRITTEN BESIDE THE SHARDS. A project that came from a server keeps
// one small file at its root, `storylets.server.json`, naming the address, the
// installation, the version, the revision it was last level with and the role
// of the key that fetched it. It is NOT a shard: `pack` walks shard extensions
// only, so the record never travels inside a pack of ours, which is why a push
// declares the installation, the version and the base as fields of the request
// instead.
//
// THE KEY DECIDES WHAT MAY CHANGE. An author's key may change deck and comment
// shards; everything else is the shape, and the editor says so with the same
// sentence the far end would refuse with. That is a courtesy, not the
// enforcement: the enforcement is at the other end, and it is the one that
// counts.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import { SHARD_EXTENSIONS } from "@storylet-studio/model";
import {
  CONFLICT_SIDECAR_EXTENSION, conflictSidecar, runMerge, runPack, runUnpack,
} from "@storylet-studio/ops";

/** The record beside the project's shards. Named for the file a pack from a
 *  server carries beside its manifest, because that file IS this record: a
 *  pack opened from disk lands it in the project folder on its own. */
export const REMOTE_FILE = "storylets.server.json";

/** The provenance schema a server-issued pack declares. */
const REMOTE_SCHEMA = "storylets/server-provenance@0";

/** The one sentence an author gets for reaching at the shape. The far end says
 *  it too; saying it here as well is what keeps the editor from offering an
 *  edit that could only ever be refused. */
export const PULL_AS_DESIGNER = "pull as designer to change the shape";

export type RemoteRole = "author" | "designer";

/**
 * What a project remembers about where it came from.
 *
 * The first six fields are the pack's own; `address` and `edits` are ours.
 * `address` is what Storyletter dials, which is what somebody typed and need
 * not be the origin the far end calls itself by; `edits` is the count of shard
 * writes since the last push or pull, which is the whole of the unpushed
 * signal.
 */
export interface RemoteRecord {
  schema: typeof REMOTE_SCHEMA;
  server: string;
  installation: string;
  version: string;
  revision: number;
  role: RemoteRole;
  pulledAt?: string;
  /** What Storyletter dials. Absent on a record written by the far end, where
   *  `server` is the only address there is. */
  address?: string;
  /** Shard writes since the last successful push or pull. */
  edits?: number;
}

/** The address a record is dialled at. */
export const addressOf = (remote: RemoteRecord): string => remote.address ?? remote.server;

/** Read the record at a project's root, or nothing when there is none. A file
 *  that will not parse is a file we have no business guessing at: it reads as
 *  no remote, and the project is an ordinary local one. */
export function readRemote(dir: string): RemoteRecord | undefined {
  const path = join(dir, REMOTE_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RemoteRecord;
    if (parsed.schema !== REMOTE_SCHEMA) return undefined;
    if (typeof parsed.installation !== "string" || typeof parsed.version !== "string") return undefined;
    if (typeof parsed.revision !== "number") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/** Write the record, whole. Small enough that a read-modify-write is the
 *  honest shape, and it is never written from two places at once. */
export function writeRemote(dir: string, remote: RemoteRecord): void {
  writeFileSync(join(dir, REMOTE_FILE), `${JSON.stringify(remote, null, 2)}\n`, "utf8");
}

/**
 * Count a shard write against the remote, if there is one.
 *
 * Called from the one place every editor write goes through, so "edits since
 * the last push" costs a project with no remote a single `existsSync`.
 */
export function countEdit(dir: string, howMany = 1): void {
  const remote = readRemote(dir);
  if (remote === undefined) return;
  writeRemote(dir, { ...remote, edits: (remote.edits ?? 0) + howMany });
}

/** Level with the server again: a pull or a push landed. */
export function clearEdits(dir: string, revision: number): void {
  const remote = readRemote(dir);
  if (remote === undefined) return;
  writeRemote(dir, { ...remote, revision, edits: 0 });
}

// --- which shards a role may change ------------------------------------------------

/** The shard extensions an author's key may change: the writer's cards, the
 *  comment sidecar, and the canvases they arrange them on. Everything else - the
 *  project file, a box, its tags, its hands, its templates and the MAP - is the
 *  shape.
 *
 *  The view shard joined this list on 2026-09-06, when the map moved out of it
 *  (design/engine-server.md 9.1 point 5). Until then one file held both a
 *  working drawing and the positions a venue provisions its kiosks against, and
 *  the stricter reading was the only safe one; now that the map has a file of
 *  its own, refusing an author their own canvas would be refusing them nothing
 *  the designer cares about. */
const AUTHOR_SHARDS: readonly string[] = [
  SHARD_EXTENSIONS.deck, SHARD_EXTENSIONS.notes, SHARD_EXTENSIONS.view,
];

const SHARD_EXTS: readonly string[] = Object.values(SHARD_EXTENSIONS);

/** Is this path one of the shards that carry the shape? A file that is not a
 *  shard at all is nobody's contract and is not counted. */
export function isShapeShard(path: string): boolean {
  const lower = path.toLowerCase();
  if (!SHARD_EXTS.some((ext) => lower.endsWith(ext))) return false;
  return !AUTHOR_SHARDS.some((ext) => lower.endsWith(ext));
}

/** May this role write these paths? The answer is the refusal, or nothing. */
export function refuseWrite(role: RemoteRole | undefined, paths: readonly string[]): string | undefined {
  if (role !== "author") return undefined;
  const shape = paths.filter(isShapeShard);
  return shape.length === 0 ? undefined : PULL_AS_DESIGNER;
}

// --- the three calls ---------------------------------------------------------------

/** Anything that came back other than the answer. `offline` separates "the
 *  address did not answer" from "the address answered no", because they are
 *  two different things to do about. */
export interface CallFailure {
  error: string;
  code?: string;
  details?: unknown;
  offline?: boolean;
}

export const failed = <T>(r: T | CallFailure): r is CallFailure =>
  typeof r === "object" && r !== null && "error" in r;

/** An address as typed, tidied into one we can build a URL from. */
export function normaliseAddress(address: string): string {
  const trimmed = address.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** The body of a refusal, in the shape the far end sends it. */
interface WireErrorBody { error?: { code?: string; message?: string; details?: unknown } }

async function call<T>(url: string, init: RequestInit, timeoutMs = 30_000): Promise<T | CallFailure> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: abort.signal });
  } catch (e) {
    // Nothing answered: a laptop asleep in a cupboard, a wrong address, a
    // network that is not this one. The caller offers to wait rather than to
    // fix something.
    return { error: e instanceof Error ? e.message : String(e), offline: true };
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  if (!response.ok) {
    let body: WireErrorBody = {};
    try { body = JSON.parse(text) as WireErrorBody; } catch { /* not JSON: the status is all we have */ }
    return {
      error: body.error?.message ?? `${response.status} ${response.statusText}`,
      ...(body.error?.code !== undefined ? { code: body.error.code } : {}),
      ...(body.error?.details !== undefined ? { details: body.error.details } : {}),
    };
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return { error: "that address answered with something that is not an answer to this." };
  }
}

const bearer = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` });

/**
 * Is anything at this address at all?
 *
 * Not one of the three calls and not an answer about permission: ANY reply,
 * a refusal included, means the address is reachable and a push is worth
 * offering. Only used to word the prompt an author gets on the way out, where
 * "the server cannot be reached" and "the server said no" are two different
 * things to be told.
 */
export async function reachable(address: string, timeoutMs = 2500): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    await fetch(normaliseAddress(address), { method: "HEAD", signal: abort.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** What pairing hands back. The key is minted once and never shown again. */
export interface PairedKey {
  key: string;
  role: RemoteRole;
  installation: string;
  /** What the far end calls this installation, for nothing but the dialog's
   *  own confirmation line. */
  name?: string;
}

/** Spend the code, get the key. Unauthenticated by definition: the code is the
 *  authorisation, which is why it is short-lived and single use. */
export async function pair(
  address: string, code: string, device: { app: string; host: string },
  identity?: { name: string; email?: string },
): Promise<PairedKey | CallFailure> {
  const answer = await call<{
    key?: string;
    principal?: { role?: string };
    installation?: { installation?: string; name?: string };
  }>(`${normaliseAddress(address)}/v1/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: code.trim(), device, ...(identity ? { identity } : {}) }),
  });
  if (failed(answer)) return answer;
  const role = answer.principal?.role;
  if (typeof answer.key !== "string" || answer.key === "") {
    return { error: "that address answered without a key, so there is nothing to keep." };
  }
  if (role !== "author" && role !== "designer") {
    return { error: `this key is a ${String(role ?? "kind")} key, and a project is pulled with an author's or a designer's.` };
  }
  return {
    key: answer.key,
    role,
    installation: answer.installation?.installation ?? "",
    ...(answer.installation?.name !== undefined ? { name: answer.installation.name } : {}),
  };
}

/** A pack, and what it is. */
export interface PulledPack {
  bytes: Buffer;
  revision: number;
  installation: string;
  version: string;
  role: RemoteRole;
  server: string;
}

/** Fetch a pack. No revision named takes the head of the version this key is
 *  paired against, which is what a first pull wants and what Pull wants every
 *  time after. */
export async function pullPack(
  address: string, key: string, opts: { installation?: string; version?: string; revision?: number } = {},
): Promise<PulledPack | CallFailure> {
  const url = new URL(`${normaliseAddress(address)}/v1/console/project/pull`);
  if (opts.installation !== undefined) url.searchParams.set("installation", opts.installation);
  if (opts.version !== undefined) url.searchParams.set("version", opts.version);
  if (opts.revision !== undefined) url.searchParams.set("revision", String(opts.revision));
  const answer = await call<{
    revision?: { revision?: number; version?: string; installation?: string };
    pack?: string;
    provenance?: { server?: string; installation?: string; version?: string; revision?: number; role?: string };
  }>(url.toString(), { method: "GET", headers: bearer(key) });
  if (failed(answer)) return answer;
  if (typeof answer.pack !== "string" || answer.pack === "") {
    return { error: "that address answered without a pack." };
  }
  const p = answer.provenance ?? {};
  const revision = p.revision ?? answer.revision?.revision;
  if (typeof revision !== "number") return { error: "that pack came back without a revision to record." };
  const role = p.role === "author" || p.role === "designer" ? p.role : undefined;
  return {
    bytes: Buffer.from(answer.pack, "base64"),
    revision,
    installation: p.installation ?? answer.revision?.installation ?? opts.installation ?? "",
    version: p.version ?? answer.revision?.version ?? opts.version ?? "",
    role: role ?? "author",
    server: p.server ?? normaliseAddress(address),
  };
}

/**
 * One thing a push would break at the far end, as it named it.
 *
 * A refusal of this kind is the only one with a way through it: the far end is
 * saying "this changes something depended on", not "this is wrong", and a
 * designer who meant it says so break by break. `key` is what goes back in
 * `acknowledge`, and it is the far end's own word for the thing rather than
 * anything of ours: it matches a break by `where` first and by `path` second,
 * so the first of those it gave us is the one it will recognise.
 */
export interface ContractBreak {
  key: string;
  /** The far end's own sentence, shown as it stands. */
  message: string;
}

/** The breaks in a refusal's details, or nothing when it carried none. A row
 *  with no message is a row there is nothing to show or tick, so it is left
 *  out rather than listed blank. */
export function contractBreaks(details: unknown): ContractBreak[] {
  if (!Array.isArray(details)) return [];
  return (details as { message?: unknown; where?: unknown; path?: unknown }[])
    .filter((row) => typeof row.message === "string" && row.message !== "")
    .map((row) => ({
      key: typeof row.where === "string" ? row.where
        : typeof row.path === "string" ? row.path : "",
      message: row.message as string,
    }));
}

/** What a push did. */
export interface PushedRevision {
  revision: number;
  changed?: string[];
  issues?: { severity: string; path?: string; message: string; where?: string }[];
}

/**
 * Send the project up.
 *
 * The three declared fields are not optional for us and cannot be: `pack`
 * carries shards, so the record beside them does not survive the repack, and
 * the far end has nothing else to tell which story, which version and which
 * base this was pulled from.
 */
export async function pushPack(
  address: string, key: string, body: {
    pack: Buffer; installation: string; version: string; base: number;
    note?: string; acknowledge?: string[]; identity?: { name: string; email?: string };
  },
): Promise<PushedRevision | CallFailure> {
  const answer = await call<{ revision?: { revision?: number }; changed?: string[]; issues?: PushedRevision["issues"] }>(
    `${normaliseAddress(address)}/v1/console/project/push`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(key) },
      body: JSON.stringify({
        pack: body.pack.toString("base64"),
        installation: body.installation,
        version: body.version,
        base: body.base,
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.acknowledge !== undefined ? { acknowledge: body.acknowledge } : {}),
        ...(body.identity !== undefined ? { identity: body.identity } : {}),
      }),
    },
  );
  if (failed(answer)) return answer;
  const revision = answer.revision?.revision;
  if (typeof revision !== "number") return { error: "that push was accepted without saying which revision it landed as." };
  return {
    revision,
    ...(answer.changed !== undefined ? { changed: answer.changed } : {}),
    ...(answer.issues !== undefined ? { issues: answer.issues } : {}),
  };
}

// --- the merge (pack-merge-back.md section 3, per shard) ---------------------------

/** A pack exploded in memory: project-relative path -> text, with the record
 *  beside the manifest taken out, since it is nobody's shard. */
export interface OpenedPack {
  shards: Map<string, string>;
  assets: Map<string, Uint8Array>;
  remote?: RemoteRecord;
}

/**
 * Explode a pack without writing anything.
 *
 * `runUnpack` is pure - it returns planned writes - so `dir` here is only what
 * the op checks containment against, and a hostile entry that would climb out
 * of the project is refused there as it is for the CLI.
 */
export async function openPackBytes(bytes: Buffer | Uint8Array, dir: string): Promise<OpenedPack> {
  const { shards, assets } = await runUnpack(bytes, dir);
  const out: OpenedPack = { shards: new Map(), assets: new Map() };
  const rel = (path: string): string => relative(dir, path).split(sep).join("/");
  for (const write of shards) {
    const name = rel(write.path);
    if (name === REMOTE_FILE) {
      try {
        const parsed = JSON.parse(write.content) as RemoteRecord;
        if (parsed.schema === REMOTE_SCHEMA) out.remote = parsed;
      } catch { /* a record we cannot read is a pack with none */ }
      continue;
    }
    out.shards.set(name, write.content);
  }
  for (const write of assets) out.assets.set(rel(write.path), write.bytes);
  return out;
}

/** The record a pack carries, when it carries one. What Open Storyletpack asks
 *  before it offers to connect. */
export async function remoteInPack(bytes: Buffer | Uint8Array, dir: string): Promise<RemoteRecord | undefined> {
  return (await openPackBytes(bytes, dir)).remote;
}

/**
 * The address a pack names, or nothing.
 *
 * The one question asked of every pack that arrives, however it arrives: picked
 * in Open Storyletpack, double-clicked in the file manager, or named on the
 * command line. A pack that names one has a question in it and the answer is
 * the author's; a pack that names none is opened as packs have always been.
 * A pack we cannot read at all answers "none" rather than throwing, because the
 * unpack that follows is where an unreadable pack is properly reported.
 */
export async function packAddress(bytes: Buffer | Uint8Array, dir: string): Promise<string | undefined> {
  try {
    const carried = await remoteInPack(bytes, dir);
    return carried === undefined ? undefined : addressOf(carried);
  } catch {
    return undefined;
  }
}

export interface PullPlan {
  /** Merged and added shards, absolute, ready to write. */
  writes: { path: string; content: string }[];
  /** `.storyletconflict` sidecars for the shards that disagreed. */
  sidecars: { path: string; content: string }[];
  /** Pictures the pack brought that we do not have. One we DO have is kept. */
  assets: { path: string; bytes: Uint8Array }[];
  merged: number;
  added: number;
  conflicts: number;
}

/**
 * Fold a pulled pack into the open project: their revision against ours, with
 * the revision we last pulled as the ancestor.
 *
 * Exactly the disposition `unpack --merge` uses (pack-merge-back.md section 3),
 * over shard maps rather than two files on disk: present both sides is a 3-way
 * whose conflicts resolve to OURS with a sidecar, present only theirs is
 * written verbatim as an add, present only ours is LEFT ALONE, because a
 * whole-file delete is never propagated.
 */
export async function planPull(
  dir: string, head: Buffer | Uint8Array, base: Buffer | Uint8Array | undefined,
): Promise<PullPlan> {
  const theirs = await openPackBytes(head, dir);
  const ancestor = base === undefined ? undefined : (await openPackBytes(base, dir)).shards;
  const plan: PullPlan = { writes: [], sidecars: [], assets: [], merged: 0, added: 0, conflicts: 0 };

  for (const name of [...theirs.shards.keys()].sort()) {
    const theirText = theirs.shards.get(name)!;
    const path = join(dir, name);
    if (!existsSync(path)) {
      plan.writes.push({ path, content: theirText });
      plan.added++;
      continue;
    }
    const read = (text: string, side: string): Record<string, unknown> => {
      try { return parseSource(text) as Record<string, unknown>; } catch (e) {
        throw new Error(`${name}: the ${side} copy will not parse (${e instanceof Error ? e.message : String(e)})`);
      }
    };
    const ours = read(readFileSync(path, "utf8"), "local");
    const baseText = ancestor?.get(name);
    // NO BASE ENTRY means the shard did not exist at the revision we pulled, so
    // there is no ancestor and every field of theirs reads as an add. `{}` is
    // how `runMerge` is told that, and it is exempt from the schema-skew check
    // for exactly this reason: an absence has no version to disagree with.
    const result = runMerge(
      baseText !== undefined ? read(baseText, "base") : {},
      ours,
      read(theirText, "pulled"),
    );
    plan.writes.push({ path, content: canonicalStringify(result.merged) });
    plan.merged++;
    if (result.conflicts.length > 0) {
      plan.sidecars.push({ path: `${path}${CONFLICT_SIDECAR_EXTENSION}`, content: conflictSidecar(result) });
      plan.conflicts += result.conflicts.length;
    }
  }
  for (const [name, bytes] of [...theirs.assets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const path = join(dir, name);
    if (!existsSync(path)) plan.assets.push({ path, bytes });
  }
  return plan;
}

/** Pack the open project for sending. Pictures travel: the far end holds the
 *  source of record, so a push that dropped them would lose them. */
export async function packProject(dir: string): Promise<Buffer> {
  return runPack(dir, { assets: true });
}

// --- what the menu and the window say ------------------------------------------------

/** What we know about a project's standing with its server. `head` is the far
 *  end's latest revision when we have been told it, and absent when we have
 *  not asked or could not. */
export interface RemoteStanding {
  revision: number;
  edits: number;
  head?: number;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * Is there a Server menu at all, and what does its status line say?
 *
 * BOTH halves or nothing: the open project must have come from a server AND
 * this app must still hold the key for it. A remote whose key has been
 * forgotten is a project like any other, which is the whole of "the connection
 * is what gates every piece of server-shaped chrome" (9.1).
 */
export function menuState(
  remote: RemoteRecord | undefined, hasKey: boolean, head?: number,
): { status: string } | undefined {
  if (remote === undefined || !hasKey) return undefined;
  return {
    status: statusLine({
      revision: remote.revision,
      edits: remote.edits ?? 0,
      ...(head !== undefined ? { head } : {}),
    }),
  };
}

/** The Server menu's status line, and the window's suffix. */
export function statusLine(standing: RemoteStanding): string {
  if (standing.edits > 0) {
    return `${standing.edits} ${plural(standing.edits, "edit", "edits")} unpushed`;
  }
  if (standing.head !== undefined && standing.head > standing.revision) {
    return `Behind: revision ${standing.head} on the server`;
  }
  return "In sync";
}

// --- leaving a project with edits the server has not seen ----------------------------

/** Which way out the author chose. */
export type LeaveChoice = "push" | "leave" | "cancel";

/**
 * What to do with the answer.
 *
 * A push that lands lets go; a push that is REFUSED does not, and that is the
 * whole reason this is a function rather than three lines at the prompt: a
 * refusal reached at the moment of quitting is the one an author most needs to
 * still be in the project to act on.
 */
export async function resolveLeave(
  choice: LeaveChoice, push: () => Promise<{ revision: number } | CallFailure>,
): Promise<{ go: boolean; refusal?: string }> {
  if (choice === "cancel") return { go: false };
  if (choice === "leave") return { go: true };
  const pushed = await push();
  return failed(pushed) ? { go: false, refusal: pushed.error } : { go: true };
}
