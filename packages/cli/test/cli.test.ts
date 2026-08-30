// ---------------------------------------------------------------------------
// Drives the CLI through run() (no subprocess): usage errors, then the full
// lifecycle in a temp dir - init, validate, deal, export, staleness, format -
// and asks against the saltmarsh example (claims visible via peek).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/main.js";

const exampleDir = fileURLToPath(new URL("../../../examples/saltmarsh.storylets", import.meta.url));

interface Capture {
  out: string[];
  err: string[];
  io: { log: (l: string) => void; error: (l: string) => void };
}
const capture = (): Capture => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { log: (l) => out.push(l), error: (l) => err.push(l) } };
};
const call = async (...argv: string[]): Promise<Capture & { code: number }> => {
  const c = capture();
  const code = await run(argv, c.io);
  return { ...c, code };
};

describe("usage", () => {
  it("no command prints usage and exits 2", async () => {
    const r = (await call());
    expect(r.code).toBe(2);
    expect(r.out.join("\n")).toContain("Usage:");
  });

  it("help exits 0", async () => {
    expect((await call("help")).code).toBe(0);
  });

  it("unknown command exits 2", async () => {
    expect((await call("frobnicate")).code).toBe(2);
  });

  it("unknown flag exits 2", async () => {
    expect((await call("validate", "--frob")).code).toBe(2);
  });

  it("peek without a box exits 2", async () => {
    expect((await call("peek")).code).toBe(2);
  });

  it("new without 'box' exits 2, as does an unknown kit", async () => {
    expect((await call("new")).code).toBe(2);
    expect((await call("new", "deck")).code).toBe(2);
    expect((await call("new", "box", ".", "--kit", "space-opera")).code).toBe(2);
  });

  it("deal without a hand exits 2", async () => {
    expect((await call("deal")).code).toBe(2);
  });
});

