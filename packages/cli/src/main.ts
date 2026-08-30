// ---------------------------------------------------------------------------
// `storyletengine` CLI - argv parsing, output, and exit codes ONLY
// (importable, so the parser and exit mapping are testable). All the work
// lives in @storylet-studio/ops, the shared operations layer the editor and
// CI consume too.
//
// Flags are declared per command: a VALUED flag always consumes the next
// token, a BOOLEAN flag never does, a REPEATED flag collects every use, and
// an unknown flag is an error rather than a silent no-op. Exit codes:
// 0 ok, 1 the operation found problems / failed, 2 usage. (Patter's CLI
// conventions, carried whole.)
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeBinaryFile, writeTextFiles } from "@wildwinter/simple-vc-lib";
import {
  canonicalStringify, conflictSidecar, loadProject, parseFlagValue, parseSource,
  proposeCoverage, runAsk, runCoverage, runExport, runFormat, runInit, runMerge,
  runNewBox, runPack, runUnpack, runUnpackMerge, runValidate, analyseInfluence, describeContribution,
  CONFLICT_SIDECAR_EXTENSION, MergeInputError, PackError, UnsafeEntryError,
  runResolve, // resolve: the --at lookup from the terminal
  runExportXlsx, // export-xlsx: the readable workbook
  runExportHtml, bundleOutputPath, // export-html: the playable page
  BOX_KITS,                        // the one kit list; --kit validates from it
} from "@storylet-studio/ops";
import type { BoxKit, Issue, PlannedWrite } from "@storylet-studio/ops";

export const USAGE = `storyletengine - Storylet Engine CLI

Usage:
  storyletengine init [dir]           Scaffold a new .storylets project (starter box,
                 [--name X]           editor associations, git config)
  storyletengine new box [path]       Add a box to a project, scaffolded from a kit
                 [--kit blank|rpg|dialogue]         (default blank; the others are
                                      narrated starters, each teaching a chapter)
  storyletengine validate [path]      Validate a project: the publish gate, bundle
                                      staleness, canonical form
  storyletengine format [path]        Rewrite shards to canonical form (alias: fmt)
                 [--check]            Report what would change; write nothing (for CI)
  storyletengine export [path]        Compile to the .storyletsc bundle (the project's
                 [-o file]            declared path, or -o; -o - for stdout)
                 [--map|--no-map]     Carry the maps (zone shapes and background
                                      pictures), overriding the project setting
  storyletengine export-html [path]   One self-contained, playable .html (runtime,
                 [-o file]            board and bundle inlined; send it to anyone,
                                      opens in any browser; default: the bundle's
                                      path with .html; -o - for stdout)
  storyletengine export-xlsx [path]   The whole project as a readable .xlsx workbook
                 -o FILE              (a sheet per deck, plus Outcomes, Hands and
                                      Tag groups), for review and filtering
  storyletengine peek <box> [path]    Look at the stock through the reference runtime
                 [--where group=tag ...]  criteria, one per tag group
                 [--set path=value ...] [--seed N] [--n N] [--deal-all]
  storyletengine deal <hand> [path]   Refresh a hand through the reference runtime
                 [--set path=value ...] [--seed N] [--deal-all]
                 (--deal-all deals every hand first, so claims are visible)
  storyletengine resolve <query> [path]  Find an item by gameId, id or title: which
                                      box, deck and shard it lives in (the same
                                      lookup as Storyletter's --at)
  storyletengine pack [path] -o FILE   Pack a project into one portable
                 [--assets|--no-assets]  .storyletpack, to hand to someone with
                                      no shared version control (--assets carries
                                      the background pictures too)
  storyletengine unpack FILE -o DIR   Explode a .storyletpack into source shards
                 [--merge --base SENT.storyletpack]
                                      Fold a RETURNED pack back into the project
                                      at -o, merging by id against the pack you
                                      sent (which you keep)
  storyletengine merge BASE OURS THEIRS  3-way merge of storylets source by
                 [-o out] [--json]      immutable id; conflicts resolve to OURS
                 [--path realfile]      plus a .storyletconflict sidecar
                                        (--path: where the sidecar belongs when
                                        -o is a VCS temp file - git's %P)
  storyletengine links [path]         Which cards can turn which others on and
                 [--deck X | --box X | --card X]   off, from conditions and
                 [--refs] [--json]                 outcomes alone (no playthrough)
  storyletengine coverage [path]      Seeded random playthroughs: what can each
                 [--runs N] [--max-turns M] [--seed S]   hand deal, what never
                 [--json] [--fail-on-gap]                gets dealt or played?
                 [--propose]          Print an auto-proposed coverage block
                                      (drivers + arg domains) instead of running

Exit codes: 0 ok, 1 the operation found problems, 2 usage. "merge" alone also
maps a malformed INPUT to 2, so a version-control driver can tell "these three
files are not storylets source" from "the merge found conflicts" and fall back
to its own behaviour rather than trusting a guess.
`;

