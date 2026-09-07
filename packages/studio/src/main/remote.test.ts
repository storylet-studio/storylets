// ---------------------------------------------------------------------------
// The pack exchange, against a server that is really there.
//
// The fake below speaks the three calls over a loopback port and keeps its
// revisions as real `.storyletpack` bytes made by `runPack` from a real
// project. Nothing here hand-writes a zip: a pack whose bytes were typed out
// would prove that this code can read what this test can write, which is not
// the question.
//
// WHAT THE FAKE DOES NOT FAKE, stated plainly so nothing here is mistaken for
// a contract test of the far end:
//   - it does not merge. A push is recorded as the next revision whole, so
//     "the server merged your push against its head" is not exercised;
//   - it validates and compiles nothing, so a refusal for a project that does
//     not build is only ever the one this test asks it for;
//   - it has one version and one installation, so version routing (9.1.1) is
//     not exercised;
//   - it does not seal the contract shard into a pull, and it does not expire,
//     revoke or rate-limit a key: a code is good or it is not;
//   - its key rule compares shard TEXT rather than the parsed shard, so a
//     reformat would read as a change where the real one forgives it.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { StudioStore } from "./store.js";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
// JSZip only to SEAL a pack the fake sends, which is the one thing the public
// pack op does not do (the record is the far end's file, added on the way out).
// The pack itself is still `runPack`'s.
import JSZip from "jszip";
import { loadProject, runFormat, runPack } from "@storylet-studio/ops";
import { openProject } from "./project.js";
import type { ProjectSession } from "./project.js";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import {
  commit, createHand, moveCardsOnCanvas, moveSitesOnMap, postComment, redo, saveBox,
  saveCard, setGroupSpatial, setZonePolygon, undo,
} from "./mutate.js";
import {
  BASE_FILE, PULL_AS_DESIGNER, REMOTE_FILE, ServerSession, addressOf, askLeave, contractBreaks, failed,
  forgetShardHashes, hashProject, isShapeShard, leaveChoice, leavePrompt, levelLine, menuState,
  normalForm, normaliseAddress, nothingToPush, openPackBytes, pair, packAddress, packProject,
  planConnect, planPull, projectStatusLine, pullPack, pushPack, pushedLine, readBase, readRemote,
  refusalPrompt, refuseWrite, remoteInPack, resolveLeave, serverProblems, shardHash,
  statusLine, unpushedShards, writeBase, writeRemote,
} from "./remote.js";
import type { InAppPrompt, LeavePrompt, PairedKey, RemoteRecord } from "./remote.js";

const example = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));

/** A throwaway copy of the worked example, which is a real project with a real
 *  box, real decks and real cards in it. */
function copyExample(label: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), `remote-${label}-`)), "saltmarsh.storylets");
  cpSync(example, dir, { recursive: true });
  return dir;
}

const provenanceOf = (revision: number, role: string, origin: string): Record<string, unknown> => ({
  schema: "storylets/server-provenance@0",
  server: origin,
  installation: "the-park",
  version: "seed",
  revision,
  role,
  pulledAt: "2026-09-06T10:00:00.000Z",
});

/** Add the record a real server puts in a pack it sends, beside the manifest. */
async function seal(bytes: Buffer, revision: number, role: string, origin: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  zip.file(REMOTE_FILE, `${JSON.stringify(provenanceOf(revision, role, origin), null, 2)}\n`);
  return zip.generateAsync({ type: "nodebuffer" }) as Promise<Buffer>;
}

interface PushRecord {
  installation?: string;
  version?: string;
  base?: number;
  pack: Buffer;
  role: string;
  note?: string;
  acknowledge?: string[];
}

/** The fake. One installation, one version, a list of revisions. */
class FakeServer {
  readonly revisions: Buffer[] = [];
  readonly pushes: PushRecord[] = [];
  /** Set to refuse the next push with this, whatever it carries. */
  refuseNext?: { status: number; code: string; message: string; details?: unknown };
  /** Things a push breaks at this end, refused until every one is acknowledged.
   *  The real server matches an acknowledgement against a break's `where` and
   *  then its `path`, and so does this. */
  breaks?: { severity: string; path?: string; where?: string; message: string }[];
  /** Seal the packs it sends with the record a real one carries. */
  sealed = false;
  /** How many codes have been spent here. A single-use code is spent at the
   *  pair call, so this is what "nothing was spent" is checked against. */
  pairs = 0;
  private server?: Server;
  private port = 0;
  private readonly keys = new Map<string, string>();