describe("lifecycle: init -> draw -> export -> validate -> format", () => {
  const tmp = mkdtempSync(join(tmpdir(), "storyletengine-"));
  const dir = join(tmp, "demo.storylets");

  it("init scaffolds a project", async () => {
    const r = (await call("init", join(tmp, "demo"), "--name", "Demo"));
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, "demo.storyletproj"))).toBe(true);
    expect(existsSync(join(dir, ".gitattributes"))).toBe(true);
    expect(existsSync(join(dir, ".vscode", "settings.json"))).toBe(true);
  });

  it("re-init refuses to overwrite", async () => {
    const r = (await call("init", join(tmp, "demo")));
    expect(r.code).toBe(1);
    expect(r.err.join()).toContain("already exists");
  });

  it("the fresh scaffold validates clean (and canonical)", async () => {
    const r = (await call("validate", dir));
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
  });

  it("new box scaffolds a blank box that validates clean; a second dedupes", async () => {
    const r = (await call("new", "box", dir));
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, "new-box", "box.storyletbox"))).toBe(true);
    expect(existsSync(join(dir, "new-box", "tags.storylettags"))).toBe(true);
    expect(existsSync(join(dir, "new-box", "hands.storylethands"))).toBe(true);
    expect((await call("validate", dir)).code).toBe(0);
    const second = (await call("new", "box", dir));
    expect(second.code).toBe(0);
    expect(existsSync(join(dir, "new-box-2", "box.storyletbox"))).toBe(true);
  });

  it("new box --kit rpg lands the narrated starter, valid and dealable", async () => {
    const r = (await call("new", "box", dir, "--kit", "rpg"));
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    const hands = readFileSync(join(dir, "new-box-3", "hands.storylethands"), "utf8");
    expect(hands).toContain('gameId: "encounters-at"');
    expect(hands).toContain('title: "Tavern encounters"');
    expect((await call("validate", dir)).code).toBe(0);
    // The kit's hand deals its sample card straight away (deal by name).
    const dealt = (await call("deal", "tavern-encounters", dir));
    expect(dealt.code).toBe(0);
    expect(dealt.out.join("\n")).toContain("a-strangers-wager");
  });

  it("the starter hand deals the welcome card", async () => {
    const r = (await call("deal", "whats-next", dir));
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toContain("welcome");
    expect(r.out.join("\n")).not.toContain("what-now");   // gated until started
    const started = (await call("deal", "whats-next", dir, "--set", "story.started=true"));
    expect(started.out.join("\n")).toContain("what-now");
  });

  it("export writes the bundle; validate stays clean", async () => {
    expect((await call("export", dir)).code).toBe(0);
    expect(existsSync(join(dir, "dist", "demo.storyletsc"))).toBe(true);
    expect((await call("validate", dir)).code).toBe(0);
  });

  // The geometry opt-in, end to end: a project with a drawn map, exported both
  // ways. The picture has to land BESIDE the bundle at the path the bundle
  // names, which is the half a unit test of the op cannot see.
  it("export --map carries the map and writes its pictures beside the bundle", async () => {
    const tags = join(dir, "new-box", "tags.storylettags");
    writeFileSync(tags, JSON.stringify({
      schema: "storylets/tags@0",
      groups: [{
        id: "d_zone", gameId: "zone",
        tags: [{ id: "v_yard", gameId: "yard", templates: { spatial: { polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }] } } }],
        templates: { spatial: { map: true, backgrounds: [{ id: "g_1", file: "plan.png", x: 0, y: 0, width: 8, height: 8 }] } },
      }],
    }));
    mkdirSync(join(dir, "new-box", "assets"), { recursive: true });
    writeFileSync(join(dir, "new-box", "assets", "plan.png"), Buffer.from("89504e470d0a1a0a", "hex"));

    const off = (await call("export", dir));
    expect(off.code).toBe(0);
    const bundlePath = join(dir, "dist", "demo.storyletsc");
    expect(JSON.parse(readFileSync(bundlePath, "utf8")).maps).toBeUndefined();
    expect(existsSync(join(dir, "dist", "assets"))).toBe(false);

    const on = (await call("export", dir, "--map"));
    expect(on.err).toEqual([]);
    expect(on.code).toBe(0);
    expect(on.out.join("\n")).toContain("1 map picture(s)");
    const maps = JSON.parse(readFileSync(bundlePath, "utf8")).maps;
    expect(maps[0].group).toBe("zone");
    expect(maps[0].backgrounds[0].file).toBe("assets/new-box/plan.png");
    expect(existsSync(join(dir, "dist", "assets", "new-box", "plan.png"))).toBe(true);

    // Put the project back the way the rest of this lifecycle expects it.
    (await call("export", dir));
  });

  it("editing a shard trips the staleness gate; export clears it", async () => {
    const deckPath = join(dir, "main", "decks", "starter.storyletdeck");
    const edited = readFileSync(deckPath, "utf8").replace("priority: 1,", "priority: 5,");
    expect(edited).not.toBe(readFileSync(deckPath, "utf8"));   // the edit must actually land
    writeFileSync(deckPath, edited);
    const stale = (await call("validate", dir));
    expect(stale.code).toBe(1);
    expect(stale.err.join()).toContain("stale");
    expect((await call("export", dir)).code).toBe(0);
    expect((await call("validate", dir)).code).toBe(0);
  });

  it("format --check flags drift, format fixes it", async () => {
    const boxPath = join(dir, "main", "box.storyletbox");
    const canonical = readFileSync(boxPath, "utf8");
    writeFileSync(boxPath, canonical.replace(/\n/g, "\n\n"));   // still JSON5, no longer canonical
    expect((await call("format", dir, "--check")).code).toBe(1);
    expect((await call("format", dir)).code).toBe(0);
    expect(readFileSync(boxPath, "utf8")).toBe(canonical);
    expect((await call("format", dir, "--check")).code).toBe(0);
  });
});

