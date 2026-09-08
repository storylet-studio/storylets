// ---------------------------------------------------------------------------
// The pack exchange: pack bytes to and from a server whose address and code
// somebody was given.
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
import https from "node:https";
import type { RequestOptions } from "node:https";
import type { Duplex } from "node:stream";
import tls from "node:tls";
import { isAbsolute, join, relative, sep } from "node:path";
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
  /**
   * The certificate this project is pinned to: the SHA-256 of the far end's
   * own, in the shape it hands it over (`SHA256:` and base64). Every call to
   * this address then refuses a socket showing anything else, before a key is
   * sent over it.
   *
   * ABSENT means nothing to pin, and that is an ordinary state rather than a
   * lapsed one: an address reached over plain HTTP has no certificate, and one
   * behind a certificate the machine already trusts hands over no fingerprint
   * to pin either. Beside the address rather than only in the settings because
   * it belongs to the project's idea of where it came from, exactly as the
   * address does: a project moved to another machine still knows.
   */
  fingerprint?: string;
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
 * A shard in the MERGE's own normal form: `runMerge(x, x, x)`.
 *
 * The order of an id-keyed array is never a change (the ruling of 2026-09-07,
 * which the far end compares by too). The merge sorts every keyed array and
 * every open map as it folds, so a pulled shard comes back ordered whether or
 * not the copy on disk was, and a comparison of canonical TEXT then reads a
 * sort as four edits nobody made. Asking the merge itself is what keeps the two
 * ends agreeing about what a change is: there is one normal form and it is the
 * one the merge already defines.
 *
 * A shard the merge cannot type - anything that is not one of ours - is its own
 * normal form, because there is no strategy to normalise it with.
 */
export function normalForm(shard: Record<string, unknown>): Record<string, unknown> {
  try {
    return runMerge(shard, shard, shard).merged;
  } catch {
    return shard;
  }
}

/** The same, over text: the normal form's canonical bytes. */
const normalText = (text: string): string =>
  canonicalStringify(normalForm(parseSource(text) as Record<string, unknown>));

/**
 * A shard's canonical text, hashed - in the normal form above, so that the
 * order of an id-keyed array cannot count as an edit.
 *
 * Text that will not parse is hashed as it stands rather than skipped: a shard
 * somebody has broken by hand is still a difference from what the server sent,
 * and pretending otherwise would say "in sync" over a file that is anything but.
 */