  async start(seed: Buffer): Promise<void> {
    this.revisions.push(seed);
    this.server = createServer((req, res) => { void this.route(req, res); });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    this.port = typeof address === "object" && address !== null ? address.port : 0;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  get origin(): string { return `http://127.0.0.1:${this.port}`; }
  get head(): number { return this.revisions.length; }

  private roleOf(req: { headers: Record<string, unknown> }): string | undefined {
    const header = String(req.headers["authorization"] ?? "");
    const key = /^Bearer (.+)$/.exec(header)?.[1];
    return key === undefined ? undefined : this.keys.get(key);
  }

  private async route(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.origin);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
    const send = (status: number, payload: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const refuse = (status: number, code: string, message: string, details?: unknown): void =>
      send(status, { error: { code, message, ...(details !== undefined ? { details } : {}) } });

    if (url.pathname === "/v1/pair" && req.method === "POST") {
      this.pairs++;
      const code = String(body["code"] ?? "");
      const role = code === "AUTH-0001" ? "author" : code === "DSGN-0001" ? "designer" : undefined;
      if (role === undefined) {
        refuse(401, "code_expired", "That code has expired or has already been used. Ask for another.");
        return;
      }
      const key = `key-for-${role}`;
      this.keys.set(key, role);
      send(200, {
        key,
        principal: { principal: "p1", label: "Sam", role, issuedAt: "2026-09-06T09:00:00.000Z" },
        installation: { installation: "the-park", name: "The Park After Dark" },
        server: { version: "0.1.0", wire: "storyletengine/wire@1" },
        fingerprint: "aa:bb",
      });
      return;
    }

    const role = this.roleOf(req as unknown as { headers: Record<string, unknown> });
    if (role === undefined) { refuse(401, "unauthorized", "No bearer, or one this server cannot read."); return; }

    if (url.pathname === "/v1/console/project/pull" && req.method === "GET") {
      const asked = url.searchParams.get("revision");
      const revision = asked === null ? this.head : Number(asked);
      const pack = this.revisions[revision - 1];
      if (pack === undefined) { refuse(404, "bad_request", `no revision ${revision}`); return; }
      const bytes = this.sealed ? await seal(pack, revision, role, this.origin) : pack;
      send(200, {
        revision: { revision, version: "seed", installation: "the-park", at: "2026-09-06T10:00:00.000Z", by: { label: "Sam" }, role },
        pack: bytes.toString("base64"),
        provenance: provenanceOf(revision, role, this.origin),
      });
      return;
    }

    if (url.pathname === "/v1/console/project/push" && req.method === "POST") {
      const pack = Buffer.from(String(body["pack"] ?? ""), "base64");
      const acknowledge = body["acknowledge"] as string[] | undefined;
      this.pushes.push({
        installation: body["installation"] as string | undefined,
        version: body["version"] as string | undefined,
        base: body["base"] as number | undefined,
        pack, role,
        note: body["note"] as string | undefined,
        acknowledge,
      });
      const said = acknowledge ?? [];
      const outstanding = (this.breaks ?? []).filter(
        (b) => !said.includes(b.where ?? "") && !said.includes(b.path ?? ""),
      );
      if (outstanding.length > 0) {
        refuse(409, "contract_break",
          `That push breaks ${outstanding.length} thing${outstanding.length === 1 ? "" : "s"} `
          + "this end depends on. Nothing was recorded.", outstanding);
        return;
      }
      if (this.refuseNext !== undefined) {
        const { status, code, message, details } = this.refuseNext;
        this.refuseNext = undefined;
        refuse(status, code, message, details);
        return;
      }
      // THE KEY RULE, against the base this push says it was pulled from.
      const base = this.revisions[(body["base"] as number) - 1];
      if (role === "author" && base !== undefined) {
        const ours = await openPackBytes(base, "/tmp/fake-base");
        const theirs = await openPackBytes(pack, "/tmp/fake-theirs");
        const shape = [...theirs.shards].filter(([p, text]) => isShapeShard(p) && ours.shards.get(p) !== text);
        if (shape.length > 0) {
          refuse(403, "forbidden_shard",
            `This key is an author's, and this shard is the shape: ${shape[0]![0]}. ${PULL_AS_DESIGNER}.`);
          return;
        }
      }
      this.revisions.push(pack);
      send(200, {
        revision: { revision: this.head, version: "seed", installation: "the-park", at: "2026-09-06T11:00:00.000Z", by: { label: "Sam" }, role },
        changed: ["one.storyletdeck"],
      });
      return;
    }
    refuse(404, "bad_request", `no route ${url.pathname}`);
  }
}

let server: FakeServer;
let seedDir: string;
/** Real keys, from a real pairing, so no test depends on another having run. */
let designerKey = "";
let authorKey = "";

beforeAll(async () => {
  seedDir = copyExample("seed");
  server = new FakeServer();
  await server.start(await runPack(seedDir, { assets: true }));
  const designer = await pair(server.origin, "DSGN-0001", { app: "Storyletter", host: "test" });
  const author = await pair(server.origin, "AUTH-0001", { app: "Storyletter", host: "test" });
  if (failed(designer) || failed(author)) throw new Error("the fake would not pair");
  designerKey = designer.key;
  authorKey = author.key;
});

afterAll(async () => { await server.stop(); });

describe("connecting", () => {
  it("pairs, pulls, and lands a project with the remote recorded", async () => {
    const paired = await pair(server.origin, "DSGN-0001", { app: "Storyletter 0.6.0", host: "test" });
    expect(failed(paired)).toBe(false);
    if (failed(paired)) return;
    expect(paired.role).toBe("designer");
    expect(paired.installation).toBe("the-park");

    const pulled = await pullPack(server.origin, paired.key);
    expect(failed(pulled)).toBe(false);
    if (failed(pulled)) return;
    expect(pulled.revision).toBe(1);
    expect(pulled.version).toBe("seed");

    // Landing it: an empty folder has nothing to merge against, so every shard
    // is an add, which is what a plain unpack is.
    const target = join(mkdtempSync(join(tmpdir(), "remote-land-")), "saltmarsh.storylets");
    mkdirSync(target, { recursive: true });
    const plan = await planPull(target, pulled.bytes, undefined);
    expect(plan.added).toBeGreaterThan(0);
    expect(plan.merged).toBe(0);
    for (const write of plan.writes) {
      mkdirSync(join(write.path, ".."), { recursive: true });
      writeFileSync(write.path, write.content, "utf8");
    }
    writeRemote(target, {
      schema: "storylets/server-provenance@0",
      server: pulled.server, address: normaliseAddress(server.origin),
      installation: pulled.installation, version: pulled.version,
      revision: pulled.revision, role: pulled.role,
    });

    // It is a project, and it says where it came from.
    expect(loadProject(target).issues.filter((i) => i.severity === "error")).toEqual([]);
    const recorded = readRemote(target)!;
    expect(recorded.installation).toBe("the-park");
    expect(recorded.revision).toBe(1);
    expect(recorded.role).toBe("designer");
    expect(addressOf(recorded)).toBe(server.origin);
  });

  it("says so plainly when the code is spent", async () => {
    const paired = await pair(server.origin, "NOPE-0000", { app: "Storyletter", host: "test" });
    expect(failed(paired)).toBe(true);
    if (!failed(paired)) return;
    expect(paired.error).toContain("expired");
    expect(paired.code).toBe("code_expired");
  });

  it("reads the address out of a pack that carries one", async () => {
    server.sealed = true;
    const pulled = await pullPack(server.origin, designerKey);
    server.sealed = false;
    expect(failed(pulled)).toBe(false);
    if (failed(pulled)) return;
    const carried = await remoteInPack(pulled.bytes, seedDir);
    expect(carried).toBeDefined();
    expect(addressOf(carried!)).toBe(server.origin);
    // ...and the record is never mistaken for a shard: the exploded pack has
    // it out of the shard set.
    const opened = await openPackBytes(pulled.bytes, seedDir);
    expect([...opened.shards.keys()]).not.toContain(REMOTE_FILE);
  });
});

describe("the Server menu", () => {
  const remote: RemoteRecord = {
    schema: "storylets/server-provenance@0", server: "https://the-park.local:4480",
    installation: "the-park", version: "seed", revision: 3, role: "author",
  };

  it("is there only with a remote AND a key for it", () => {
    expect(menuState(undefined, true, 0)).toBeUndefined();
    expect(menuState(remote, false, 0)).toBeUndefined();
    expect(menuState(remote, true, 0)).toEqual({ status: "In sync" });
    expect(menuState(remote, true, 2)).toEqual({ status: "2 edits unpushed" });
  });

  it("says which of the three things is true", () => {
    expect(statusLine({ revision: 3, edits: 0 })).toBe("In sync");
    expect(statusLine({ revision: 3, edits: 0, head: 3 })).toBe("In sync");
    expect(statusLine({ revision: 3, edits: 0, head: 7 })).toBe("Behind: revision 7 on the server");
    expect(statusLine({ revision: 3, edits: 1 })).toBe("1 edit unpushed");
    expect(statusLine({ revision: 3, edits: 3, head: 7 })).toBe("3 edits unpushed");
  });
});

describe("pulling", () => {
  it("merges a server-side change into local edits, and leaves a sidecar when they disagree", async () => {
    // A working copy at revision 1.
    const mine = copyExample("pull");
    const deck = findDeck(mine);

    // The server moves on: the same card's title changed on its side.
    const theirs = copyExample("pull-theirs");
    const theirDeck = findDeck(theirs);
    writeFileSync(theirDeck.path, theirDeck.text.replace(theirDeck.title, "Their title"), "utf8");
    const headPack = await runPack(theirs, { assets: true });

    // ...and ours changed too, in the same field, which is a real conflict.
    writeFileSync(deck.path, deck.text.replace(deck.title, "Our title"), "utf8");

    const basePack = server.revisions[0]!;
    const plan = await planPull(mine, headPack, basePack);
    expect(plan.merged).toBeGreaterThan(0);
    expect(plan.conflicts).toBe(1);
    expect(plan.sidecars).toHaveLength(1);
    expect(plan.sidecars[0]!.path.endsWith(".storyletconflict")).toBe(true);

    // Ours stands in the file, and the sidecar records the disagreement: that
    // is the merge's own rule, and it is what the problems bar then shows.
    // The file is not REWRITTEN to say what it already says (2026-09-07): the
    // merge resolved to ours, so there is nothing for the plan to write, and a
    // write here would leave an author who typed nothing looking at an edit.
    expect(plan.writes.find((w) => w.path === deck.path)).toBeUndefined();
    expect(readFileSync(deck.path, "utf8")).toContain("Our title");
    expect(JSON.parse(plan.sidecars[0]!.content).conflicts).toHaveLength(1);
  });

  it("leaves a local edit alone when we are already level with the head", async () => {
    const mine = copyExample("pull-level");
    const deck = findDeck(mine);
    writeFileSync(deck.path, deck.text.replace(deck.title, "Only mine"), "utf8");
    // The head IS the ancestor, so there is nothing of theirs to take - and
    // therefore nothing to write over the edit either.
    const plan = await planPull(mine, server.revisions[0]!, server.revisions[0]!);
    expect(plan.conflicts).toBe(0);
    expect(plan.writes.find((w) => w.path === deck.path)).toBeUndefined();
    expect(readFileSync(deck.path, "utf8")).toContain("Only mine");
  });

  it("takes a shard the server has and we do not, verbatim", async () => {
    const mine = copyExample("pull-add");
    const theirs = copyExample("pull-add-theirs");
    const added = join(theirs, "extra.storyletnotes");
    writeFileSync(added, JSON.stringify({ schema: "storylets/notes@0", comments: {} }, null, 2), "utf8");
    const plan = await planPull(mine, await runPack(theirs, { assets: true }), server.revisions[0]!);
    const write = plan.writes.find((w) => w.path === join(mine, "extra.storyletnotes"));
    expect(write).toBeDefined();
    expect(plan.added).toBe(1);
  });

  // THE VENUE ALWAYS WINS ITS OWN FILE (design/engine-server.md 4.11). Found by
  // hand on 2026-09-07: the pack carried a newer contract, the project kept the
  // old one, and the toast said "16 merged" of seventeen shards. The base the
  // far end sends for an older revision carries no contract at all, so every
  // key of a merged one read as added on both sides and resolved to ours.
  it("takes the venue's own contract whole rather than merging it", async () => {
    const mine = copyExample("pull-contract");
    const theirs = copyExample("pull-contract-theirs");
    const ours = contract(mine, { revision: 1, hands: ["the-wall"] });
    const newer = contract(theirs, { revision: 4, hands: ["the-long-wall"] });

    const plan = await planPull(mine, await runPack(theirs, { assets: true }), server.revisions[0]!);
    const write = plan.writes.find((w) => w.path === ours.path);
    expect(write?.content, "the pack's copy, whole").toBe(readFileSync(newer.path, "utf8"));
    // Counted apart, so the numbers in the toast account for every shard, and
    // never as a merge: there is nothing here two sides could disagree about.
    expect(plan.replaced).toBe(1);
    expect(plan.conflicts).toBe(0);
    expect(plan.sidecars).toHaveLength(0);
  });

  it("counts the contract even when the pack's copy is the one we already have", async () => {
    const mine = copyExample("pull-contract-same");
    const theirs = copyExample("pull-contract-same-theirs");
    const ours = contract(mine, { revision: 4, hands: ["the-wall"] });
    contract(theirs, { revision: 4, hands: ["the-wall"] });
    const plan = await planPull(mine, await runPack(theirs, { assets: true }), server.revisions[0]!);
    expect(plan.replaced).toBe(1);
    expect(plan.writes.find((w) => w.path === ours.path), "nothing to write").toBeUndefined();
  });
});

describe("pushing", () => {
  it("sends the pack and the three declared fields, and comes back with the revision", async () => {
    const mine = copyExample("push");
    const deck = findDeck(mine);
    writeFileSync(deck.path, deck.text.replace(deck.title, "A pushed title"), "utf8");

    const before = server.head;
    const pushed = await pushPack(server.origin, designerKey, {
      pack: await packProject(mine), installation: "the-park", version: "seed", base: 1,
    });
    expect(failed(pushed)).toBe(false);
    if (failed(pushed)) return;
    expect(pushed.revision).toBe(before + 1);

    const sent = server.pushes.at(-1)!;
    expect(sent.installation).toBe("the-park");
    expect(sent.version).toBe("seed");
    expect(sent.base).toBe(1);
    // The pack really is the project, and it does NOT carry the record: the
    // pack op walks shard extensions, which is why the three fields exist.
    const opened = await openPackBytes(sent.pack, mine);
    expect([...opened.shards.keys()]).not.toContain(REMOTE_FILE);
    expect(opened.shards.get(deck.rel)).toContain("A pushed title");
  });

  it("shows the key rule's refusal in the far end's own words", async () => {
    const mine = copyExample("push-author");
    // An author key, reaching at the shape: the box shard.
    const box = findBox(mine);
    writeFileSync(box.path, box.text.replace(box.title, "Renamed by an author"), "utf8");
    const pushed = await pushPack(server.origin, authorKey, {
      pack: await packProject(mine), installation: "the-park", version: "seed", base: 1,
    });
    expect(failed(pushed)).toBe(true);
    if (!failed(pushed)) return;
    expect(pushed.code).toBe("forbidden_shard");
    expect(pushed.error).toContain(PULL_AS_DESIGNER);
    // Verbatim: not summarised, not re-worded, not prefixed.
    expect(pushed.error.endsWith(`${PULL_AS_DESIGNER}.`)).toBe(true);
  });

  it("carries a refusal's conflict sidecars back for the problems bar", async () => {
    const mine = copyExample("push-conflict");
    server.refuseNext = {
      status: 409, code: "conflict",
      message: 'That push does not merge cleanly against revision 2 of "seed": 1 shard disagrees.',
      details: [{ path: "one.storyletdeck.storyletconflict", text: "{}\n" }],
    };
    const pushed = await pushPack(server.origin, designerKey, {
      pack: await packProject(mine), installation: "the-park", version: "seed", base: 1,
    });
    expect(failed(pushed)).toBe(true);
    if (!failed(pushed)) return;
    expect(pushed.code).toBe("conflict");
    expect(Array.isArray(pushed.details)).toBe(true);
  });
});

// The far end's own words, and where each of them belongs. Both faults here
// were found by pushing a project that had nothing to push (2026-09-07): the
// remark was filed as an error, and the rows it was filed beside wore absolute
// paths where every other row in the bar is project-relative.
describe("what the far end says, and where it is shown", () => {
  const anchor = { dir: join("/tmp", "saltmarsh.storylets"), project: "saltmarsh.storyletproj" };

  it("reads 'nothing to push' as a remark rather than a refusal", () => {
    expect(nothingToPush({
      error: 'Nothing in that pack differs from revision 3 of "seed", so there is nothing to push.',
      code: "bad_request",
    })).toBe(true);
    // Everything else stays an error, refusals with a way through them included.
    expect(nothingToPush({ error: "That push does not merge cleanly.", code: "conflict" })).toBe(false);
    expect(nothingToPush({ error: "That push breaks 1 thing this end depends on.", code: "contract_break" })).toBe(false);
    expect(nothingToPush({ error: PULL_AS_DESIGNER, code: "forbidden_shard" })).toBe(false);
    // ...and a server nobody reached said nothing at all.
    expect(nothingToPush({ error: "fetch failed", offline: true })).toBe(false);
  });

  it("names shards the way the project does", () => {
    const rows = serverProblems(anchor, "That push breaks 1 thing this end depends on.", [
      {
        severity: "error", path: "encounters/hands.storylethands", where: "the-wall",
        message: 'hand "the-wall" is bound by a station at the-park',
      },
      // One that arrives absolute is put back into the project's own terms.
      { severity: "warning", path: join(anchor.dir, "encounters", "box.storyletbox"), message: "a warning" },
      // ...and one about nothing in particular is anchored to the project shard,
      // which is what the bar reads as "Project settings".
      { severity: "error", message: "something about the whole project" },
    ]);
    expect(rows.map((r) => r.path)).toEqual([
      "saltmarsh.storyletproj",
      "encounters/hands.storylethands",
      "encounters/box.storyletbox",
      "saltmarsh.storyletproj",
    ]);
    expect(rows.every((r) => !r.path.startsWith("/"))).toBe(true);
    expect(rows[1]!.where).toBe("the-wall");
    expect(rows[2]!.severity).toBe("warning");
  });

  it("files a refusal once, however the details repeat it", () => {
    const refusal = "That push does not merge cleanly against revision 4.";
    expect(serverProblems(anchor, refusal, undefined)).toEqual([
      { severity: "error", path: "saltmarsh.storyletproj", message: refusal },
    ]);
    // The same sentence in a detail row is the same problem: once, in the terms
    // the details put it in, rather than twice with two different paths.
    const twice = serverProblems(anchor, refusal, [{ path: "encounters/decks/docks.storyletdeck", message: refusal }]);
    expect(twice).toEqual([
      { severity: "error", path: "encounters/decks/docks.storyletdeck", message: refusal },
    ]);
  });
});

// Where a project stands with its server is a fact about THAT project, and a
// project switch used to keep it: the window went on saying where the one just
// closed stood (2026-09-07).
describe("the server state a sitting holds", () => {
  it("forgets every project's standing when the project changes", () => {
    const sitting = new ServerSession();
    sitting.noteHead("/projects/one", 7);
    sitting.shownEdits = 3;
    expect(sitting.head("/projects/one")).toBe(7);
    expect(statusLine({ revision: 3, edits: 0, head: sitting.head("/projects/one")! }))
      .toBe("Behind: revision 7 on the server");

    sitting.forget();
    expect(sitting.head("/projects/one")).toBeUndefined();
    expect(sitting.shownEdits).toBeUndefined();
    // Nothing known is nothing claimed: the line says where the project itself
    // says it stands, and asks the server again.
    expect(statusLine({ revision: 3, edits: 0, ...(sitting.head("/projects/one") !== undefined ? { head: 7 } : {}) }))
      .toBe("In sync");
  });
});

describe("what Storyletter sends is in the format's own canonical form", () => {
  /** Every shard in this project, in the canonical bytes `storyletengine format`
   *  would write. Empty means the project on disk already IS that. */
  const notCanonical = (dir: string): string[] => {
    const result = runFormat(loadProject(dir));
    expect(result.issues).toEqual([]);
    return [...result.changed.map((w) => w.path), ...result.removed]
      .map((path) => relative(dir, path)).sort();
  };

  it("writes shards a formatter would not touch, so a push is byte-stable", async () => {
    // The other half of a push that comes back "not in sync": the far end stores
    // what it is sent in its own canonical order, so a pack whose shards were
    // written in some other order reads as a shape change on files nobody
    // touched. Nothing here can fix the far end's comparison, and it does not
    // try; what it holds is OUR end of the bargain, which is that every shard
    // this app writes is already canonical.
    const dir = copyExample("canonical");
    // The fixture first, so a failure says which half moved.
    expect(notCanonical(dir), "the worked example is not canonical to begin with").toEqual([]);

    const opened = openProject(dir);
    if ("error" in opened) throw new Error(opened.error);
    const session = opened.session;
    const box = session.dto.boxes[0]!;
    const deck = box.decks[0]!;

    // One edit through each shard the editor writes: a card (deck), a box, a
    // hand and its map site, a zone outline (tags), a canvas (view), a comment
    // (notes), and the project file.
    expect("error" in saveCard(session, deck.id, deck.cards[0]!.id, { title: "Rewritten" })).toBe(false);
    expect("error" in saveBox(session, box.id, { purpose: "Rewritten too" })).toBe(false);
    const hand = createHand(session, box.id);
    if ("error" in hand) throw new Error(hand.error);
    const group = session.loaded.source!.boxes[0]!.tags.groups[0]!;
    expect("error" in setGroupSpatial(session, box.id, group.id, true)).toBe(false);
    expect("error" in setZonePolygon(session, box.id, group.id, group.tags[0]!.id,
      [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 90 }, { x: 0, y: 90 }])).toBe(false);
    expect("error" in moveSitesOnMap(session, box.id, group.id,
      [{ id: hand.handId, x: 40, y: 40 }])).toBe(false);
    expect("error" in moveCardsOnCanvas(session, deck.id, [{ id: deck.cards[0]!.id, x: 30, y: 60 }])).toBe(false);
    expect("error" in postComment(session, deck.cards[0]!.id, "t_1", "Sam", "Does this read?")).toBe(false);

    expect(notCanonical(session.loaded.dir)).toEqual([]);

    // And what actually goes up: every shard in the pack, byte for byte what a
    // formatter would leave.
    const sent = await openPackBytes(await packProject(session.loaded.dir), session.loaded.dir);
    for (const [name, text] of sent.shards) {
      expect(canonicalStringify(parseSource(text)), `${name} was packed in some other order`).toBe(text);
    }
  });
});