describe("merge: the git-driver flow", () => {
  const tmp = mkdtempSync(join(tmpdir(), "storyletengine-merge-"));
  // A deck shard in three versions: BASE, OURS (title edit + a new card),
  // THEIRS (condition edit on the same card).
  const deckShard = (cards: string): string => `{
  schema: "storylets/deck@0",
  deck: { id: "k_1", gameId: "main", properties: [] },
  cards: [${cards}],
}
`;
  const cardSrc = (id: string, extra = ""): string =>
    `{ id: "${id}", gameId: "${id.slice(2)}", priority: 0, redraw: "always", outcomes: []${extra} }`;

  const basePath = join(tmp, "base.storyletdeck");
  const oursPath = join(tmp, "ours.storyletdeck");
  const theirsPath = join(tmp, "theirs.storyletdeck");

  it("a clean structured merge writes canonical output, exit 0", async () => {
    writeFileSync(basePath, deckShard(cardSrc("c_1", ', title: "Old"')));
    writeFileSync(oursPath, deckShard(`${cardSrc("c_1", ', title: "New"')}, ${cardSrc("c_2")}`));
    writeFileSync(theirsPath, deckShard(cardSrc("c_1", ', title: "Old", condition: "@story.go"')));
    const r = (await call("merge", basePath, oursPath, theirsPath, "-o", oursPath));
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    const merged = readFileSync(oursPath, "utf8");
    expect(merged).toContain('title: "New"');
    expect(merged).toContain('condition: "@story.go"');
    expect(merged).toContain('id: "c_2"');
    expect(existsSync(`${oursPath}.storyletconflict`)).toBe(false);
  });

  it("a conflicted merge keeps OURS, writes the sidecar, exit 1", async () => {
    writeFileSync(basePath, deckShard(cardSrc("c_1", ", priority: 0")));
    writeFileSync(oursPath, deckShard(cardSrc("c_1", ", priority: 5")));
    writeFileSync(theirsPath, deckShard(cardSrc("c_1", ", priority: 9")));
    const r = (await call("merge", basePath, oursPath, theirsPath, "-o", oursPath));
    expect(r.code).toBe(1);
    expect(readFileSync(oursPath, "utf8")).toContain("priority: 5");
    const sidecar = JSON.parse(readFileSync(`${oursPath}.storyletconflict`, "utf8"));
    expect(sidecar.conflicts).toHaveLength(1);
    expect(sidecar.conflicts[0]).toMatchObject({ id: "c_1", kind: "both-changed", ours: 5, theirs: 9 });
  });

  it("a lingering sidecar blocks validate until resolved", async () => {
    // Plant the conflicted state inside a real project.
    const projTmp = mkdtempSync(join(tmpdir(), "storyletengine-sidecar-"));
    expect((await call("init", join(projTmp, "demo"))).code).toBe(0);
    const dir = join(projTmp, "demo.storylets");
    const sidecar = join(dir, "main", "decks", "starter.storyletdeck.storyletconflict");
    writeFileSync(sidecar, '{ "type": "deck", "conflicts": [], "warnings": [] }\n');
    const blocked = (await call("validate", dir));
    expect(blocked.code).toBe(1);
    expect(blocked.err.join()).toContain("unresolved merge sidecar");
    // Resolving = deleting the sidecar; a clean re-merge would do the same.
    rmSync(sidecar);
    expect((await call("validate", dir)).code).toBe(0);
  });

  it("schema version skew exits 2 (the VCS falls back)", async () => {
    writeFileSync(basePath, deckShard(cardSrc("c_1")).replace("deck@0", "deck@1"));
    writeFileSync(oursPath, deckShard(cardSrc("c_1")));
    writeFileSync(theirsPath, deckShard(cardSrc("c_1")));
    const r = (await call("merge", basePath, oursPath, theirsPath, "-o", oursPath));
    expect(r.code).toBe(2);
    expect(r.err.join()).toContain("skew");
  });

  it("unparseable input exits 2", async () => {
    writeFileSync(basePath, "not json5 {{{");
    const r = (await call("merge", basePath, oursPath, theirsPath, "-o", oursPath));
    expect(r.code).toBe(2);
  });
});

describe("asks against the saltmarsh example", () => {
  it("peeks the docks stock, ranked", async () => {
    const r = (await call("peek", "encounters", exampleDir,
      "--where", "area=docks", "--set", "value.v_docks.danger=3"));
    expect(r.code).toBe(0);
    expect(r.out).toEqual([
      '1. ambush-at-the-ford  "Ambush at the ford"',
      '2. rat-job  "A rat job"',
      '3. mysterious-stranger  "The mysterious stranger"',
    ]);
  });

  it("deal refreshes the hand; --deal-all makes claims visible to a peek", async () => {
    const dealt = (await call("deal", "docks-street", exampleDir, "--set", "value.v_docks.danger=3"));
    expect(dealt.code).toBe(0);
    // Two slots, by priority: the ambush (p2) and the rat job (p1).
    expect(dealt.out).toEqual([
      '1. ambush-at-the-ford  "Ambush at the ford"',
      '2. rat-job  "A rat job"',
    ]);
    // --set applies before --deal-all, so the hand seats the same two; the
    // peek respects the claims and only the stranger is left.
    const r = (await call("peek", "encounters", exampleDir,
      "--where", "area=docks", "--set", "value.v_docks.danger=3", "--deal-all"));
    expect(r.code).toBe(0);
    expect(r.out).toEqual(['1. mysterious-stranger  "The mysterious stranger"']);
  });

  it("an unknown hand reports and exits 1", async () => {
    const r = (await call("deal", "no-such-hand", exampleDir));
    expect(r.code).toBe(1);
    expect(r.err.join()).toContain("no-such-hand");
  });
});