interface Io {
  log: (line: string) => void;
  error: (line: string) => void;
}

const FLAGS: Record<string, { boolean: string[]; valued: string[]; repeated: string[] }> = {
  init: { boolean: [], valued: ["name"], repeated: [] },
  new: { boolean: [], valued: ["kit"], repeated: [] },
  validate: { boolean: [], valued: [], repeated: [] },
  format: { boolean: ["check"], valued: [], repeated: [] },
  export: { boolean: ["map", "no-map"], valued: ["o"], repeated: [] },
  "export-html": { boolean: [], valued: ["o"], repeated: [] },   // the playable page
  "export-xlsx": { boolean: [], valued: ["o"], repeated: [] },   // the readable workbook
  peek: { boolean: ["deal-all"], valued: ["seed", "n"], repeated: ["where", "set"] },
  deal: { boolean: ["deal-all"], valued: ["seed"], repeated: ["set"] },
  resolve: { boolean: [], valued: [], repeated: [] },
  // --assets/--no-assets were read by the handler from the day they were
  // designed and never declared here, so every use of them was an "unknown
  // flag" and the override was unreachable. Declared now, with a test.
  pack: { boolean: ["assets", "no-assets"], valued: ["o"], repeated: [] },
  unpack: { boolean: ["merge"], valued: ["o", "base"], repeated: [] },
  merge: { boolean: ["json"], valued: ["o", "path"], repeated: [] },
  links: { boolean: ["json", "refs"], valued: ["deck", "box", "card"], repeated: [] },
  coverage: { boolean: ["json", "fail-on-gap", "propose"], valued: ["runs", "max-turns", "seed"], repeated: [] },
};

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
  repeats: Record<string, string[]>;
  /** Usage problems (unknown flag, missing value); non-empty means exit 2. */
  errors: string[];
}

export function parseArgs(command: string, args: string[]): ParsedArgs {
  const spec = FLAGS[command] ?? { boolean: [], valued: [], repeated: [] };
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const repeats: Record<string, string[]> = {};
  const errors: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    const name = token.replace(/^--?/, "");
    if (spec.boolean.includes(name)) {
      flags[name] = true;
    } else if (spec.valued.includes(name) || spec.repeated.includes(name)) {
      const value = args[++i];
      if (value === undefined) {
        errors.push(`flag --${name} needs a value`);
      } else if (spec.repeated.includes(name)) {
        repeats[name] = [...(repeats[name] ?? []), value];
      } else {
        flags[name] = value;
      }
    } else {
      errors.push(`unknown flag ${token}`);
    }
  }
  return { positionals, flags, repeats, errors };
}

/** Is this string one of the kits? A guard rather than a bare `includes`, so
 *  the value narrows to BoxKit for the call below and the list stays the only
 *  place a kit is named. */
const isBoxKit = (k: string): k is BoxKit => (BOX_KITS as readonly string[]).includes(k);

function printIssues(issues: Issue[], io: Io): void {
  for (const issue of issues) {
    const where = issue.where ? ` [${issue.where}]` : "";
    io.error(`${issue.severity}: ${issue.path}${where}: ${issue.message}`);
  }
}