export function shardHash(text: string): string {
  let canonical = text;
  try {
    canonical = normalText(text);
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

/** Is this path an installation contract? The one shard neither side edits and
 *  the venue writes whole, which is why a pull takes it rather than merging it
 *  (design/engine-server.md 4.11). */
export const isContractShard = (path: string): boolean =>
  path.toLowerCase().endsWith(SHARD_EXTENSIONS.contract);

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

/**
 * Is this the far end saying the push would change nothing?
 *
 * INFORMATION, not a fault: "nothing in that pack differs from revision 3, so
 * there is nothing to push" is the server confirming the work is already there,
 * and it was being filed in the problems bar beside the things that are wrong
 * with the project. It belongs in a toast, said once and gone.
 *
 * Recognised by the sentence because the far end has no code of its own for it:
 * it is a plain bad request, like a dozen refusals that ARE faults. The two
 * codes that carry a way through them are excluded first, and anything this
 * does not recognise stays an error - the cost of missing one is a row in the
 * bar, and the cost of guessing too freely would be a real refusal shown as a
 * toast somebody can miss.
 */
export const nothingToPush = (failure: CallFailure): boolean =>
  failure.code !== "conflict" && failure.code !== "contract_break"
  && failure.offline !== true
  && /nothing to push/i.test(failure.error);

/** An address as typed, tidied into one we can build a URL from. */
export function normaliseAddress(address: string): string {
  const trimmed = address.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// --- pinning the certificate at the other end ---------------------------------------

/**
 * THE WHOLE OF THE PINNING, and the two sentences it can say.
 *
 * A server on somebody's own network has no certificate anything trusts out of
 * the box, so the address is agreed once - by a link that carries the
 * certificate's fingerprint, or by the first pairing - and every call after
 * that refuses a socket showing a different one. That is what SSH does, and on
 * a network with no certificate authority in it there is nothing better.
 *
 * WHY IT IS A HAND-MADE HANDSHAKE AND NOT `checkServerIdentity`. The recipe
 * that reads well - turn verification off, compare the fingerprint in
 * `checkServerIdentity` - checks NOTHING, because Node calls that hook only
 * while it is verifying a chain, and a self-signed certificate has already
 * failed the chain by then. So the connection is made here, in the agent's own
 * `createConnection`: the handshake finishes, the certificate is compared, and
 * the socket is handed to the request only on a match. Nothing of the request
 * - the bearer above all - has been written to it at that point, which is the
 * entire property worth having.
 *
 * A REFUSED PIN IS NOT "OFFLINE". Something answered; it was not the right
 * something. The caller must not offer to wait for it.
 */
export const PIN_REFUSED = "That address is not the server this project was paired with.";

/** ...and the one said at pairing, where there is a link to compare against
 *  rather than a record. Different words because it is a different moment: the
 *  person is holding the thing that disagrees. */
export const LINK_PIN_REFUSED = "The server's certificate does not match the link you were given.";

/** The code both refusals carry, so a caller can tell them from a refusal
 *  about permission without reading the sentence. */
export const FINGERPRINT_CHANGED = "fingerprint_changed";

/**
 * A fingerprint reduced to plain lowercase hex, whichever shape it arrived in.
 *
 * THREE SHAPES, one number: `SHA256:` and base64, which is what a pairing link
 * and a pair response carry; colon-separated uppercase hex, which is what
 * Node's `fingerprint256` gives; and bare hex, which is what somebody who read
 * the certificate with their own tools is holding. Anything that is not
 * thirty-two bytes reduces to nothing, and nothing never matches anything -
 * including another nothing, which is what keeps an unreadable certificate
 * from passing a pin by accident.
 */
export function fingerprintHex(fingerprint: string): string {
  const text = fingerprint.trim();
  const body = /^sha256:/i.test(text) ? text.slice("SHA256:".length) : text;
  const hex = body.replace(/:/g, "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) return hex;
  const raw = Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return raw.length === 32 ? raw.toString("hex") : "";
}

/** Are these the same certificate? Two blanks are NOT: a pin is a statement
 *  about a certificate, and there is no certificate here to make one about. */
export const samePin = (a: string, b: string): boolean => {
  const wanted = fingerprintHex(a);
  return wanted !== "" && wanted === fingerprintHex(b);
};

/** A refused pin, kept apart from every other reason a socket did not work so
 *  the caller can say the right sentence about it. */
class PinRefused extends Error {}

/** A name goes in SNI and an address does not (RFC 6066), and Node warns about
 *  it. A server reached by its address sends none, which is right: the pin is
 *  what says which server this is. */
const isAddress = (host: string): boolean => /^[\d.]+$/.test(host) || host.includes(":");

/**
 * An agent that will hand the request a socket only to the pinned certificate.
 *
 * One socket, never kept alive: a pooled socket is one whose pin was checked
 * for some earlier request, and the saving is a handshake on a call that
 * happens when a person presses a menu item.
 */
class PinnedAgent extends https.Agent {
  constructor(private readonly wanted: string, private readonly timeoutMs: number) {
    super({ keepAlive: false, maxSockets: 1 });
  }

  override createConnection(
    options: RequestOptions, callback?: (err: Error | null, stream: Duplex) => void,
  ): Duplex | undefined {
    const host = String(options.host ?? options.hostname ?? "");
    const socket = tls.connect({
      host,
      port: Number(options.port ?? 443),
      ...(isAddress(host) ? {} : { servername: host }),
      // Off, and the pin stands in its place: there is no chain to walk behind
      // a certificate that signed itself, and "this exact certificate" says
      // more than any chain would have.
      rejectUnauthorized: false,
    }, () => {
      const shown = socket.getPeerCertificate().fingerprint256 ?? "";
      if (!samePin(this.wanted, shown)) {
        socket.destroy();
        callback?.(new PinRefused(PIN_REFUSED), socket);
        return;
      }
      // ONLY NOW is the request allowed near it.
      callback?.(null, socket);
    });
    socket.setTimeout(this.timeoutMs, () => {
      socket.destroy(new Error(`${host} did not finish the handshake in ${this.timeoutMs}ms`));
    });
    socket.on("error", (e: Error) => { callback?.(e, socket); });
    // NOTHING RETURNED: a socket returned from here is used at once, and the
    // handshake has not happened yet. The callback above is the whole point.
    return undefined;
  }
}

/** What either transport below comes back with, which is as much of a response
 *  as anything here reads. */
interface Answered { ok: boolean; status: number; statusText: string; text: string }

/** What a call sends. Narrower than `RequestInit` on purpose: the pinned path
 *  is `https.request`, which takes a string body and plain headers, and the
 *  two transports must not be able to drift apart in what they accept. */
interface CallInit { method: string; headers?: Record<string, string>; body?: string }

/** The ordinary transport: the host's own `fetch`, exactly as before. */
async function sendPlain(url: string, init: CallInit, timeoutMs: number): Promise<Answered> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: abort.signal });
    return {
      ok: response.ok, status: response.status, statusText: response.statusText,
      text: await response.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The pinned one. `fetch` cannot be given an agent, so a pinned call is an
 *  `https.request` and this is the whole of the difference. */
function sendPinned(url: string, init: CallInit, pin: string, timeoutMs: number): Promise<Answered> {
  const target = new URL(url);
  return new Promise<Answered>((settle, fail) => {
    const agent = new PinnedAgent(pin, timeoutMs);
    const done = (act: () => void): void => { agent.destroy(); act(); };
    const request = https.request({
      hostname: target.hostname,
      port: target.port === "" ? 443 : Number(target.port),
      path: `${target.pathname}${target.search}`,
      method: init.method,
      headers: init.headers ?? {},
      agent,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        done(() => settle({
          ok: status >= 200 && status < 300,
          status,
          statusText: response.statusMessage ?? "",
          text: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      response.on("error", (e: Error) => { done(() => fail(e)); });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`no answer from ${target.host} in ${timeoutMs}ms`));
    });
    request.on("error", (e: Error) => { done(() => fail(e)); });
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });
}

/** The body of a refusal, in the shape the far end sends it. */
interface WireErrorBody { error?: { code?: string; message?: string; details?: unknown } }

async function call<T>(url: string, init: CallInit, pin = "", timeoutMs = 30_000): Promise<T | CallFailure> {
  let answer: Answered;
  try {
    answer = pin !== "" && /^https:/i.test(url)
      ? await sendPinned(url, init, pin, timeoutMs)
      : await sendPlain(url, init, timeoutMs);
  } catch (e) {
    // The one failure to reach the far end that is NOT a reason to offer to
    // wait: something answered, wearing the wrong certificate.
    if (e instanceof PinRefused) return { error: PIN_REFUSED, code: FINGERPRINT_CHANGED };
    // Nothing answered: a laptop asleep in a cupboard, a wrong address, a
    // network that is not this one. The caller offers to wait rather than to
    // fix something.
    return { error: e instanceof Error ? e.message : String(e), offline: true };
  }
  if (!answer.ok) {
    let body: WireErrorBody = {};
    try { body = JSON.parse(answer.text) as WireErrorBody; } catch { /* not JSON: the status is all we have */ }
    return {
      error: body.error?.message ?? `${answer.status} ${answer.statusText}`,
      ...(body.error?.code !== undefined ? { code: body.error.code } : {}),
      ...(body.error?.details !== undefined ? { details: body.error.details } : {}),
    };
  }
  try {
    return JSON.parse(answer.text) as T;
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
export async function reachable(address: string, pin = "", timeoutMs = 2500): Promise<boolean> {
  const url = normaliseAddress(address);
  try {
    if (pin !== "" && /^https:/i.test(url)) await sendPinned(url, { method: "HEAD" }, pin, timeoutMs);
    else await sendPlain(url, { method: "HEAD" }, timeoutMs);
    return true;
  } catch {
    // A refused pin lands here with everything else, and rightly: the question
    // asked was "is the server there", and the answer is no.
    return false;
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
  /** The certificate the far end says is its own, to be pinned from here on.
   *  Empty or absent where there is none to pin. */
  fingerprint?: string;
}

/**
 * Spend the code, get the key. Unauthenticated by definition: the code is the
 * authorisation, which is why it is short-lived and single use.
 *
 * `pin` is the fingerprint a pasted link carried, and it does TWO things:
 * the socket is refused before the code goes over it if the certificate is
 * not that one, and the answer is refused after if the far end names a
 * different one. The second is not made redundant by the first: they are
 * different claims, one about the socket and one about what the server says
 * of itself, and a disagreement between them is the clearest possible sign
 * that this is not the arrangement somebody was handed.
 *
 * Without a `pin` the answer's own fingerprint is taken as it stands, which is
 * trust on first use and is the whole of what a bare address can offer.
 */
export async function pair(
  address: string, code: string, device: { app: string; host: string },
  identity?: { name: string; email?: string }, pin = "",
): Promise<PairedKey | CallFailure> {
  const answer = await call<{
    key?: string;
    principal?: { role?: string };
    installation?: { installation?: string; name?: string };
    fingerprint?: string;
  }>(`${normaliseAddress(address)}/v1/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: code.trim(), device, ...(identity ? { identity } : {}) }),
  }, pin);
  if (failed(answer)) return answer;
  const role = answer.principal?.role;
  if (typeof answer.key !== "string" || answer.key === "") {
    return { error: "that address answered without a key, so there is nothing to keep." };
  }
  if (role !== "author" && role !== "designer") {
    return { error: `this key is a ${String(role ?? "kind")} key, and a project is pulled with an author's or a designer's.` };
  }
  const shown = typeof answer.fingerprint === "string" ? answer.fingerprint.trim() : "";
  // Nothing is kept: this returns before anything is written down, and the key
  // that came back is dropped on the floor with the rest of the answer.
  if (pin !== "" && !samePin(pin, shown)) return { error: LINK_PIN_REFUSED, code: FINGERPRINT_CHANGED };
  return {
    key: answer.key,
    role,
    installation: answer.installation?.installation ?? "",
    ...(answer.installation?.name !== undefined ? { name: answer.installation.name } : {}),
    ...(shown !== "" ? { fingerprint: shown } : {}),
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
  pin = "",
): Promise<PulledPack | CallFailure> {
  const url = new URL(`${normaliseAddress(address)}/v1/console/project/pull`);
  if (opts.installation !== undefined) url.searchParams.set("installation", opts.installation);
  if (opts.version !== undefined) url.searchParams.set("version", opts.version);
  if (opts.revision !== undefined) url.searchParams.set("revision", String(opts.revision));
  const answer = await call<{
    revision?: { revision?: number; version?: string; installation?: string };
    pack?: string;
    provenance?: { server?: string; installation?: string; version?: string; revision?: number; role?: string };
  }>(url.toString(), { method: "GET", headers: bearer(key) }, pin);
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
  }, pin = "",
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
    pin,
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
  /** The certificate a pasted link named, when one was pasted. The pair call
   *  is refused over anything else, and the pull that follows is pinned to
   *  whatever the pairing settled on. */
  pin?: string;
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
  const paired = await pair(dialled, opts.code, opts.device, opts.identity, opts.pin ?? "");
  if (failed(paired)) return paired;
  // What is pinned from here on: what the far end named, or, where it named
  // nothing, whatever the link said. A far end with no certificate names
  // nothing and no link carries one, and then nothing is pinned at all.
  const pinned = paired.fingerprint ?? opts.pin ?? "";
  opts.keepKey(dialled, paired);
  const pulled = await pullPack(dialled, paired.key, {
    ...(paired.installation !== "" ? { installation: paired.installation } : {}),
  }, pinned);
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
      ...(pinned !== "" ? { fingerprint: pinned } : {}),
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
  /** Merged, replaced and added shards, absolute, ready to write. A shard the
   *  merge left exactly as it already stands is NOT here: see `planPull`. */
  writes: { path: string; content: string }[];
  /** `.storyletconflict` sidecars for the shards that disagreed. */
  sidecars: { path: string; content: string }[];
  /** Pictures the pack brought that we do not have. One we DO have is kept. */
  assets: { path: string; bytes: Uint8Array }[];
  merged: number;
  added: number;
  /** Contract shards taken from the pack whole. The venue owns its own file. */
  replaced: number;
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
 *
 * With ONE exception, and it is the contract shard: the venue always wins its
 * own file (design/engine-server.md 4.11), so a pull REPLACES it whole rather
 * than merging it. Until 2026-09-07 it went through the 3-way like everything
 * else, and a pull after a rename kept the old copy: the merge is keyed by
 * entry, so the local list of hands survived a list the server had rewritten,
 * and the project was then validating against a contract no venue held. Nobody
 * hand-edits this file, so there is nothing of ours in it to lose.
 *
 * A merge whose result is what is already on disk WRITES NOTHING. The merge
 * emits its own normal form (sorted keyed arrays), so a shard stored in another
 * order comes back reordered and identical in every other way; rewriting it
 * would leave an author who has typed nothing looking at "4 edits unpushed".
 */
export async function planPull(
  dir: string, head: Buffer | Uint8Array, base: Buffer | Uint8Array | undefined,
): Promise<PullPlan> {
  const theirs = await openPackBytes(head, dir);
  const ancestor = base === undefined ? undefined : (await openPackBytes(base, dir)).shards;
  const plan: PullPlan = {
    writes: [], sidecars: [], assets: [], merged: 0, added: 0, replaced: 0, conflicts: 0,
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
    const ourText = readFileSync(path, "utf8");
    if (isContractShard(name)) {
      plan.replaced++;
      if (shardHash(ourText) !== shardHash(theirText)) plan.writes.push({ path, content: theirText });
      continue;
    }
    const ours = read(ourText, "local");
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
    const content = canonicalStringify(result.merged);
    plan.merged++;
    // Order alone is not a change, so a result the file already says is not a
    // write. The merge's output is normal already; ours is put in the same form
    // to be asked.
    if (content !== canonicalStringify(normalForm(ours))) plan.writes.push({ path, content });
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

// --- what the far end says, as the problems bar shows it ------------------------------

/** Where a project's problems are counted from: the folder, and the project
 *  shard's own path within it, which is what a problem about the project as a
 *  whole is anchored to. */
export interface ProjectAnchor {
  dir: string;
  /** The project shard, project-relative. Empty when the project would not load
   *  far enough to have one. */
  project: string;
}

/**
 * The far end's own issues, as problems the bar can show. A refusal is shown
 * where every other thing wrong with the project is shown.
 *
 * PROJECT-RELATIVE, like every other row (2026-09-07). Every problem the
 * compiler raises names a shard the way the project names it, and the bar's own
 * labels are built by reading those paths; these arrived absolute, so a refusal
 * about a deck sat in the bar wearing the whole of somebody's home folder. What
 * anchors a refusal about the project rather than about one shard is the project
 * shard itself, which the bar already reads as "Project settings".
 *
 * ...and a refusal is filed ONCE. It used to go in whatever the details
 * carried, so a far end that named the same sentence in a detail row put it in
 * the bar twice, once relative and once absolute.
 */
export function serverProblems(
  anchor: ProjectAnchor, refusal: string, details: unknown,
): { severity: "error" | "warning"; path: string; where?: string; message: string }[] {
  const rows = Array.isArray(details)
    ? (details as { severity?: string; path?: string; message?: string; where?: string }[])
    : [];
  // The far end names its shards the way the project does; one that arrives
  // absolute (a copy of a path we sent it) is put back into the project's own
  // terms rather than shown as it stands.
  const rel = (path: string): string =>
    (isAbsolute(path) ? relative(anchor.dir, path) : path).split(sep).join("/");
  const detailed = rows
    .filter((r) => typeof r.message === "string")
    .map((r) => ({
      severity: r.severity === "warning" ? "warning" as const : "error" as const,
      path: r.path !== undefined ? rel(r.path) : anchor.project,
      ...(r.where !== undefined ? { where: r.where } : {}),
      message: r.message!,
    }));
  const said = detailed.some((p) => p.message === refusal);
  return said ? detailed : [{ severity: "error", path: anchor.project, message: refusal }, ...detailed];
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

/**
 * What this SITTING has learned about where a project stands with its server:
 * the far end's head revision, asked for in the background, and the unpushed
 * count as the menu and the title last drew it.
 *
 * A session's worth and never stored, and DROPPED WHOLE WHEN THE PROJECT
 * CHANGES (2026-09-07). Both facts belong to one project: keeping them across a
 * switch left the window saying where the project just closed stood, over the
 * one that had just opened. There is nothing here worth carrying - a head is one
 * call to learn again, and the count is read off the shards - so the honest move
 * is to forget it all and ask again.
 */
export class ServerSession {
  private readonly heads = new Map<string, number>();

  /** The unpushed count as the menu and the title last showed it. Undefined
   *  before anything has been drawn, which is also what a switch leaves. */
  shownEdits: number | undefined;

  /** The far end's latest revision for this project, when we have been told it. */
  head(dir: string): number | undefined { return this.heads.get(dir); }

  noteHead(dir: string, revision: number): void { this.heads.set(dir, revision); }

  /** A different project is a different standing: everything here goes. */
  forget(): void {
    this.heads.clear();
    this.shownEdits = undefined;
  }
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

/** ...and when the far end says the pack differs from its revision in nothing
 *  at all. The work is safe, which is what the person leaving wants to know,
 *  and claiming a push that did not happen would be the wrong way to say it. */
export const levelLine = (revision: number): string => `Already level with revision ${revision}`;

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