describe("coverage against the saltmarsh example", () => {
  it("finds the ambush gap (a chicken-and-egg gate) and reports per hand", async () => {
    const r = (await call("coverage", exampleDir, "--runs", "15", "--max-turns", "20", "--seed", "1"));
    expect(r.code).toBe(0);   // gaps report, but only --fail-on-gap gates
    const out = r.out.join("\n");
    // The ambush needs @hand.danger >= 2, and only its own outcome lowers
    // danger - nothing raises it, so it is honestly never dealt.
    expect(out).toContain("never dealt: ambush-at-the-ford");
    expect(out).toMatch(/hand docks-street: held 2\/4 cards/);
  });

  it("--fail-on-gap turns the gap into an exit code for CI", async () => {
    const r = (await call("coverage", exampleDir, "--runs", "5", "--max-turns", "10", "--fail-on-gap"));
    expect(r.code).toBe(1);
  });

  it("--propose prints a coverage block", async () => {
    const r = (await call("coverage", exampleDir, "--propose"));
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toContain("coverage:");
  });
});

describe("pack / unpack: the send envelope", () => {
  const tmp = mkdtempSync(join(tmpdir(), "storyletengine-pack-"));
  const packFile = join(tmp, "sent.storyletpack");

  it("packs a project into one file", async () => {
    const r = (await call("pack", exampleDir, "-o", packFile));
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toContain(`packed ${packFile}`);
    expect(existsSync(packFile)).toBe(true);
    // A zip, so it opens with anything: the local-file-header magic.
    expect(readFileSync(packFile).subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("needs -o, and says so rather than guessing a filename", async () => {
    const r = (await call("pack", exampleDir));
    expect(r.code).toBe(2);
    expect(r.err.join("\n")).toContain("usage: pack");
  });

  // The handler read these from the day they were designed and the flag spec
  // never declared them, so every use was an "unknown flag" and the override
  // was unreachable. Pinned so it cannot go quiet again.
  it("takes --assets and --no-assets", async () => {
    for (const flag of ["--assets", "--no-assets"]) {
      const r = (await call("pack", exampleDir, "-o", join(tmp, `flag${flag}.storyletpack`), flag));
      expect(r.err.join("\n")).not.toContain("unknown flag");
      expect(r.code).toBe(0);
    }
  });

  it("refuses a directory that is not a project", async () => {
    const r = (await call("pack", tmpdir(), "-o", join(tmp, "nope.storyletpack")));
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("not a storylets project");
  });

  it("unpacks into a directory that then validates", async () => {
    const target = join(tmp, "received");
    const r = (await call("unpack", packFile, "-o", target));
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toContain("shard(s) ->");
    expect(existsSync(join(target, "saltmarsh.storyletproj"))).toBe(true);
    // The real proof that the envelope is lossless: the round trip is a
    // project the validator accepts, not just a pile of files.
    expect((await call("validate", target)).code).toBe(0);
  });

  it("unpack needs both a file and -o", async () => {
    expect((await call("unpack")).code).toBe(2);
    expect((await call("unpack", packFile)).code).toBe(2);
  });

  it("reports a missing pack rather than throwing", async () => {
    const r = (await call("unpack", join(tmp, "absent.storyletpack"), "-o", join(tmp, "out")));
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("cannot read");
  });

  it("merges a returned pack back into the project", async () => {
    // The whole round trip through the CLI: pack, someone edits their copy,
    // they pack it back, we merge it in against the pack we sent.
    const project = join(tmp, "ours");
    expect((await call("unpack", packFile, "-o", project)).code).toBe(0);

    const theirs = join(tmp, "theirs");
    expect((await call("unpack", packFile, "-o", theirs)).code).toBe(0);
    const theirDeck = join(theirs, "encounters", "decks", "docks.storyletdeck");
    writeFileSync(theirDeck, readFileSync(theirDeck, "utf8").replace('gameId: "rat-job"', 'gameId: "dock-work"'));
    const returned = join(tmp, "returned.storyletpack");
    expect((await call("pack", theirs, "-o", returned)).code).toBe(0);

    const r = (await call("unpack", returned, "-o", project, "--merge", "--base", packFile));
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toMatch(/merged: encounters\/decks\/docks\.storyletdeck/);
    expect(r.out.join("\n")).toContain("0 conflict(s)");
    expect(readFileSync(join(project, "encounters", "decks", "docks.storyletdeck"), "utf8")).toContain("dock-work");
    expect((await call("validate", project)).code).toBe(0);
  });

  it("--merge without --base is a usage error, not a two-way guess", async () => {
    // Without the pack we sent there is no common ancestor, and a two-way
    // merge would silently overwrite rather than merge.
    const r = (await call("unpack", packFile, "-o", join(tmp, "ours"), "--merge"));
    expect(r.code).toBe(2);
    expect(r.err.join("\n")).toContain("--base");
  });

  it("exits 1 when the returned pack conflicts with our own edit", async () => {
    const project = join(tmp, "conflict-ours");
    expect((await call("unpack", packFile, "-o", project)).code).toBe(0);
    const theirs = join(tmp, "conflict-theirs");
    expect((await call("unpack", packFile, "-o", theirs)).code).toBe(0);

    const relDeck = join("encounters", "decks", "docks.storyletdeck");
    const edit = (dir: string, to: string): void => {
      const p = join(dir, relDeck);
      writeFileSync(p, readFileSync(p, "utf8").replace('title: "A rat job"', `title: "${to}"`));
    };
    edit(theirs, "Their title");
    edit(project, "Our title");
    const returned = join(tmp, "conflict-returned.storyletpack");
    expect((await call("pack", theirs, "-o", returned)).code).toBe(0);

    const r = (await call("unpack", returned, "-o", project, "--merge", "--base", packFile));
    expect(r.code).toBe(1);
    expect(r.out.join("\n")).toMatch(/conflict\(s\)/);
    expect(existsSync(join(project, `${relDeck}.storyletconflict`))).toBe(true);
  });

  it("advertises pack and unpack in the usage text", async () => {
    // The help has lied before: every flag named here is one the parser takes.
    const usage = (await call("help")).out.join("\n");
    expect(usage).toContain("storyletengine pack");
    expect(usage).toContain("storyletengine unpack");
    expect((await call("pack", exampleDir, "-o", join(tmp, "flagcheck.storyletpack"))).code).toBe(0);
    expect((await call("unpack", packFile, "-o", join(tmp, "flagcheck"), "--merge", "--base", packFile)).code).not.toBe(2);
  });
});

describe("links: the influence graph", () => {
  it("prints the graph with a class summary", async () => {
    const r = (await call("links", exampleDir));
    expect(r.code).toBe(0);
    const out = r.out.join("\n");
    expect(out).toMatch(/^links: 4 card\(s\), \d+ edge\(s\) - \d+ enable/m);
    expect(out).toMatch(/enable|disable/);
  });

  it("names the writing outcome, so an enable and a disable between one pair read as sense", async () => {
    // The ambush raises reputation on one outcome and lowers it on another, so
    // both edges are correct; without the outcome named it looks like a bug.
    const out = (await call("links", exampleDir)).out.join("\n");
    expect(out).toContain("by stand-and-fight");
    expect(out).toContain("by flee");
  });

  it("scopes to one deck, and a deck whose influence is all outward shows none", async () => {
    // The docks deck holds 2 of saltmarsh's 4 cards, and every edge it takes
    // part in crosses into the market deck. So a deck-scoped analysis of it is
    // legitimately EMPTY - the narrowing that keeps a node canvas readable can
    // also hide everything, which is a real tension recorded in
    // design/graphical-views.md rather than a bug here.
    const r = (await call("links", exampleDir, "--deck", "docks"));
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toMatch(/^links: 2 card\(s\), 0 edge\(s\)/m);
    // Whole-project, the same cards are busy.
    expect((await call("links", exampleDir)).out.join("\n")).toMatch(/^links: 4 card\(s\), [1-9]/m);
  });

  it("warns about @hand rather than guessing at it", async () => {
    // The caveat has to say what is MISSING, not merely mention @hand: it is read
    // by authors in the Links window as well as at the CLI.
    const err = (await call("links", exampleDir)).err.join("\n");
    expect(err).toContain("Links through @hand are not included");
  });

  it("--json gives the whole graph", async () => {
    const r = (await call("links", exampleDir, "--json"));
    expect(r.code).toBe(0);
    const graph = JSON.parse(r.out.join("\n"));
    expect(graph.nodes.length).toBe(4);
    expect(graph.countsByClass).toHaveProperty("enable");
    expect(graph.edges[0].via[0]).toHaveProperty("property");
  });

  it("rejects an unknown flag rather than ignoring it", async () => {
    expect((await call("links", exampleDir, "--frobnicate")).code).toBe(2);
  });
});

describe("resolve: the --at lookup from the terminal", () => {
  it("prints where a gameId lives: id, kind, title, gameId, trail, shard", async () => {
    const r = (await call("resolve", "ambush-at-the-ford", exampleDir));
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(1);
    expect(r.out[0]).toMatch(/^\S+  \[card\]  "Ambush at the ford"  ambush-at-the-ford  Encounters > Docks  \(encounters\/decks\/docks\.storyletdeck\)$/);
  });

  it("names hand templates and tag groups in product words", async () => {
    expect((await call("resolve", "docks-street", exampleDir)).out[0]).toContain("[hand]");
    expect((await call("resolve", "street-hands", exampleDir)).out[0]).toContain("[hand template]");
  });

  it("a partial match lists every hit, one per line", async () => {
    const r = (await call("resolve", "ambush", exampleDir));
    expect(r.code).toBe(0);
    expect(r.out.length).toBeGreaterThanOrEqual(1);
    for (const line of r.out) expect(line.toLowerCase()).toContain("ambush");
  });

  it("no match says so on stderr and exits 1", async () => {
    const r = (await call("resolve", "no_such_thing_xyz", exampleDir));
    expect(r.code).toBe(1);
    expect(r.err).toEqual(["no match for 'no_such_thing_xyz'"]);
  });

  it("no query is a usage error", async () => {
    expect((await call("resolve")).code).toBe(2);
  });
});

describe("export-html: the playable page", () => {
  const villageDir = fileURLToPath(new URL("../../../examples/the-hamlet.storylets", import.meta.url));

  it("writes one self-contained page to -o and reports its size", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "html-")), "The Hamlet.html");
    const r = await call("export-html", villageDir, "-o", out);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    const html = readFileSync(out, "utf8");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>The Hamlet</title>");
    expect(html).toContain("window.STORYLET_BUNDLE=");
    // The SVG namespace IDENTIFIER (the map renderer) is not a request.
    expect(html.replaceAll("http://www.w3.org/2000/svg", "")).not.toMatch(/\bsrc=|href=|https?:\/\//);
    expect(r.out).toHaveLength(1);
    expect(r.out[0]).toMatch(/^wrote .*The Hamlet\.html \(\d+ KB\)$/);
  });

  it("-o - streams the page to stdout", async () => {
    const r = await call("export-html", villageDir, "-o", "-");
    expect(r.code).toBe(0);
    expect(r.out.join("\n").startsWith("<!doctype html>")).toBe(true);
  });

  it("a folder with no project is exit 1 with the load issue", async () => {
    const r = await call("export-html", mkdtempSync(join(tmpdir(), "noproj-")), "-o", "x.html");
    expect(r.code).toBe(1);
    expect(r.err[0]).toContain("no .storylets project");
  });
});