describe("the note and the breaks a push carries", () => {
  it("sends the note up with the pack", async () => {
    const mine = copyExample("push-note");
    const pushed = await pushPack(server.origin, designerKey, {
      pack: await packProject(mine), installation: "the-park", version: "seed", base: 1,
      note: "the second act, roughed in",
    });
    expect(failed(pushed)).toBe(false);
    expect(server.pushes.at(-1)!.note).toBe("the second act, roughed in");
  });

  it("refuses over what it says the push breaks, then takes it once each is acknowledged", async () => {
    const mine = copyExample("push-breaks");
    server.breaks = [
      { severity: "error", where: "hand:h_inn", message: "A station deals this hand." },
      { severity: "error", path: "village/village.storyletbox", message: "This box is ticked every 60s." },
    ];
    const body = {
      pack: await packProject(mine), installation: "the-park", version: "seed", base: 1,
    };
    const refused = await pushPack(server.origin, designerKey, body);
    expect(failed(refused)).toBe(true);
    if (!failed(refused)) return;
    expect(refused.code).toBe("contract_break");

    // The dialog's list: the far end's own sentences, and the word IT knows
    // each one by, which is what goes back.
    const listed = contractBreaks(refused.details);
    expect(listed.map((b) => b.message)).toEqual([
      "A station deals this hand.", "This box is ticked every 60s.",
    ]);
    expect(listed.map((b) => b.key)).toEqual(["hand:h_inn", "village/village.storyletbox"]);

    // One tick is not enough: the far end still names the other.
    const half = await pushPack(server.origin, designerKey, { ...body, acknowledge: [listed[0]!.key] });
    expect(failed(half)).toBe(true);
    if (!failed(half)) return;
    expect(contractBreaks(half.details)).toHaveLength(1);

    const landed = await pushPack(server.origin, designerKey, {
      ...body, acknowledge: listed.map((b) => b.key),
    });
    server.breaks = undefined;
    expect(failed(landed)).toBe(false);
    expect(server.pushes.at(-1)!.acknowledge).toEqual(["hand:h_inn", "village/village.storyletbox"]);
  });

  it("reads a refusal that named nothing tickable as no breaks at all", () => {
    expect(contractBreaks(undefined)).toEqual([]);
    expect(contractBreaks("that is not a list")).toEqual([]);
    // A row with nothing to say is a row with nothing to tick.
    expect(contractBreaks([{ severity: "error", path: "a.storyletbox" }])).toEqual([]);
    // No `where` and no `path`: the far end matches an empty acknowledgement,
    // so an empty key is what it will recognise.
    expect(contractBreaks([{ message: "Something gives." }])).toEqual([{ key: "", message: "Something gives." }]);
  });
});