function commitWrites(writes: PlannedWrite[], io: Io): boolean {
  const batch = writeTextFiles(writes.map((w) => ({ filePath: w.path, content: w.content })));
  const failures = batch.results.filter((r) => !r.success);
  for (const f of failures) io.error(`write failed [${f.status}]: ${f.message}`);
  return batch.success;
}

/** Write one binary artefact (a pack) through the VC layer, so a target that
 *  is under version control and read-only is checked out rather than refused. */
function commitBinary(path: string, bytes: Buffer, io: Io): boolean {
  const result = writeBinaryFile(path, bytes);
  if (!result.success) io.error(`write failed [${result.status}]: ${result.message}`);
  return result.success;
}

/** Parse repeated `k=v` flag values into a record. */
function pairs(values: string[], flag: string, errors: string[]): Record<string, ReturnType<typeof parseFlagValue>> {
  const out: Record<string, ReturnType<typeof parseFlagValue>> = {};
  for (const raw of values) {
    const eq = raw.indexOf("=");
    if (eq <= 0) {
      errors.push(`--${flag} expects k=v, got "${raw}"`);
      continue;
    }
    out[raw.slice(0, eq)] = parseFlagValue(raw.slice(eq + 1));
  }
  return out;
}

/** Run one CLI invocation. Returns the process exit code. */
export async function run(argv: string[], io: Io = { log: console.log, error: console.error }): Promise<number> {
  const [rawCommand, ...rest] = argv;
  const command = rawCommand === "fmt" ? "format" : rawCommand;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    io.log(USAGE);
    return command === undefined ? 2 : 0;
  }
  if (!(command in FLAGS)) {
    io.error(`unknown command "${command}"\n\n${USAGE}`);
    return 2;
  }
  const parsed = parseArgs(command, rest);
  if (parsed.errors.length > 0) {
    for (const e of parsed.errors) io.error(`usage: ${e}`);
    return 2;
  }
  const { positionals, flags, repeats } = parsed;

  switch (command) {
    case "init": {
      try {
        const result = runInit({
          dir: positionals[0] ?? ".",
          ...(typeof flags["name"] === "string" ? { name: flags["name"] } : {}),
        });
        if (!commitWrites(result.writes, io)) return 1;
        io.log(`initialised "${result.name}" in ${result.dir}`);
        io.log(`next: storyletengine export ${result.dir}`);
        return 0;
      } catch (e) {
        io.error(e instanceof Error ? e.message : String(e));
        return 1;
      }
    }
    case "new": {
      if (positionals[0] !== "box") {
        io.error(`usage: storyletengine new box [path] [--kit ${BOX_KITS.join("|")}]`);
        return 2;
      }
      const kit = typeof flags["kit"] === "string" ? flags["kit"] : "blank";
      // Validated against the ONE list, so a kit added or withdrawn in ops
      // needs no edit here. The literal that used to be on this line is why
      // the usage line above still offered two kits after `dialogue` landed.
      if (!isBoxKit(kit)) {
        io.error(`usage: --kit is one of ${BOX_KITS.map((k) => `"${k}"`).join(", ")}, got "${kit}"`);
        return 2;
      }
      const loaded = loadProject(positionals[1] ?? ".");
      // Unconditionally, as every other loading command does. This was inside
      // the catch, so scaffolding into a project with warnings printed nothing
      // but "added box ..." and the author learned about them next time they
      // ran validate (2026-08-29).
      printIssues(loaded.issues, io);
      try {
        const result = runNewBox({ loaded, kit });
        if (!commitWrites(result.writes, io)) return 1;
        io.log(`added box "${result.folder}" (${kit} kit) in ${loaded.dir}`);
        return 0;
      } catch (e) {
        io.error(e instanceof Error ? e.message : String(e));
        return 1;
      }
    }
    case "validate": {
      const loaded = loadProject(positionals[0] ?? ".");
      const result = runValidate(loaded);
      printIssues(result.issues, io);
      if (result.ok) io.log(`ok: ${loaded.dir}`);
      return result.ok ? 0 : 1;
    }
    case "format": {
      const loaded = loadProject(positionals[0] ?? ".");
      const result = runFormat(loaded);
      printIssues(result.issues, io);
      if (result.issues.some((i) => i.severity === "error")) return 1;
      if (result.changed.length === 0) {
        io.log("all shards canonical");
        return 0;
      }
      if (flags["check"] === true) {
        for (const w of result.changed) io.error(`not canonical: ${w.path}`);
        return 1;
      }
      if (!commitWrites(result.changed, io)) return 1;
      io.log(`formatted ${result.changed.length} shard(s)`);
      return 0;
    }
    case "export": {
      const loaded = loadProject(positionals[0] ?? ".");
      const out = typeof flags["o"] === "string" ? flags["o"] : undefined;
      // --map / --no-map override the project's own default for this one build:
      // the bundle going to a level editor may want the map when the one going
      // to a shipping branch does not.
      const map = flags["map"] === true ? true : (flags["no-map"] === true ? false : undefined);
      const result = runExport(loaded, out, map === undefined ? {} : { map });
      printIssues(result.issues, io);
      if (!result.bundle) return 1;
      if (out === "-") {
        io.log(result.text!);
        return 0;
      }
      if (!commitWrites([result.write!], io)) return 1;
      for (const asset of result.assets) {
        mkdirSync(dirname(asset.path), { recursive: true });
        if (!commitBinary(asset.path, Buffer.from(asset.bytes), io)) return 1;
      }
      io.log(`exported ${result.write!.path}`);
      if (result.assets.length > 0) io.log(`  with ${result.assets.length} map picture(s)`);
      return 0;
    }
    // export-html: the playable page (parity audit 9.3). Patter's export-html:
    // no -o lands it beside the bundle under the bundle's name, -o - streams it.
    case "export-html": {
      const loaded = loadProject(positionals[0] ?? ".");
      const result = runExportHtml(loaded);
      printIssues(result.issues, io);
      if (result.html === undefined) return 1;
      if (flags["o"] === "-") {
        io.log(result.html);
        return 0;
      }
      const target = typeof flags["o"] === "string" ? flags["o"] : bundleOutputPath(loaded).replace(/\.[^./\\]+$/, ".html");
      if (!commitWrites([{ path: target, content: result.html }], io)) return 1;
      io.log(`wrote ${target} (${Math.round(Buffer.byteLength(result.html) / 1024)} KB)`);
      return 0;
    }
    // export-xlsx: the readable workbook (parity audit 9.5). Rendered from the
    // loaded source, so it needs no compile and no bundle; -o is required, as
    // for pack, because a spreadsheet has no declared home in the project.
    case "export-xlsx": {
      if (typeof flags["o"] !== "string") {
        io.error("usage: export-xlsx [path] -o <file.xlsx>");
        return 2;
      }
      const loaded = loadProject(positionals[0] ?? ".");
      printIssues(loaded.issues, io);
      if (!loaded.source) return 1;
      const result = await runExportXlsx(loaded.source);
      if (!commitBinary(flags["o"], result.buffer, io)) return 1;
      const c = result.counts;
      io.log(`wrote ${flags["o"]}: ${c.cards} card(s) on ${c.decks} deck sheet(s), ${c.outcomes} outcome(s), ${c.hands} hand(s), ${c.tagGroups} tag group(s)`);
      return 0;
    }
    case "peek":
    case "deal": {
      const target = positionals[0];
      if (target === undefined) {
        io.error(command === "peek"
          ? "usage: peek <box> [path] [--where group=tag ...] [--n N]"
          : "usage: deal <hand> [path]");
        return 2;
      }
      const errors: string[] = [];
      const criteria = Object.fromEntries(
        Object.entries(pairs(repeats["where"] ?? [], "where", errors)).map(([k, v]) => [k, String(v)]));
      const sets = pairs(repeats["set"] ?? [], "set", errors);
      const seed = typeof flags["seed"] === "string" ? Number(flags["seed"]) : undefined;
      if (seed !== undefined && !Number.isInteger(seed)) errors.push("--seed must be an integer");
      const n = typeof flags["n"] === "string" ? Number(flags["n"]) : undefined;
      if (n !== undefined && !Number.isInteger(n)) errors.push("--n must be an integer");
      if (errors.length > 0) {
        for (const e of errors) io.error(`usage: ${e}`);
        return 2;
      }
      const loaded = loadProject(positionals[1] ?? ".");
      const result = runAsk(loaded, {
        ...(command === "peek"
          ? { box: target, criteria, ...(n !== undefined ? { n } : {}) }
          : { hand: target }),
        sets,
        ...(seed !== undefined ? { seed } : {}),
        ...(flags["deal-all"] === true ? { dealAll: true } : {}),
      });
      printIssues(result.issues, io);
      if (!result.cards) return 1;
      if (result.cards.length === 0) {
        io.log(command === "peek" ? "(empty stock)" : "(empty hand)");
        return 0;
      }
      result.cards.forEach((card, i) => {
        io.log(`${i + 1}. ${card.gameId}${card.title ? `  ${JSON.stringify(card.title)}` : ""}`);
      });
      return 0;
    }
    case "resolve": {
      const query = positionals[0];
      if (query === undefined) {
        io.error("usage: resolve <query> [path]");
        return 2;
      }
      const loaded = loadProject(positionals[1] ?? ".");
      printIssues(loaded.issues, io);
      if (!loaded.source) return 1;
      const entries = runResolve(loaded, query);
      if (entries.length === 0) { io.error(`no match for '${query}'`); return 1; }
      // One line per hit: id, kind, title, gameId, the trail of containers, the shard.
      const kindLabel: Record<string, string> = { template: "hand template", tagGroup: "tag group" };
      for (const e of entries) {
        const title = e.title !== undefined ? `  ${JSON.stringify(e.title)}` : "";
        const trail = e.location.length > 0 ? `  ${e.location.join(" > ")}` : "";
        io.log(`${e.id}  [${kindLabel[e.kind] ?? e.kind}]${title}  ${e.gameId}${trail}  (${e.file})`);
      }
      return 0;
    }
    case "pack": {
      if (typeof flags["o"] !== "string") {
        io.error("usage: pack [path] -o <file.storyletpack>");
        return 2;
      }
      // A pack is a HANDOVER, so what is wrong with it is worth saying before
      // it goes. runPack deliberately does not parse the project - it walks
      // shards by extension, layout-independent - so nothing was looking, and
      // you could pack a project whose deck does not compile and be told
      // "packed <file>", exit 0 (2026-08-29). Reported, not refused: sending
      // somebody a broken project to FIX is a real errand, and an unresolved
      // MERGE is the case that is refused (in runPack itself).
      printIssues(loadProject(positionals[0] ?? ".").issues, io);
      let bytes: Buffer;
      try {
        // --assets / --no-assets override the project's own default for this
        // one delivery: a pack is a handover, and who it is for changes the
        // answer (a designer wants the site plan, a writer does not).
        //
        // `assets` is BOOLEAN in FLAGS, so flags["assets"] is true or absent:
        // the old `!== "false"` compared a boolean against a string and was
        // always true, reading as though `--assets false` were supported. It
        // is not; --no-assets is the off switch.
        const assets = flags["assets"] !== undefined
          ? true
          : (flags["no-assets"] !== undefined ? false : undefined);
        bytes = await runPack(positionals[0] ?? ".", ...(assets === undefined ? [] : [{ assets }]));
      } catch (e) {
        if (e instanceof PackError) { io.error(e.message); return 1; }
        throw e;
      }
      if (!commitBinary(flags["o"], bytes, io)) return 1;
      io.log(`packed ${flags["o"]}`);
      return 0;
    }
    case "unpack": {
      const file = positionals[0];
      if (file === undefined) {
        io.error("usage: unpack <file.storyletpack> -o <dir> [--merge --base <sent.storyletpack>]");
        return 2;
      }
      if (typeof flags["o"] !== "string") {
        io.error("usage: unpack <file.storyletpack> -o <dir> [--merge --base <sent.storyletpack>]");
        return 2;
      }
      const target = flags["o"];

      try {
        if (flags["merge"] === true) {
          // The return leg: fold a RETURNED pack into the project at -o, using
          // the pack we sent as the common ancestor.
          if (typeof flags["base"] !== "string") {
            io.error("usage: unpack --merge needs --base <sent.storyletpack> (the pack you sent)");
            return 2;
          }
          const result = await runUnpackMerge(readFileSync(file), readFileSync(flags["base"]), target);
          // BEFORE the writes and before the per-shard list, so it is the first
          // thing on screen rather than scrollback. The person most likely to
          // choose the wrong ancestor is the one at a terminal with no file
          // picker to remind them what they just chose, and they were the only
          // one getting no help at all (the Patter side's point).
          if (result.provenance.message !== undefined) io.error(`warning: ${result.provenance.message}`);
          if (!commitWrites([...result.writes, ...result.sidecars], io)) return 1;
          for (const shard of result.shards) {
            const n = shard.result ? shard.result.conflicts.length : 0;
            io.log(`${shard.added ? "added" : "merged"}: ${shard.path}${n > 0 ? ` (${n} conflict(s))` : ""}`);
          }
          for (const a of result.assets) {
            mkdirSync(dirname(a.path), { recursive: true });
            writeFileSync(a.path, a.bytes);
            io.log(`added asset: ${a.path}`);
          }
          for (const kept of result.keptAssets) io.log(`kept your own asset: ${kept}`);
          io.log(`${result.shards.length} shard(s) -> ${target}; ${result.conflicts} conflict(s), ${result.warnings} warning(s)`);
          return result.conflicts > 0 ? 1 : 0;
        }

        const { shards, assets } = await runUnpack(readFileSync(file), target);
        if (!commitWrites(shards, io)) return 1;
        for (const w of shards) io.log(`unpacked: ${w.path}`);
        // Assets go through fs rather than the VC layer: they are bytes, not
        // text, and nothing downstream should be asked to diff them.
        for (const a of assets) {
          mkdirSync(dirname(a.path), { recursive: true });
          writeFileSync(a.path, a.bytes);
          io.log(`unpacked: ${a.path}`);
        }
        io.log(`${shards.length} shard(s)${assets.length > 0 ? `, ${assets.length} asset(s)` : ""} -> ${target}`);
        return 0;
      } catch (e) {
        // A pack from outside the team that tries to write outside the target
        // is a refusal, not a crash.
        if (e instanceof UnsafeEntryError) { io.error(`unpack refused: ${e.message}`); return 1; }
        // Schema skew still refuses: two shards of different schema versions
        // cannot be three-wayed at all. A different PROJECT no longer refuses -
        // it warns above, before the writes.
        if (e instanceof MergeInputError) { io.error(`merge refused: ${e.message}`); return 1; }
        if (e instanceof Error && "code" in e && e.code === "ENOENT") { io.error(`cannot read: ${e.message}`); return 1; }
        throw e;
      }
    }
    case "merge": {
      const [basePath, oursPath, theirsPath] = positionals;
      if (!basePath || !oursPath || !theirsPath) {
        io.error("usage: merge BASE OURS THEIRS [-o out] [--json]");
        return 2;
      }
      const sides: Record<string, unknown>[] = [];
      for (const path of [basePath, oursPath, theirsPath]) {
        try {
          const parsed = parseSource(readFileSync(path, "utf8"));
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not a shard object");
          sides.push(parsed as Record<string, unknown>);
        } catch (e) {
          // Unparseable input: exit 2, so a VCS driver falls back to its
          // default behaviour rather than trusting a guess.
          io.error(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
          return 2;
        }
      }
      let result;
      try {
        result = runMerge(sides[0]!, sides[1]!, sides[2]!);
      } catch (e) {
        if (e instanceof MergeInputError) {
          io.error(e.message);
          return 2;
        }
        throw e;
      }
      for (const w of result.warnings) io.error(`warning: ${w.message} (${w.path})`);
      const out = typeof flags["o"] === "string" ? flags["o"] : undefined;
      if (flags["json"] === true || out === undefined) {
        io.log(JSON.stringify(result, null, 2));
      }
      if (out === undefined) return result.conflicts.length > 0 ? 1 : 0;

      // Merge writes use PLAIN fs, deliberately outside the VC layer: as a
      // VCS merge driver we run while the VCS holds its own locks (git's
      // index.lock), and `-o` is usually a VCS temp file, not a source-tree
      // shard - staging it would be wrong even if it worked.
      const write = (path: string, content: string): boolean => {
        try {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, content);
          return true;
        } catch (e) {
          io.error(`write failed: ${path}: ${e instanceof Error ? e.message : String(e)}`);
          return false;
        }
      };
      if (!write(out, canonicalStringify(result.merged))) return 1;
      // The sidecar belongs beside the REAL file (--path, git's %P), not the
      // merge temp file; without --path it sits beside the output.
      const realPath = typeof flags["path"] === "string" ? flags["path"] : out;
      const sidecar = `${realPath}${CONFLICT_SIDECAR_EXTENSION}`;
      if (result.conflicts.length > 0) {
        if (!write(sidecar, conflictSidecar(result))) return 1;
        io.error(`${result.conflicts.length} conflict(s) - wrote ${out} (provisional OURS) + ${sidecar}`);
        return 1;
      }
      if (existsSync(sidecar)) rmSync(sidecar);   // a clean merge clears a stale sidecar
      io.log(`merged ${out} (${result.type}, no conflicts)`);
      return 0;
    }
    case "links": {
      const loaded = loadProject(positionals[0] ?? ".");
      if (!loaded.source) { printIssues(loaded.issues, io); return 1; }
      const scope = typeof flags["deck"] === "string" ? { kind: "deck" as const, deck: flags["deck"] }
        : typeof flags["box"] === "string" ? { kind: "box" as const, box: flags["box"] }
        : typeof flags["card"] === "string" ? { kind: "card" as const, card: flags["card"] }
        : { kind: "all" as const };
      const graph = analyseInfluence(loaded.source, { scope, ...(flags["refs"] === true ? { includeReference: true } : {}) });
      printIssues(graph.issues, io);
      if (graph.issues.some((i) => i.severity === "error")) return 1;
      if (flags["json"] === true) {
        io.log(JSON.stringify(graph, null, 2));
        return 0;
      }
      const name = new Map(graph.nodes.map((n) => [n.id, n.title ?? n.gameId]));
      const c = graph.countsByClass;
      io.log(`links: ${graph.nodes.length} card(s), ${graph.edges.length} edge(s) - ${c.enable} enable, ${c.disable} disable, ${c.influence} influence, ${c.reference} reference`);
      for (const e of graph.edges) {
        // Name the outcome: one card's outcomes often push a property both ways,
        // so "enable" and "disable" between the same pair is normal, not a bug.
        const why = e.via.map(describeContribution).join("; ");
        io.log(`  ${name.get(e.from) ?? e.from} ${e.cls} ${name.get(e.to) ?? e.to}  [${why}]`);
      }
      for (const w of graph.warnings) io.error(`warning: ${w.message}`);
      return 0;
    }
    case "coverage": {
      const loaded = loadProject(positionals[0] ?? ".");
      if (!loaded.source) {
        printIssues(loaded.issues, io);
        return 1;
      }
      if (flags["propose"] === true) {
        const proposed = proposeCoverage(loaded.source);
        printIssues(proposed.issues, io);
        if (proposed.issues.some((i) => i.severity === "error")) return 1;
        io.log(canonicalStringify({ coverage: proposed.coverage }).trimEnd());
        return 0;
      }
      const num = (name: string): number | undefined => {
        const raw = flags[name];
        return typeof raw === "string" ? Number(raw) : undefined;
      };
      for (const name of ["runs", "max-turns", "seed"]) {
        const v = num(name);
        if (v !== undefined && !Number.isInteger(v)) {
          io.error(`usage: --${name} must be an integer`);
          return 2;
        }
      }
      const runsFlag = num("runs");
      const maxTurnsFlag = num("max-turns");
      const seedFlag = num("seed");
      const report = runCoverage(loaded.source, {
        ...(runsFlag !== undefined ? { runs: runsFlag } : {}),
        ...(maxTurnsFlag !== undefined ? { maxTurns: maxTurnsFlag } : {}),
        ...(seedFlag !== undefined ? { seed: seedFlag } : {}),
      });
      printIssues(report.issues, io);
      if (report.issues.some((i) => i.severity === "error")) return 1;
      if (flags["json"] === true) {
        io.log(JSON.stringify(report, null, 2));
      } else {
        const cardsDealt = report.cards.filter((c) => c.dealt > 0).length;
        const cardsPlayed = report.cards.filter((c) => c.played > 0).length;
        const outcomesPlayed = report.outcomes.filter((o) => o.played > 0).length;
        // A card with no outcomes cannot be played: dealt is its whole job
        // (the news/codex pattern), so the played count answers over the
        // cards that COULD be.
        const playable = new Set(report.outcomes.map((o) => o.card)).size;
        io.log(`coverage: ${report.runs} run(s), seed ${report.seed}, max ${report.maxTurns} turns/run, ${report.turns} turns, ${report.plays} plays`);
        io.log(report.drivers.length > 0
          ? `inputs driven: ${report.drivers.join(", ")}`
          : "no input drivers: content gated on @world reads as never dealt");
        io.log(`cards dealt ${cardsDealt}/${report.cards.length}, played ${cardsPlayed}/${playable}${playable < report.cards.length ? " playable" : ""}; outcomes played ${outcomesPlayed}/${report.outcomes.length}`);
        if (playable < report.cards.length) {
          io.log(`dealt-only: ${report.cards.length - playable} card(s) with no outcomes - dealt is their whole job`);
        }
        for (const h of report.hands) {
          const total = h.cardsDealt.length + h.cardsNeverDealt.length;
          io.log(`hand ${h.gameId}: held ${h.cardsDealt.length}/${total} cards over ${h.deals} deal(s)`);
        }
        for (const c of report.cards.filter((x) => x.dealt === 0)) {
          // The remedy depends on the scope: a driver feeds @world (the host
          // seam), so "add a driver" is only honest advice there. @story and
          // @hand state is the content's own to write, and a misspelt name
          // never gets this far (it is a compile error), so what is left is a
          // declared property no outcome writes.
          const anyWorld = (c.unwrittenRefs ?? []).some((r) => r.startsWith("@world."));
          const hint = c.unwrittenRefs
            ? `  ? gated on ${c.unwrittenRefs.join(", ")} - nothing writes${anyWorld ? " or drives" : ""} it${anyWorld ? " (add a coverage driver?)" : ""}`
            : "";
          io.log(`never dealt: ${c.gameId}${hint}`);
          // The second hop: a gate that IS written, but only by content that
          // never happened. Says where to look next rather than leaving two
          // never-dealt cards looking like two separate problems.
          for (const d of c.refsWrittenOnlyByNeverDealtCards ?? []) {
            const names = d.by.map((id) => report.cards.find((x) => x.id === id)?.gameId ?? id);
            io.log(`  ? gated on ${d.ref} - written only by ${names.join(", ")}, which never came up either`);
          }
        }
        for (const o of report.outcomes.filter((x) => x.played === 0)) {
          io.log(`never played: ${report.cards.find((c) => c.id === o.card)?.gameId}/${o.gameId}`);
        }
        // The composed-name net: evaluation faults there, so the content
        // silently never deals from those hands - worth a line each.
        for (const u of report.unprovidedHandRefs) {
          io.log(`unprovided: ${u.where} reads ${u.ref}, which ${u.hands.join(", ")} never composes`);
        }
        for (const d of report.diagnostics) {
          io.log(`warning (${d.runs}/${report.runs} runs): ${d.where}: ${d.message}`);
        }
      }
      const gap = report.cards.some((c) => c.dealt === 0)
        || report.unprovidedHandRefs.length > 0 || report.diagnostics.length > 0;
      return flags["fail-on-gap"] === true && gap ? 1 : 0;
    }
    default:
      io.error(USAGE);
      return 2;
  }
}