describe("export-xlsx: the readable workbook", () => {
  const villageDir = fileURLToPath(new URL("../../../examples/the-hamlet.storylets", import.meta.url));

  it("writes the workbook to -o and reports what it holds", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "xlsx-")), "The Hamlet.xlsx");
    const r = await call("export-xlsx", villageDir, "-o", out);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(existsSync(out)).toBe(true);
    // An .xlsx is a zip: the local file header signature.
    expect(readFileSync(out).subarray(0, 2).toString("latin1")).toBe("PK");
    expect(r.out).toHaveLength(1);
    expect(r.out[0]).toMatch(/^wrote .*The Hamlet\.xlsx: \d+ card\(s\) on 5 deck sheet\(s\), \d+ outcome\(s\), 3 hand\(s\), 1 tag group\(s\)$/);
  });

  it("-o is required", async () => {
    const r = await call("export-xlsx", villageDir);
    expect(r.code).toBe(2);
    expect(r.err[0]).toContain("-o <file.xlsx>");
  });

  it("a folder with no project is exit 1 with the load issue", async () => {
    const r = await call("export-xlsx", mkdtempSync(join(tmpdir(), "noproj-")), "-o", "x.xlsx");
    expect(r.code).toBe(1);
    expect(r.err[0]).toContain("no .storylets project");
  });
});