describe("a pack that names where it came from", () => {
  it("answers with the address, whether it was picked or handed to us", async () => {
    server.sealed = true;
    const pulled = await pullPack(server.origin, designerKey);
    server.sealed = false;
    expect(failed(pulled)).toBe(false);
    if (failed(pulled)) return;
    expect(await packAddress(pulled.bytes, seedDir)).toBe(server.origin);
  });

  it("answers with nothing for an ordinary pack, and for bytes that are not one", async () => {
    expect(await packAddress(server.revisions[0]!, seedDir)).toBeUndefined();
    expect(await packAddress(Buffer.from("not a zip"), seedDir)).toBeUndefined();
  });
});

describe("two jobs at one venue", () => {
  /** What main does with the open project in hand: the key whose ROLE matches
   *  this project's sidecar. Written out here because the caller is the Electron
   *  half and this is the whole of the rule it applies. */
  const keyFor = (store: StudioStore, dir: string): { key: string; role: string } | undefined => {
    const remote = readRemote(dir);
    if (remote === undefined) return undefined;
    const held = store.serverKey(addressOf(remote), remote.role);
    return held === undefined ? undefined : { key: held.key, role: held.role };
  };

  it("keeps an author's project and a designer's project apart at one address", async () => {
    // The fault of 2026-09-07, end to end. Pairing the designer project second
    // used to overwrite the author project's key, and the author's project then
    // pulled as a designer: its sidecar flipped role, and the read-only rule on
    // the shape went with it.
    const settings = mkdtempSync(join(tmpdir(), "remote-two-roles-"));
    const store = new StudioStore(settings);

    const writing = copyExample("two-roles-author");
    const author = await pair(server.origin, "AUTH-0001", { app: "Storyletter", host: "test" });
    if (failed(author)) throw new Error(author.error);
    store.setServerKey(server.origin, { key: author.key, role: author.role, installation: author.installation });
    writeRemote(writing, {
      schema: "storylets/server-provenance@0", server: server.origin, address: server.origin,
      installation: "the-park", version: "seed", revision: 1, role: "author",
    });

    // ...and now the same person pairs a SECOND project as a designer.
    const shaping = copyExample("two-roles-designer");
    const designer = await pair(server.origin, "DSGN-0001", { app: "Storyletter", host: "test" });
    if (failed(designer)) throw new Error(designer.error);
    store.setServerKey(server.origin, { key: designer.key, role: designer.role, installation: designer.installation });
    writeRemote(shaping, {
      schema: "storylets/server-provenance@0", server: server.origin, address: server.origin,
      installation: "the-park", version: "seed", revision: 1, role: "designer",
    });

    expect(keyFor(store, writing)).toEqual({ key: author.key, role: "author" });
    expect(keyFor(store, shaping)).toEqual({ key: designer.key, role: "designer" });
    expect(author.key).not.toBe(designer.key);

    // The author's project is still an author's, so the shape is still refused
    // to it: the rule that went missing when the key was overwritten.
    expect(refuseWrite(readRemote(writing)!.role, ["/p/a.storylethands"])).toBe(PULL_AS_DESIGNER);
    expect(refuseWrite(readRemote(shaping)!.role, ["/p/a.storylethands"])).toBeUndefined();

    // And a pull with the author's key really is an author's pull: the pack the
    // far end sends back says so.
    const pulled = await pullPack(server.origin, keyFor(store, writing)!.key, { installation: "the-park", version: "seed" });
    expect(failed(pulled)).toBe(false);
    if (failed(pulled)) return;
    expect(pulled.role).toBe("author");
  });

  it("forgetting the open project's key leaves the other job's alone", () => {
    const settings = mkdtempSync(join(tmpdir(), "remote-forget-slot-"));
    const store = new StudioStore(settings);
    store.setServerKey(server.origin, { key: "author-key", role: "author" });
    store.setServerKey(server.origin, { key: "designer-key", role: "designer" });

    const writing = copyExample("forget-slot");
    writeRemote(writing, {
      schema: "storylets/server-provenance@0", server: server.origin, address: server.origin,
      installation: "the-park", version: "seed", revision: 1, role: "author",
    });
    store.forgetServer(addressOf(readRemote(writing)!), readRemote(writing)!.role);

    // The author's project has no key now, so it has no Server menu either.
    expect(keyFor(store, writing)).toBeUndefined();
    expect(menuState(readRemote(writing), false, 0)).toBeUndefined();
    expect(store.serverKey(server.origin, "designer")!.key).toBe("designer-key");
  });
});

