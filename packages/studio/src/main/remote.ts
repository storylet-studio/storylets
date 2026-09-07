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
// ...and, beside it, `storylets.server.base.json`: one hash per shard of the
// revision last pulled, which is what "unpushed" is measured against. See the
// note at BASE_FILE for why it is a file beside the project rather than a tally
// or something under the app's settings.
//
// THE KEY DECIDES WHAT MAY CHANGE. An author's key may change deck and comment
// shards; everything else is the shape, and the editor says so with the same
// sentence the far end would refuse with. That is a courtesy, not the
// enforcement: the enforcement is at the other end, and it is the one that
// counts.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { canonicalStringify, parseSource, walkProjectFiles } from "@storylet-studio/compiler";
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
 * The six declared fields are the pack's own; `address` is ours: it is what
 * Storyletter dials, which is what somebody typed and need not be the origin
 * the far end calls itself by.
 *
 * There is NO edit tally here any more (2026-09-07). One was kept until an
 * author checked it by hand: it counted logical edits rather than changed
 * shards, it counted an undo and a redo as further edits, and it was only ever
 * redrawn on the next event, so typing once and undoing it read as two. What is
 * unpushed is a fact about the files, so it is asked of the files: see
 * `unpushedShards`.
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

// --- what the server last sent, and what differs from it ---------------------------

/** Every shard extension there is: what a pack carries, and what the base is
 *  a hash of, one per file. */
const SHARD_EXTS: readonly string[] = Object.values(SHARD_EXTENSIONS);

/**
 * The revision last pulled, one hash per shard.
 *
 * WHERE IT LIVES, and why (2026-09-07). Three places were on the table: the
 * whole base pack, a hash map beside the project, or a hash map under the app's
 * own settings folder keyed by the project's path. This is the middle one, a
 * plain JSON file at the project root beside `storylets.server.json`.
 *
 *   - BESIDE THE PROJECT, not under the app's settings, because the base
 *     belongs to the project and not to this machine. A project moved, renamed,
 *     copied to a laptop or restored from a backup keeps its base and still
 *     knows what it has not pushed; a settings key on a path would be stale the
 *     moment the folder moved, and would accumulate rows for projects deleted
 *     years ago.
 *   - HASHES, not the base pack, because the only question asked of it is "is
 *     this shard still the one the server sent". A pack is a megabyte of zip in
 *     the author's own project folder to answer a yes or no; the merge, which
 *     is the one thing that does want the base bytes, fetches them from the far
 *     end, which keeps every pack it ever sent.
 *   - CANONICAL text, hashed, so a reformat that changes no content reads as no
 *     change, which is the same rule the byte contract everywhere else uses.
 *
 * It is not a shard extension, so `pack` never walks it and it can never travel
 * inside a pack; the leading `storylets.` groups it beside the record it
 * belongs with.
 */
export const BASE_FILE = "storylets.server.base.json";

const BASE_SCHEMA = "storylets/server-base@0";

export interface BaseRecord {
  schema: typeof BASE_SCHEMA;
  /** The revision these hashes are of. */
  revision: number;
  /** Project-relative shard path -> a hash of its canonical text. */
  shards: Record<string, string>;
}

/**
 * A shard's canonical text, hashed.
 *
 * Text that will not parse is hashed as it stands rather than skipped: a shard
 * somebody has broken by hand is still a difference from what the server sent,
 * and pretending otherwise would say "in sync" over a file that is anything but.
 */
export function shardHash(text: string): string {
  let canonical = text;
  try {
    canonical = canonicalStringify(parseSource(text) as Record<string, unknown>);
  } catch { /* not parseable: its bytes are the only honest answer */ }
  return createHash("sha256").update(canonical).digest("hex");
}

/** Hashes already worked out, keyed by path and validated by EXACT text, so an
 *  unchanged shard is answered from memory: identical bytes cannot canonicalise
 *  differently. Bounded by one project's shard count; the editor opens many in
 *  a session, so it is dropped with the other shard caches on a switch. */
const hashes = new Map<string, { text: string; hash: string }>();

/** Empty the hash cache. Pairs with the compiler's `clearParseCache`; the
 *  editor drops all three together when it changes project. */