describe("every loading command reports the project's issues", () => {
  // The convention, made a test 2026-08-29. Most commands printed
  // `loaded.issues` unconditionally and four did not: `new box` only inside
  // its catch, `export-xlsx` and `resolve` only when the project failed to
  // load at all, and `pack` never - so an author scaffolding a box or sending
  // a pack was told nothing about a project that already had warnings, and
  // learned about them next time they happened to run validate.
  //
  // Driven through a project with a REAL warning rather than a mocked one, so
  // the test breaks if the warning stops being produced as well as if a
  // command stops reporting it.

  /** A copy of the example with a stray file inside a box folder: parse
   *  reports it as a WARNING and ignores it, so the project still loads and
   *  every command still succeeds. The only thing under test is whether each
   *  one said so.
   *
   *  A load issue specifically, not a validate one: `loaded.issues` is what
   *  every command has in hand without doing extra work, which is why the
   *  convention is about those. */
  const withWarning = (): string => {
    const dir = join(mkdtempSync(join(tmpdir(), "storyletengine-issues-")), "copy.storylets");
    cpSync(exampleDir, dir, { recursive: true });
    // A deck shard at the box ROOT rather than in decks/: the loader ignores
    // it and warns. A .txt would not do - the walker only collects shard
    // extensions, so it never reaches the parser and produces no issue.
    writeFileSync(join(dir, "encounters", "stray.storyletdeck"), "{}\n");
    return dir;
  };

  it("validate reports it (the baseline: the warning is real)", async () => {
    const r = await call("validate", withWarning());
    expect(r.err.join("\n")).toMatch(/unrecognised file/i);
  });

  for (const [name, argv] of [
    ["new box", (d: string) => ["new", "box", d]],
    ["resolve", (d: string) => ["resolve", "docks", d]],
    ["pack", (d: string) => ["pack", d, "-o", join(d, "out.storyletpack")]],
  ] as [string, (d: string) => string[]][]) {
    it(`${name} reports it too`, async () => {
      const dir = withWarning();
      const r = await call(...argv(dir));
      expect(r.err.join("\n"), `${name} said nothing about a project with a warning`)
        .toMatch(/unrecognised file/i);
    });
  }
});

// --- `--version` ------------------------------------------------------------
// The number is inlined from package.json at build time, so the risk is not that
// it drifts but that the wiring quietly stops working: a bundler that fails to
// inline the JSON, or a dispatch change that swallows the flag, both turn this
// into "unknown command" without anything else noticing. The release asset is
// named from the TAG and the manifest is what the tag is checked against, so a
// binary that disagrees with its own filename is the failure worth preventing.
describe("--version", () => {
  it("prints the manifest version, on all three spellings", async () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { version: string };
    for (const spelling of ["--version", "-v", "version"]) {
      const out: string[] = [];
      const code = await run([spelling], { log: (m) => out.push(String(m)), error: () => {} });
      expect(code, `"${spelling}" should exit 0`).toBe(0);
      expect(out.join("\n").trim(), `"${spelling}" should print the manifest version`)
        .toBe(manifest.version);
    }
  });

  it("is discoverable from the usage text", async () => {
    const out: string[] = [];
    await run(["--help"], { log: (m) => out.push(String(m)), error: () => {} });
    expect(out.join("\n")).toContain("--version");
  });
});