describe("the role, in the editor", () => {
  it("reads the shape shards off the writer's list", () => {
    expect(isShapeShard("a.storyletbox")).toBe(true);
    expect(isShapeShard("a.storylettags")).toBe(true);
    expect(isShapeShard("a.storylethands")).toBe(true);
    expect(isShapeShard("a.storyletproj")).toBe(true);
    // The view shard joined the AUTHOR's list on 2026-09-06, when the map moved
    // out of it into a shard of its own (design/engine-server.md 9.1 point 5):
    // the canvases are the author's working drawing, the map is the shape.
    expect(isShapeShard("a.storyletview")).toBe(false);
    expect(isShapeShard("a.storyletmap")).toBe(true);
    expect(isShapeShard("a.storyletdeck")).toBe(false);
    expect(isShapeShard("a.storyletnotes")).toBe(false);
    expect(isShapeShard("README.md")).toBe(false);
  });

  it("refuses an author's write to the shape and allows a designer's", () => {
    expect(refuseWrite("author", ["/p/a.storyletbox"])).toBe(PULL_AS_DESIGNER);
    expect(refuseWrite("author", ["/p/a.storyletdeck"])).toBeUndefined();
    expect(refuseWrite("designer", ["/p/a.storyletbox"])).toBeUndefined();
    expect(refuseWrite(undefined, ["/p/a.storyletbox"])).toBeUndefined();
  });

  it("lets an author arrange a canvas and refuses them the map", () => {
    // The two halves of the shard that split (9.1 point 5), each on the side the
    // ruling put it: a deck's canvas is the author's to push, a hand's position
    // ships in the bundle and stays the designer's.
    expect(refuseWrite("author", ["/p/village/view.storyletview"])).toBeUndefined();
    expect(refuseWrite("author", ["/p/village/map.storyletmap"])).toBe(PULL_AS_DESIGNER);
    expect(refuseWrite("designer", ["/p/village/map.storyletmap"])).toBeUndefined();
  });

  it("stops the write itself, not only the controls", () => {
    const dir = copyExample("role");
    const opened = openProject(dir);
    expect("error" in opened).toBe(false);
    if ("error" in opened) return;
    const session = opened.session;
    const remote: RemoteRecord = {
      schema: "storylets/server-provenance@0", server: "http://x", installation: "the-park",
      version: "seed", revision: 1, role: "author",
    };
    writeRemote(dir, remote);

    const box = session.dto.boxes[0]!;
    const refused = saveBox(session, box.id, { purpose: "an author reaching at the shape" });
    expect(refused).toEqual({ error: PULL_AS_DESIGNER });

    // The same edit under a designer's key lands.
    writeRemote(dir, { ...remote, role: "designer" });
    const allowed = saveBox(session, box.id, { purpose: "a designer changing the shape" });
    expect("error" in allowed).toBe(false);
  });
});

