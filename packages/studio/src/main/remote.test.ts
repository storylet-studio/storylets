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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// JSZip only to SEAL a pack the fake sends, which is the one thing the public
// pack op does not do (the record is the far end's file, added on the way out).
// The pack itself is still `runPack`'s.
import JSZip from "jszip";
import { loadProject, runPack } from "@storylet-studio/ops";
import { openProject } from "./project.js";
import { commit, forgetLastCounted, saveBox, saveCard } from "./mutate.js";
import {
  PULL_AS_DESIGNER, REMOTE_FILE, addressOf, clearEdits, countEdit, failed, isShapeShard,
  menuState, normaliseAddress, openPackBytes, pair, packProject, planPull, pullPack, pushPack,
  readRemote, refuseWrite, remoteInPack, resolveLeave, statusLine, writeRemote,
} from "./remote.js";
import type { RemoteRecord } from "./remote.js";

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
}

/** The fake. One installation, one version, a list of revisions. */
class FakeServer {
  readonly revisions: Buffer[] = [];
  readonly pushes: PushRecord[] = [];
  /** Set to refuse the next push with this, whatever it carries. */
  refuseNext?: { status: number; code: string; message: string; details?: unknown };
  /** Seal the packs it sends with the record a real one carries. */
  sealed = false;
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
      this.pushes.push({
        installation: body["installation"] as string | undefined,
        version: body["version"] as string | undefined,
        base: body["base"] as number | undefined,
        pack, role,
      });
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
      revision: pulled.revision, role: pulled.role, edits: 0,
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
    expect(menuState(undefined, true)).toBeUndefined();
    expect(menuState(remote, false)).toBeUndefined();
    expect(menuState(remote, true)).toEqual({ status: "In sync" });
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
    const merged = plan.writes.find((w) => w.path === deck.path)!;
    expect(merged.content).toContain("Our title");
    expect(JSON.parse(plan.sidecars[0]!.content).conflicts).toHaveLength(1);
  });

  it("leaves a local edit alone when we are already level with the head", async () => {
    const mine = copyExample("pull-level");
    const deck = findDeck(mine);
    writeFileSync(deck.path, deck.text.replace(deck.title, "Only mine"), "utf8");
    // The head IS the ancestor, so there is nothing of theirs to take.
    const plan = await planPull(mine, server.revisions[0]!, server.revisions[0]!);
    expect(plan.conflicts).toBe(0);
    expect(plan.writes.find((w) => w.path === deck.path)!.content).toContain("Only mine");
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

describe("the role, in the editor", () => {
  it("reads the shape shards off the writer's list", () => {
    expect(isShapeShard("a.storyletbox")).toBe(true);
    expect(isShapeShard("a.storylettags")).toBe(true);
    expect(isShapeShard("a.storylethands")).toBe(true);
    expect(isShapeShard("a.storyletproj")).toBe(true);
    expect(isShapeShard("a.storyletview")).toBe(true);
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

  it("stops the write itself, not only the controls", () => {
    const dir = copyExample("role");
    const opened = openProject(dir);
    expect("error" in opened).toBe(false);
    if ("error" in opened) return;
    const session = opened.session;
    const remote: RemoteRecord = {
      schema: "storylets/server-provenance@0", server: "http://x", installation: "the-park",
      version: "seed", revision: 1, role: "author", edits: 0,
    };
    writeRemote(dir, remote);
    forgetLastCounted();

    const box = session.dto.boxes[0]!;
    const refused = saveBox(session, box.id, { purpose: "an author reaching at the shape" });
    expect(refused).toEqual({ error: PULL_AS_DESIGNER });

    // The same edit under a designer's key lands.
    writeRemote(dir, { ...remote, role: "designer" });
    const allowed = saveBox(session, box.id, { purpose: "a designer changing the shape" });
    expect("error" in allowed).toBe(false);
  });
});

describe("unpushed edits", () => {
  it("counts a shard write and clears on a push", () => {
    const dir = copyExample("edits");
    const opened = openProject(dir);
    if ("error" in opened) throw new Error(opened.error);
    const session = opened.session;
    writeRemote(dir, {
      schema: "storylets/server-provenance@0", server: "http://x", installation: "the-park",
      version: "seed", revision: 1, role: "designer", edits: 0,
    });
    forgetLastCounted();
    expect(readRemote(dir)!.edits).toBe(0);

    const box = session.dto.boxes[0]!;
    const deck = box.decks[0]!;
    const card = deck.cards[0]!;
    const saved = saveCard(session, deck.id, card.id, { title: "An edited title" });
    expect("error" in saved).toBe(false);
    expect(readRemote(dir)!.edits).toBe(1);
    expect(statusLine({ revision: 1, edits: readRemote(dir)!.edits ?? 0 })).toBe("1 edit unpushed");

    // A second edit to the SAME card is the same logical edit, as it is for undo.
    saveCard(session, deck.id, card.id, { title: "An edited title again" });
    expect(readRemote(dir)!.edits).toBe(1);
    // A different one is not.
    commit(session, "test", "struct:1", [{ path: join(dir, "extra.storyletnotes"), content: "{schema:'storylets/notes@0'}\n" }]);
    expect(readRemote(dir)!.edits).toBe(2);

    clearEdits(dir, 4);
    expect(readRemote(dir)!.edits).toBe(0);
    expect(readRemote(dir)!.revision).toBe(4);
    expect(statusLine({ revision: 4, edits: 0 })).toBe("In sync");
  });

  it("counts nothing at all for a project with no remote", () => {
    const dir = copyExample("no-remote");
    countEdit(dir);
    expect(readRemote(dir)).toBeUndefined();
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
});

// --- fixtures ----------------------------------------------------------------

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