export function forgetShardHashes(): void { hashes.clear(); }

const relKey = (dir: string, path: string): string => relative(dir, path).split(sep).join("/");

/** Every shard in a project on disk, hashed, keyed project-relative. */
export function hashProject(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const full of walkProjectFiles(dir, SHARD_EXTS)) {
    let text: string;
    try { text = readFileSync(full, "utf8"); } catch { continue; }
    const remembered = hashes.get(full);
    const hash = remembered?.text === text ? remembered.hash : shardHash(text);
    hashes.set(full, { text, hash });
    out[relKey(dir, full)] = hash;
  }
  return out;
}

/** The same, over a pack's shard map. Anything in there that is not a shard
 *  (the far end's own record, say) is not part of the comparison. */
export function hashShards(shards: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, text] of shards) {
    if (!SHARD_EXTS.some((ext) => name.toLowerCase().endsWith(ext))) continue;
    out[name] = shardHash(text);
  }
  return out;
}

/** Read the base, or nothing when there is none (or none we can read: a base we
 *  cannot parse is one we have no business guessing at). */
export function readBase(dir: string): BaseRecord | undefined {
  const path = join(dir, BASE_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as BaseRecord;
    if (parsed.schema !== BASE_SCHEMA) return undefined;
    if (typeof parsed.revision !== "number") return undefined;
    if (typeof parsed.shards !== "object" || parsed.shards === null) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/** Move the base: a pull or a push has made the project level with `revision`,
 *  and `shards` is what that revision holds. */
export function writeBase(dir: string, revision: number, shards: Record<string, string>): void {
  const base: BaseRecord = { schema: BASE_SCHEMA, revision, shards };
  writeFileSync(join(dir, BASE_FILE), `${JSON.stringify(base, null, 2)}\n`, "utf8");
}

/**
 * How many shards differ from the revision last pulled.
 *
 * THE unpushed signal, and the only one: a shard whose canonical text is no
 * longer the server's counts once however many times it has been typed in, an
 * undo that puts it back stops it counting, and a shard added or deleted since
 * counts too, because either is a difference the server has not seen.
 *
 * No base means nothing to compare against, which reads as nothing unpushed.
 * That is the honest answer rather than a cautious one: a project with no base
 * is one this app has never pulled, and calling every shard in it unpushed
 * would put a number on the window of a project nobody has changed.
 */
export function unpushedShards(dir: string): number {
  const base = readBase(dir);
  if (base === undefined) return 0;
  const now = hashProject(dir);
  let differ = 0;
  for (const [path, hash] of Object.entries(base.shards)) if (now[path] !== hash) differ++;
  for (const path of Object.keys(now)) if (base.shards[path] === undefined) differ++;
  return differ;
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

/** What connecting worked out: where the project goes, the bytes to put there,
 *  and the record to write beside them. */
export interface ConnectPlan {
  target: string;
  bytes: Buffer;
  remote: RemoteRecord;
}

/**
 * Connect: a folder first, then the code spent, then the project.
 *
 * THE ORDER IS THE POINT (2026-09-07). A pairing code is single use and is gone
 * the moment it is exchanged for a key, and this used to pair, pull, and only
 * then ask where the project should go - so somebody who thought better of the
 * folder, or picked the wrong one and pressed Cancel, had already spent their
 * code and had to go and ask for another. Nothing is spent until there is
 * somewhere for what comes back to live.
 *
 * The three callbacks are what main does with a window: choose a folder, say
 * why one will not do, and keep a key. Everything else is here, where a real
 * server on a loopback port can be pointed at it.
 */
export async function planConnect(opts: {
  address: string;
  code: string;
  device: { app: string; host: string };
  identity?: { name: string; email?: string };
  /** Where should the project go? `null` when the person backed out. */
  chooseFolder: () => Promise<string | null>;
  /** The reason that folder will not do, or nothing. Refused BEFORE pairing,
   *  which is the whole reason it is asked here rather than after. */
  refuseFolder?: (dir: string) => string | undefined;
  keepKey: (dialled: string, paired: PairedKey) => void;
}): Promise<ConnectPlan | CallFailure | null> {
  const target = await opts.chooseFolder();
  if (target === null) return null;
  const occupied = opts.refuseFolder?.(target);
  if (occupied !== undefined) return { error: occupied };
  const dialled = normaliseAddress(opts.address);
  const paired = await pair(dialled, opts.code, opts.device, opts.identity);
  if (failed(paired)) return paired;
  opts.keepKey(dialled, paired);
  const pulled = await pullPack(dialled, paired.key, {
    ...(paired.installation !== "" ? { installation: paired.installation } : {}),
  });
  if (failed(pulled)) return pulled;
  return {
    target,
    bytes: pulled.bytes,
    remote: {
      schema: REMOTE_SCHEMA,
      server: pulled.server,
      address: dialled,
      installation: pulled.installation,
      version: pulled.version,
      revision: pulled.revision,
      role: pulled.role,
      pulledAt: new Date().toISOString(),
    },
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
  /** The pulled revision's shards, hashed: the base the unpushed count is
   *  measured against once this plan is written. Worked out here because the
   *  pack is already open, and a second unzip to answer the same question would
   *  be the plan and the base disagreeing waiting to happen. */
  base: Record<string, string>;
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
  const plan: PullPlan = {
    writes: [], sidecars: [], assets: [], merged: 0, added: 0, conflicts: 0,
    base: hashShards(theirs.shards),
  };

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
  remote: RemoteRecord | undefined, hasKey: boolean, edits: number, head?: number,
): { status: string } | undefined {
  if (remote === undefined || !hasKey) return undefined;
  return {
    status: statusLine({
      revision: remote.revision,
      edits,
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

/**
 * The status line with the project it is about in front of it.
 *
 * For the two places where a person could be looking at one project and reading
 * about another: the prompt on the way out (which is asked at the moment a
 * second project is arriving) and the window's own suffix. An empty name falls
 * back to "This project", because a headline reading ": 1 edit unpushed" would
 * be worse than the general word.
 */
export const projectStatusLine = (name: string, standing: RemoteStanding): string =>
  `${namedOr(name)}: ${statusLine(standing)}`;

/** The project's display name, or the general word for one. */
const namedOr = (name: string): string => (name.trim() === "" ? "This project" : name.trim());

// --- leaving a project with edits the server has not seen ----------------------------

/** Which way out the author chose. */
export type LeaveChoice = "push" | "leave" | "cancel";

/**
 * The prompt itself, worked out here so the strings and the button order are
 * one thing rather than three.
 *
 * `choices` is what each button MEANS, parallel to `buttons`, and it never
 * crosses to the renderer: the renderer is handed labels and answers with an
 * index, exactly as the updater's prompt does, so only this side knows which
 * index is a push.
 */
export interface LeavePrompt {
  /** The headline: where the project stands, in the status line's own words. */
  message: string;
  detail: string;
  buttons: string[];
  choices: readonly LeaveChoice[];
  defaultId: number;
  cancelId: number;
}

/**
 * What the author is asked on the way out, and what each answer means.
 *
 * IT NAMES ITS PROJECT (2026-09-07), headline and body both. This question is
 * asked at the one moment two projects are in play - opening one over another
 * with edits unpushed, which is how connecting to a server lands a pulled
 * project - and unnamed it read as if it were about the project arriving rather
 * than the one being left.
 */
export function leavePrompt(
  project: string, standing: RemoteStanding, act: "quit" | "close", online: boolean,
): LeavePrompt {
  const leave = act === "quit" ? "Quit without pushing" : "Close without pushing";
  const buttons = online ? ["Push to server", leave, "Cancel"] : [leave, "Cancel"];
  const choices: LeaveChoice[] = online ? ["push", "leave", "cancel"] : ["leave", "cancel"];
  const who = namedOr(project);
  return {
    message: projectStatusLine(project, standing),
    detail: online
      ? `${who} has edits the server has not seen.`
      : `${who} has edits the server has not seen, and the server cannot be reached.`,
    buttons,
    choices,
    defaultId: 0,
    cancelId: buttons.length - 1,
  };
}

/**
 * The same prompt again, when the push it offered was refused.
 *
 * Until 2026-09-07 a refusal at this moment left the person exactly where they
 * were with only the problems bar as evidence, and (on the connect path) the
 * pulled project silently never opened: they had pressed Push to server and
 * nothing visibly happened. The refusal is shown here, in the far end's own
 * words, with the one honest way out of it.
 */
export function refusalPrompt(
  project: string, standing: RemoteStanding, refusal: string,
): LeavePrompt {
  return {
    message: projectStatusLine(project, standing),
    detail: refusal,
    buttons: ["Stay"],
    choices: ["cancel"],
    defaultId: 0,
    cancelId: 0,
  };
}

/** How long the confirmation after a push is held in front of the person
 *  before the app lets go. Long enough to read four words and no longer:
 *  this is not theatre, it is "my project is securely pushed". */
export const LEAVE_SETTLE_MS = 1500;

/** What the prompt turns into once the push has landed. */
export const pushedLine = (revision: number): string => `Pushed as revision ${revision}`;

/** The answer, read back. An index that is not one of the buttons is a cancel:
 *  a way out we did not offer is not a way out. */
export function leaveChoice(prompt: LeavePrompt, index: number): LeaveChoice {
  return prompt.choices[index] ?? "cancel";
}

/**
 * The renderer, asked.
 *
 * TWO promises, and the split is the whole point. `shown` says the dialog is up
 * and settles in milliseconds; `answer` settles when somebody clicks, which is
 * however long a person takes to read a question about their unpushed work. One
 * promise for both would mean timing the PERSON, and a four-second deadline on
 * a human answer puts a second dialog on top of the first: found by launching
 * the app and leaving the prompt sitting there, which is what it is for.
 */
export interface InAppPrompt {
  shown: Promise<void>;
  answer: Promise<number>;
}

/** How long the renderer has to say the dialog is up before the fallback is
 *  used. Short on purpose: this bounds a message crossing the bridge, not a
 *  person, and a renderer that is not going to draw it has already not. */
export const LEAVE_PROMPT_TIMEOUT = 4000;

/**
 * Ask the question, in the app's own dialog where there is one.
 *
 * The app must not wear two dialog styles, so the prompt is the renderer's:
 * the same classes and the same manners as the push dialog next door. The
 * native box stays as the FALLBACK and only that - a renderer that has gone, or
 * one that never says it drew the thing - because the alternative is an author
 * who cannot answer a question that is blocking their quit.
 */
export async function askLeave(
  prompt: LeavePrompt,
  inApp: ((prompt: LeavePrompt) => InAppPrompt) | undefined,
  native: (prompt: LeavePrompt) => Promise<number>,
  timeoutMs = LEAVE_PROMPT_TIMEOUT,
): Promise<LeaveChoice> {
  if (inApp === undefined) return leaveChoice(prompt, await native(prompt));
  const asked = inApp(prompt);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<"gone">((resolve) => { timer = setTimeout(() => resolve("gone"), timeoutMs); });
  // A rejection is folded into the value rather than caught, so one arriving
  // after the race has given up is handled rather than left loose.
  const up = asked.shown.then(() => "shown" as const, () => "gone" as const);
  const first = await Promise.race([up, waited]);
  clearTimeout(timer);
  if (first === "shown") {
    return leaveChoice(prompt, await asked.answer.then((index) => index, () => prompt.cancelId));
  }
  return leaveChoice(prompt, await native(prompt));
}

/**
 * What to do with the answer.
 *
 * A push that lands lets go; a push that is REFUSED does not, and that is the
 * whole reason this is a function rather than three lines at the prompt: a
 * refusal reached at the moment of quitting is the one an author most needs to
 * still be in the project to act on.
 *
 * `settle` is the beat between a push landing and the app letting go: the
 * person is leaving, and the last thing they should see is that the work is
 * safe. It is awaited rather than fired off, because the whole point of it is
 * that the window does not go until it has been seen.
 */
export async function resolveLeave(
  choice: LeaveChoice,
  push: () => Promise<{ revision: number } | CallFailure>,
  settle?: (revision: number) => Promise<void>,
): Promise<{ go: boolean; refusal?: string }> {
  if (choice === "cancel") return { go: false };
  if (choice === "leave") return { go: true };
  const pushed = await push();
  if (failed(pushed)) return { go: false, refusal: pushed.error };
  await settle?.(pushed.revision);
  return { go: true };
}