// The unpushed count, rebuilt 2026-09-07 after the author checked it by hand.
// It was a tally: it counted logical edits rather than changed shards, it
// counted an undo and a redo as further edits (type, undo read as 2; again, 4),
// and it was only ever redrawn on the next event, so the edit showed up at the
// undo. It is now the NUMBER OF SHARDS whose canonical text differs from the
// revision last pulled, asked of the files every time.
describe("unpushed shards", () => {
  /** A project with a remote and a base at revision 1: everything level. */
  const levelProject = (label: string): { dir: string; session: ProjectSession } => {
    const dir = copyExample(label);
    const opened = openProject(dir);
    if ("error" in opened) throw new Error(opened.error);
    writeRemote(dir, {
      schema: "storylets/server-provenance@0", server: "http://x", installation: "the-park",
      version: "seed", revision: 1, role: "designer",
    });
    forgetShardHashes();
    writeBase(dir, 1, hashProject(dir));
    return { dir, session: opened.session };
  };

  it("is nothing at all until something differs", () => {
    const { dir } = levelProject("count-level");
    expect(unpushedShards(dir)).toBe(0);
    expect(statusLine({ revision: 1, edits: unpushedShards(dir) })).toBe("In sync");
  });

  it("reads in sync again after an undo: a typed edit put back is not unpushed", () => {
    const { dir, session } = levelProject("count-undo");
    const deck = session.dto.boxes[0]!.decks[0]!;
    const card = deck.cards[0]!;
    expect("error" in saveCard(session, deck.id, card.id, { title: "An edited title" })).toBe(false);
    expect(unpushedShards(dir)).toBe(1);

    // THE FAULT THIS REPLACED: type then undo read as two edits, because both
    // were counted and neither was compared with anything.
    expect(undo(session)).not.toBeNull();
    expect(unpushedShards(dir)).toBe(0);

    // ...and a redo puts it back to one, for the same reason: the shard differs.
    expect(redo(session)).not.toBeNull();
    expect(unpushedShards(dir)).toBe(1);
  });

  it("counts SHARDS, however many times each was typed in", () => {
    const { dir, session } = levelProject("count-shards");
    const deck = session.dto.boxes[0]!.decks[0]!;
    const card = deck.cards[0]!;
    saveCard(session, deck.id, card.id, { title: "An edited title" });
    saveCard(session, deck.id, card.id, { title: "An edited title again" });
    saveCard(session, deck.id, card.id, { title: "And once more" });
    expect(unpushedShards(dir), "one shard, three keystrokes").toBe(1);

    // A second shard is a second difference.
    commit(session, "test", "struct:1", [{
      path: join(dir, "extra.storyletnotes"), content: "{schema:'storylets/notes@0'}\n",
    }]);
    expect(unpushedShards(dir)).toBe(2);
    expect(statusLine({ revision: 1, edits: unpushedShards(dir) })).toBe("2 edits unpushed");
  });

  it("forgives a reformat and notices a hand edit", () => {
    const { dir } = levelProject("count-canonical");
    const deck = findDeck(dir);
    // The same shard, spaced differently: the base is a hash of the CANONICAL
    // text, so nothing here differs.
    writeFileSync(deck.path, `\n${deck.text}\n\n`, "utf8");
    expect(unpushedShards(dir)).toBe(0);
    // A change to what it SAYS does differ.
    writeFileSync(deck.path, deck.text.replace(deck.title, "Something else entirely"), "utf8");
    expect(unpushedShards(dir)).toBe(1);
  });

  it("counts a shard added or deleted since the pull", () => {
    const { dir } = levelProject("count-addremove");
    writeFileSync(join(dir, "extra.storyletnotes"), "{schema:'storylets/notes@0'}\n", "utf8");
    expect(unpushedShards(dir)).toBe(1);
    rmSync(join(dir, "extra.storyletnotes"));
    expect(unpushedShards(dir)).toBe(0);

    const deck = findDeck(dir);
    rmSync(deck.path);
    expect(unpushedShards(dir), "a deleted shard is a difference the server has not seen").toBe(1);
  });

  it("says nothing unpushed for a project with no base, and none for one with no remote", () => {
    const dir = copyExample("count-no-base");
    expect(unpushedShards(dir)).toBe(0);
    expect(readRemote(dir)).toBeUndefined();
    expect(readBase(dir)).toBeUndefined();
  });

  // ORDER IS NEVER A CHANGE (the ruling of 2026-09-07, which the far end
  // compares by too). Found by pulling into a project nobody had touched and
  // reading "4 edits unpushed": the merge re-emits name-keyed lists sorted -
  // `properties` in the project file, `fields` in two box shards - and a base
  // of canonical TEXT counted the sort. The format sorts a list keyed by ID on
  // its own way out, so these are the lists where the two ends could disagree.
  it("does not count the order of a name-keyed list", () => {
    const { dir } = levelProject("count-order-hash");
    const proj = findProject(dir);
    const reversed = reorderProperties(proj.text);
    expect(reversed, "the same shard, stored the other way round").not.toBe(proj.text);
    expect(shardHash(reversed)).toBe(shardHash(proj.text));
    // The normal form is the merge's own, so a shard already in it is unmoved.
    expect(canonicalStringify(normalForm(parseSource(proj.text) as Record<string, unknown>)))
      .toBe(canonicalStringify(normalForm(parseSource(reversed) as Record<string, unknown>)));

    writeFileSync(proj.path, reversed, "utf8");
    forgetShardHashes();
    expect(unpushedShards(dir)).toBe(0);
  });

  it("reads In sync after a pull that only reordered a shard, and rewrites nothing", async () => {
    const { dir } = levelProject("count-order-pull");
    const proj = findProject(dir);
    const before = readFileSync(proj.path, "utf8");

    // The server's copy of the same revision, with the project's own properties
    // the other way round: the shape a pack comes back in once anything at that
    // end has merged it.
    const theirs = copyExample("count-order-pull-theirs");
    const theirProj = findProject(theirs);
    writeFileSync(theirProj.path, reorderProperties(theirProj.text), "utf8");

    const plan = await planPull(dir, await runPack(theirs, { assets: true }), server.revisions[0]!);
    expect(plan.writes.find((w) => w.path === proj.path), "nothing to write").toBeUndefined();
    expect(plan.conflicts).toBe(0);

    for (const write of plan.writes) writeFileSync(write.path, write.content, "utf8");
    writeBase(dir, 2, plan.base);
    forgetShardHashes();
    expect(readFileSync(proj.path, "utf8"), "left exactly as it was").toBe(before);
    expect(unpushedShards(dir)).toBe(0);
    expect(statusLine({ revision: 2, edits: unpushedShards(dir) })).toBe("In sync");
  });

  it("keeps the base out of the pack, and out of the shards", async () => {
    const { dir } = levelProject("count-base-file");
    expect(existsSync(join(dir, BASE_FILE))).toBe(true);
    const opened = await openPackBytes(await packProject(dir), dir);
    expect([...opened.shards.keys()]).not.toContain(BASE_FILE);
    expect([...opened.shards.keys()]).not.toContain(REMOTE_FILE);
  });
});

describe("the prompt on the way out", () => {
  // The app has ONE dialog style, and until 2026-09-07 this question wore the
  // OS's: a `showMessageBox` attached to the editor window, which on the close
  // path had already had its close deferred. Dismissing that sheet let the
  // deferred close through whatever button had been clicked, so Cancel closed
  // the window and Push closed it without pushing. The prompt is the renderer's
  // now; the native box is the fallback and nothing else.
  const standing = { revision: 3, edits: 3 };
  const indexOf = (prompt: LeavePrompt, label: string): number => {
    const at = prompt.buttons.indexOf(label);
    if (at < 0) throw new Error(`no "${label}" button in [${prompt.buttons.join(", ")}]`);
    return at;
  };
  /** A renderer that draws the dialog and then somebody clicks `label`. */
  const clicks = (label: string) => (prompt: LeavePrompt): InAppPrompt =>
    ({ shown: Promise.resolve(), answer: Promise.resolve(indexOf(prompt, label)) });
  /** The same, natively. */
  const press = (label: string) => async (prompt: LeavePrompt): Promise<number> =>
    indexOf(prompt, label);
  const nativeRefusal = async (): Promise<number> => { throw new Error("the native box must not be reached"); };

  it("names its project, says where it stands, and offers the act it is in the middle of", () => {
    // IT NAMES THE PROJECT (2026-09-07). This is asked at the one moment two are
    // in play - opening one over another, which is how connecting to a server
    // lands a pulled project - and unnamed it read as if it were about the one
    // arriving rather than the one being left.
    expect(leavePrompt("This Room", standing, "quit", true)).toMatchObject({
      message: "This Room: 3 edits unpushed",
      detail: "This Room has edits the server has not seen.",
      buttons: ["Push to server", "Quit without pushing", "Cancel"],
      defaultId: 0, cancelId: 2,
    });
    expect(leavePrompt("This Room", standing, "close", true).buttons[1]).toBe("Close without pushing");
    expect(projectStatusLine("This Room", { revision: 3, edits: 1 })).toBe("This Room: 1 edit unpushed");
  });

  it("falls back to the general word for a project with no name to give", () => {
    expect(leavePrompt("  ", standing, "quit", true)).toMatchObject({
      message: "This project: 3 edits unpushed",
      detail: "This project has edits the server has not seen.",
    });
  });

  it("offers no push when the server cannot be reached, and says so", () => {
    const prompt = leavePrompt("This Room", standing, "quit", false);
    expect(prompt.detail).toBe(
      "This Room has edits the server has not seen, and the server cannot be reached.");
    expect(prompt.buttons).toEqual(["Quit without pushing", "Cancel"]);
    // The edits wait: there is no way through this prompt that pushes.
    expect(prompt.choices).not.toContain("push");
  });

  for (const act of ["quit", "close"] as const) {
    const leave = act === "quit" ? "Quit without pushing" : "Close without pushing";

    it(`answers all three ways on the ${act} path`, async () => {
      const prompt = leavePrompt("This Room", standing, act, true);
      expect(await askLeave(prompt, clicks("Push to server"), nativeRefusal)).toBe("push");
      expect(await askLeave(prompt, clicks(leave), nativeRefusal)).toBe("leave");
      expect(await askLeave(prompt, clicks("Cancel"), nativeRefusal)).toBe("cancel");
    });
  }

  it("reads an index that is not a button as a cancel", () => {
    const prompt = leavePrompt("This Room", standing, "quit", true);
    expect(leaveChoice(prompt, 7)).toBe("cancel");
    expect(leaveChoice(prompt, -1)).toBe("cancel");
  });

  it("falls back to the native box when there is no renderer to ask", async () => {
    const prompt = leavePrompt("This Room", standing, "quit", true);
    expect(await askLeave(prompt, undefined, press("Cancel"))).toBe("cancel");
  });

  it("falls back when the renderer never says it drew the dialog", async () => {
    const prompt = leavePrompt("This Room", standing, "quit", true);
    const silent = (): InAppPrompt =>
      ({ shown: new Promise<void>(() => { /* never */ }), answer: new Promise<number>(() => { /* never */ }) });
    expect(await askLeave(prompt, silent, press("Cancel"), 10)).toBe("cancel");
    const threw = (): InAppPrompt =>
      ({ shown: Promise.reject(new Error("the renderer went")), answer: Promise.resolve(0) });
    expect(await askLeave(prompt, threw, press("Cancel"))).toBe("cancel");
  });

  it("WAITS for the person once the dialog is up: a long think is not a fallback", async () => {
    // The fault this split exists for, found by launching the app and leaving
    // the prompt sitting there: one deadline over both the bridge and the human
    // put a system box on top of the dialog four seconds in.
    const prompt = leavePrompt("This Room", standing, "quit", true);
    let click = (_index: number): void => { /* replaced */ };
    const thinking = (): InAppPrompt => ({
      shown: Promise.resolve(),
      answer: new Promise<number>((resolve) => { click = resolve; }),
    });
    const answering = askLeave(prompt, thinking, nativeRefusal, 5);
    await new Promise((r) => setTimeout(r, 30));   // well past the deadline
    click(0);
    expect(await answering).toBe("push");
  });

  it("reads an answer that is not a button as a cancel, however it arrives", async () => {
    const prompt = leavePrompt("This Room", standing, "quit", true);
    const confused = (): InAppPrompt => ({ shown: Promise.resolve(), answer: Promise.resolve(9) });
    expect(await askLeave(prompt, confused, nativeRefusal)).toBe("cancel");
    // ...and a renderer that drew it and then fell over answers as Cancel too,
    // rather than putting a second dialog in front of a person who has one.
    const fell = (): InAppPrompt =>
      ({ shown: Promise.resolve(), answer: Promise.reject(new Error("gone")) });
    expect(await askLeave(prompt, fell, nativeRefusal)).toBe("cancel");
  });
});

describe("leaving with edits the server has not seen", () => {
  const landed = async (): Promise<{ revision: number }> => ({ revision: 9 });
  const refused = async (): Promise<{ error: string }> => ({ error: PULL_AS_DESIGNER });

  it("cancels: nothing happens and the app stays", async () => {
    expect(await resolveLeave("cancel", landed)).toEqual({ go: false });
  });

  it("leaves without pushing: the edits wait", async () => {
    expect(await resolveLeave("leave", refused)).toEqual({ go: true });
  });

  it("pushes and goes when the push lands", async () => {
    expect(await resolveLeave("push", landed)).toEqual({ go: true });
  });

  it("does NOT go when the push is refused, and says why", async () => {
    expect(await resolveLeave("push", refused)).toEqual({ go: false, refusal: PULL_AS_DESIGNER });
  });

  // The person is leaving, and the last thing they see must be that the work is
  // safe: not theatre, but "my project is securely pushed". The prompt turns
  // into the revision it landed as, and the app waits there before it lets go.
  it("holds a word of confirmation between the push landing and the window going", async () => {
    const seen: string[] = [];
    let held = false;
    const outcome = await resolveLeave("push", landed, async (revision) => {
      seen.push(pushedLine(revision));
      // The wait is injected, so what is tested is the SEQUENCE rather than a
      // second and a half of a test suite's time.
      await new Promise((resolve) => setTimeout(resolve, 5));
      held = true;
    });
    expect(seen).toEqual(["Pushed as revision 9"]);
    expect(held, "the app must not let go until the beat has been held").toBe(true);
    expect(outcome).toEqual({ go: true });
  });

  // A push the far end answers "nothing in that pack differs" to is a way out
  // rather than a refusal: the work is already there. The closing word says so
  // instead of claiming a push that did not happen.
  it("says the work is already there when the far end says nothing differs", async () => {
    const seen: string[] = [];
    const outcome = await resolveLeave("push", async () => ({ revision: 4 }), async (revision) => {
      seen.push(levelLine(revision));
    });
    expect(seen).toEqual(["Already level with revision 4"]);
    expect(outcome).toEqual({ go: true });
  });

  it("says nothing of the kind when there was no push, or when it was refused", async () => {
    const settle = async (): Promise<void> => { throw new Error("nothing landed, so nothing landed"); };
    expect(await resolveLeave("cancel", landed, settle)).toEqual({ go: false });
    expect(await resolveLeave("leave", landed, settle)).toEqual({ go: true });
    expect(await resolveLeave("push", refused, settle)).toEqual({ go: false, refusal: PULL_AS_DESIGNER });
  });
});

// A refusal reached at the moment of leaving used to leave the person exactly
// where they were with only the problems bar as evidence, and on the connect
// path the pulled project never opened: they pressed Push to server and nothing
// visibly happened. The prompt says it now, in the far end's own words.
describe("a refused push, at the prompt", () => {
  const standing = { revision: 3, edits: 1 };

  it("shows the refusal, and offers one way out of it", () => {
    const prompt = refusalPrompt("This Room", standing, PULL_AS_DESIGNER);
    expect(prompt).toMatchObject({
      message: "This Room: 1 edit unpushed",
      detail: PULL_AS_DESIGNER,
      buttons: ["Stay"],
      defaultId: 0, cancelId: 0,
    });
    // There is no way through it: Stay is a cancel, and cancel does not leave.
    expect(leaveChoice(prompt, 0)).toBe("cancel");
    expect(leaveChoice(prompt, 1)).toBe("cancel");
  });

  it("takes each of the three refusals through the prompt in the words they came in", async () => {
    // Every one of these is the far end saying no with no way through it, so
    // every one gets the same one-button prompt with its own sentence in it.
    const dir = copyExample("refused-at-prompt");
    writeRemote(dir, {
      schema: "storylets/server-provenance@0", server: server.origin, address: server.origin,
      installation: "the-park", version: "seed", revision: 1, role: "author",
    });

    /** The push a leaving prompt makes: no note, no acknowledgements. */
    const pushOut = async (key: string): Promise<{ revision: number } | { error: string }> => {
      const sent = await pushPack(server.origin, key, {
        pack: await packProject(dir), installation: "the-park", version: "seed", base: 1,
      });
      return failed(sent) ? { error: sent.error } : { revision: sent.revision };
    };

    // 1. A conflict, whose sidecars come back with it.
    server.refuseNext = {
      status: 409, code: "conflict",
      message: "Somebody else pushed revision 2 while you were working. Pull, then push again.",
      details: [{ path: "main/decks/one.storyletdeck.storyletconflict", text: "conflict\n" }],
    };
    const clash = await resolveLeave("push", () => pushOut(designerKey));
    expect(clash.go).toBe(false);
    expect(refusalPrompt("This Room", standing, clash.refusal!)).toMatchObject({
      detail: "Somebody else pushed revision 2 while you were working. Pull, then push again.",
      buttons: ["Stay"],
    });

    // 2. A project the far end will not compile.
    server.refuseNext = {
      status: 422, code: "invalid",
      message: "That project does not build here: 2 errors. Nothing was recorded.",
    };
    const broken = await resolveLeave("push", () => pushOut(designerKey));
    expect(broken).toEqual({
      go: false,
      refusal: "That project does not build here: 2 errors. Nothing was recorded.",
    });
    expect(refusalPrompt("This Room", standing, broken.refusal!).buttons).toEqual(["Stay"]);

    // 3. The key rule: an author's key reaching at the shape.
    const box = findBox(dir);
    writeFileSync(box.path, box.text.replace(box.title, "A shape an author may not change"), "utf8");
    const rebuked = await resolveLeave("push", () => pushOut(authorKey));
    expect(rebuked.go).toBe(false);
    expect(rebuked.refusal).toContain(PULL_AS_DESIGNER);
    expect(refusalPrompt("This Room", standing, rebuked.refusal!)).toMatchObject({
      detail: rebuked.refusal,
      buttons: ["Stay"],
    });
  });
});

// Connecting spends a single-use code, so it asks where the project goes FIRST.
describe("connecting, in the order it spends things", () => {
  const device = { app: "Storyletter", host: "test" };
  /** A pair call the fake can count, so "nothing was spent" is a fact rather
   *  than an inference. */
  const kept: PairedKey[] = [];
  const keepKey = (_dialled: string, paired: PairedKey): void => { kept.push(paired); };

  it("does not pair at all when the folder picker is cancelled", async () => {
    kept.length = 0;
    const before = server.pairs;
    const planned = await planConnect({
      address: server.origin, code: "DSGN-0001", device,
      chooseFolder: async () => null,
      keepKey,
    });
    expect(planned, "backing out of the picker is not an error, it is nothing at all").toBeNull();
    // THE FAULT THIS FIXES: the code was already gone by this point.
    expect(server.pairs).toBe(before);
    expect(kept).toEqual([]);
  });

  it("does not pair when the folder will not do, and says why", async () => {
    kept.length = 0;
    const before = server.pairs;
    const occupied = mkdtempSync(join(tmpdir(), "remote-occupied-"));
    writeFileSync(join(occupied, "something.txt"), "already here\n", "utf8");
    const planned = await planConnect({
      address: server.origin, code: "DSGN-0001", device,
      chooseFolder: async () => occupied,
      refuseFolder: () => "there is already something in that folder, and the project needs one of its own.",
      keepKey,
    });
    expect(planned).toEqual({
      error: "there is already something in that folder, and the project needs one of its own.",
    });
    expect(server.pairs).toBe(before);
    expect(kept).toEqual([]);
  });

  it("pairs and pulls once there is somewhere for the project to go", async () => {
    kept.length = 0;
    const target = join(mkdtempSync(join(tmpdir(), "remote-connect-")), "saltmarsh.storylets");
    const planned = await planConnect({
      address: server.origin, code: "DSGN-0001", device,
      chooseFolder: async () => target,
      refuseFolder: () => undefined,
      keepKey,
    });
    expect(planned).not.toBeNull();
    if (planned === null || failed(planned)) throw new Error("the fake would not connect");
    expect(planned.target).toBe(target);
    expect(planned.remote.installation).toBe("the-park");
    // The head of the version this key is paired against: a first pull takes
    // whatever the far end has got to, which earlier tests here have moved on.
    expect(planned.remote.revision).toBe(server.head);
    expect(planned.remote.role).toBe("designer");
    expect(kept).toHaveLength(1);
    // ...and what came back really is the project.
    const plan = await planPull(target, planned.bytes, undefined);
    expect(plan.added).toBeGreaterThan(0);
    expect(Object.keys(plan.base).length).toBe(plan.added);
  });
});

// --- fixtures ----------------------------------------------------------------

/** The project shard, which is where the story's own properties live. */
function findProject(dir: string): { path: string; text: string } {
  const loaded = loadProject(dir);
  const path = join(dir, loaded.source!.path);
  return { path, text: readFileSync(path, "utf8") };
}

/** The same project shard with its story properties the other way round: a
 *  difference of ORDER and nothing else, which the format keeps (it sorts lists
 *  keyed by id, and these are keyed by name) and the merge does not. */
function reorderProperties(text: string): string {
  const shard = parseSource(text) as { story: { properties: unknown[] } };
  return canonicalStringify({
    ...shard,
    story: { ...shard.story, properties: [...shard.story.properties].reverse() },
  });
}

/** An installation contract in a project, which is a file in `contracts/` at
 *  the root and the one shard the venue writes whole. */
function contract(dir: string, what: { revision: number; hands: string[] }): { path: string; text: string } {
  const path = join(dir, "contracts", "the-park.storyletcontract");
  const text = canonicalStringify({
    schema: "storylets/contract@0",
    installation: "the-park",
    by: "Storylet Server 0.1.0",
    revision: what.revision,
    hands: what.hands,
  });
  mkdirSync(join(dir, "contracts"), { recursive: true });
  writeFileSync(path, text, "utf8");
  return { path, text };
}

/** The first deck shard in a project, with a title we can edit on both sides. */
function findDeck(dir: string): { path: string; rel: string; text: string; title: string } {
  const loaded = loadProject(dir);
  const source = loaded.source!;
  const deck = source.boxes[0]!.decks[0]!;
  const path = join(dir, deck.path);
  const text = readFileSync(path, "utf8");
  const title = deck.shard.cards[0]!.title!;
  return { path, rel: deck.path, text, title };
}

/** The first box shard, likewise. `path` on a box is its FOLDER, so the shard
 *  is found in it by extension. */
function findBox(dir: string): { path: string; text: string; title: string } {
  const loaded = loadProject(dir);
  const box = loaded.source!.boxes[0]!;
  const folder = join(dir, box.path);
  const name = readdirSync(folder).find((f) => f.endsWith(".storyletbox"))!;
  const path = join(folder, name);
  return { path, text: readFileSync(path, "utf8"), title: box.box.box.title ?? box.box.box.id };
}
