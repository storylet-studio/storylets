// ---------------------------------------------------------------------------
// `storyletengine` CLI - argv parsing, output, and exit codes ONLY
// (importable, so the parser and exit mapping are testable). All the work
// lives in @storylet-studio/ops, the shared operations layer the editor and
// CI consume too.
//
// Flags are declared per command: a VALUED flag always consumes the next
// token (or takes its value inline, `--flag=value`), a BOOLEAN flag never
// does, a REPEATED flag collects every use, and an unknown flag is an error
// rather than a silent no-op. `<command> --help` prints that command's usage.
// Every usage error prints under one prefix, `usage: `. Exit codes:
// 0 ok, 1 the operation found problems / failed, 2 usage. (Patter's CLI
// conventions, carried whole.)
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deleteFile, writeBinaryFile, writeTextFiles } from "@wildwinter/simple-vc-lib";
import {
  canonicalStringify, conflictSidecar, loadProject, parseFlagValue, parseSource,
  proposeCoverage, runAsk, runCoverage, runExport, runFormat, runInit, undoInit, runMerge,
  runNewBox, runPack, runUnpack, runUnpackMerge, runValidate, analyseInfluence, describeContribution,
  CONFLICT_SIDECAR_EXTENSION, MergeInputError, NotAPackError, PackError, UnsafeEntryError, isBinaryWrite,
  runResolve, // resolve: the --at lookup from the terminal
  runExportXlsx, // export-xlsx: the readable workbook
  runExportHtml, bundleOutputPath, // export-html: the playable page
  BOX_KITS,                        // the one kit list; --kit validates from it
  GAME_KITS,                       // the same for init's game kits
  planShareScopes, defaultGameScopesParent, // share-scopes: Storyletter's Share Scopes, from the terminal
  leastReachedFirst, sharePct, // coverage: the order and the Runs dealt column, as the window has them
} from "@storylet-studio/ops";
import type { BoxKit, CardCoverage, GameKit, Issue, PlannedFileWrite, PlannedWrite } from "@storylet-studio/ops";
import { contractPropertyPath, contractPropertyType, turnSpan } from "@storylet-studio/model";
import pkg from "../package.json" with { type: "json" };

export const USAGE = `storyletengine - Storylet Engine CLI

Usage:
  storyletengine init [dir]           Scaffold a new .storylets project from a game
                 [--name X]           kit, with editor associations and git config
                 [--kit K]            K: ${GAME_KITS.join(", ")} (default starter)
  storyletengine new box [path]       Add a box to a project, scaffolded from a kit
                 [--kit K]            K: ${BOX_KITS.join(", ")}
                                      (default blank; the others are narrated)
  storyletengine validate [path]      Validate a project: the publish gate, bundle
                                      staleness, canonical form
  storyletengine format [path]        Rewrite shards to canonical form, and move a
                                      project from before the project map onto it
                                      (zones to the root map.storyletmap, pictures
                                      to the root assets/), refusing copies of a
                                      map that disagree (alias: fmt)
                 [--check]            Report what would change; write nothing (for CI)
  storyletengine export [path]        Compile to the .storyletsc bundle (the project's
                 [-o FILE]            declared path, or -o; -o - for stdout), and bring
                                      game-scopes/storylets.scopes.json up to date
                                      when the game shares its scopes
                 [--map|--no-map]     Carry the project map's geometry (zone shapes,
                                      pictures and sites), overriding the project
                                      setting
  storyletengine export-html [path]   One self-contained, playable .html (runtime,
                 [-o FILE]            board and bundle inlined; send it to anyone,
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
                 (--set takes the address listProperties prints: story.gold,
                  world.time, box.street.mood, deck.wares.n, hand.the-elder.zone,
                  value.docks.danger - the owner named as you name it; where two
                  boxes name a tag the same, say which: value.harbour/docks.danger)
  storyletengine resolve <query> [path]  Find an item by gameId, id or title: which
                                      box, deck and shard it lives in (the same
                                      lookup as Storyletter's --at)
  storyletengine share-scopes [path]  Share the project's scopes with the game's other
                 [--at DIR]           tools: make the game's game-scopes/ folder (in
                                      DIR, else the version-control root above the
                                      project) with storylets.scopes.json and
                                      game.scopes.json; joins a folder that already
                                      exists, adding @world only when it has none
  storyletengine pack [path] -o FILE   Pack a project into one portable
                 [--assets|--no-assets]  .storyletpack, to hand to someone with
                                      no shared version control (--assets carries
                                      the background pictures too; the game's
                                      shared scopes travel whenever it has them)
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
  storyletengine contract show        What each installation contract this project
                 [installation]       carries depends on: the hands, boxes,
                 [path]               properties and fields a venue was
                                      provisioned against. \`validate\` refuses a
                                      build that breaks one
  storyletengine coverage [path]      Seeded random playthroughs: what can each
                 [--runs N] [--max-turns M] [--seed S]   hand deal, what never
                 [--json] [--fail-on-gap]                gets dealt or played?
                 [--order least|deck] Least reached first (the default), or
                                      deck by deck as authored
                 [--propose]          Print an auto-proposed coverage block
                                      (drivers + arg domains) instead of running
  storyletengine --version            Print the version and exit (also -v, version)
  storyletengine <command> --help     Print one command's usage (also help <command>)

Exit codes: 0 ok, 1 the operation found problems, 2 usage. "merge" alone also
maps a malformed INPUT to 2, so a version-control driver can tell "these three
files are not storylets source" from "the merge found conflicts" and fall back
to its own behaviour rather than trusting a guess.
`;

interface Io {
  log: (line: string) => void;
  error: (line: string) => void;
  /** Raw output, written as it stands with no newline added: `-o -`, so what
   *  arrives on stdout is the file's bytes exactly. Falls back to `log`. */
  write?: (text: string) => void;
}

interface FlagSpec { boolean: readonly string[]; valued: readonly string[]; repeated: readonly string[] }

const FLAGS = {
  init: { boolean: [], valued: ["name", "kit"], repeated: [] },
  new: { boolean: [], valued: ["kit"], repeated: [] },
  validate: { boolean: [], valued: [], repeated: [] },
  format: { boolean: ["check"], valued: [], repeated: [] },
  export: { boolean: ["map", "no-map"], valued: ["o"], repeated: [] },
  "export-html": { boolean: [], valued: ["o"], repeated: [] },   // the playable page
  "export-xlsx": { boolean: [], valued: ["o"], repeated: [] },   // the readable workbook
  peek: { boolean: ["deal-all"], valued: ["seed", "n"], repeated: ["where", "set"] },
  deal: { boolean: ["deal-all"], valued: ["seed"], repeated: ["set"] },
  resolve: { boolean: [], valued: [], repeated: [] },
  "share-scopes": { boolean: [], valued: ["at"], repeated: [] },
  // --assets/--no-assets were read by the handler from the day they were
  // designed and never declared here, so every use of them was an "unknown
  // flag" and the override was unreachable. Declared now, with a test.
  pack: { boolean: ["assets", "no-assets"], valued: ["o"], repeated: [] },
  unpack: { boolean: ["merge"], valued: ["o", "base"], repeated: [] },
  merge: { boolean: ["json"], valued: ["o", "path"], repeated: [] },
  links: { boolean: ["json", "refs"], valued: ["deck", "box", "card"], repeated: [] },
  coverage: { boolean: ["json", "fail-on-gap", "propose"], valued: ["runs", "max-turns", "seed", "order"], repeated: [] },
  contract: { boolean: [], valued: [], repeated: [] },
} satisfies Record<string, FlagSpec>;

/** The commands, from the one table: the switch in `run` is exhaustive over
 *  this, so a command declared and not handled is a compile error. */
type Command = keyof typeof FLAGS;
/** `in` would answer for `toString` too; only the table's own keys are commands. */
const isCommand = (name: string): name is Command => Object.hasOwn(FLAGS, name);

/** Each command's whole short form, printed after every usage error so the
 *  fix is on screen: every flag, which the old one-off lines each left some
 *  of out. The website's "Every command" block says the same. */
const SHORT: Record<Command, string> = {
  init: `init [dir] [--name X] [--kit ${GAME_KITS.join("|")}]`,
  new: `new box [path] [--kit ${BOX_KITS.join("|")}]`,
  validate: "validate [path]",
  format: "format [path] [--check]",
  export: "export [path] [-o FILE] [--map|--no-map]",
  "export-html": "export-html [path] [-o FILE]",
  "export-xlsx": "export-xlsx [path] -o FILE",
  peek: "peek <box> [path] [--where group=tag ...] [--n N] [--set path=value ...] [--seed N] [--deal-all]",
  deal: "deal <hand> [path] [--set path=value ...] [--seed N] [--deal-all]",
  resolve: "resolve <query> [path]",
  "share-scopes": "share-scopes [path] [--at DIR]",
  pack: "pack [path] -o FILE [--assets|--no-assets]",
  unpack: "unpack FILE -o DIR [--merge --base SENT.storyletpack]",
  merge: "merge BASE OURS THEIRS [-o out] [--json] [--path realfile]",
  links: "links [path] [--deck X | --box X | --card X] [--refs] [--json]",
  coverage: "coverage [path] [--runs N] [--max-turns M] [--seed S] [--order least|deck] [--json] [--fail-on-gap] [--propose]",
  contract: "contract show [installation] [path]",
};

/** Flags that say opposite things: both at once is a usage error, not a
 *  silent win for whichever the handler happened to read first. */
const OPPOSITES: [string, string][] = [["map", "no-map"], ["assets", "no-assets"]];

/** One command's block of the usage text, for `<command> --help` and
 *  `help <command>`: read out of USAGE, so there is one text to keep right. */
export function commandUsage(command: Command): string {
  const lines = USAGE.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`  storyletengine ${command} `));
  let end = start + 1;
  while (end < lines.length && /^ {3,}\S/.test(lines[end]!)) end++;
  return ["Usage:", ...lines.slice(start, end)].join("\n");
}

/** A usage error, exit 2: each problem on a line, then the command's whole
 *  short form, all of it under the one prefix. */
function usage(io: Io, command: Command, ...problems: string[]): 2 {
  for (const problem of problems) io.error(`usage: ${problem}`);
  io.error(`usage: storyletengine ${SHORT[command]}`);
  return 2;
}

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
  repeats: Record<string, string[]>;
  /** Usage problems (unknown flag, missing value); non-empty means exit 2. */
  errors: string[];
}

export function parseArgs(command: string, args: string[]): ParsedArgs {
  const spec: FlagSpec = isCommand(command) ? FLAGS[command] : { boolean: [], valued: [], repeated: [] };
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
    // `--flag=value`, as Storyletter's own `--at=` reads: split at the first
    // `=`, so a value may hold more of them (`--where=area=docks`).
    const eq = token.startsWith("--") ? token.indexOf("=") : -1;
    const name = (eq > 0 ? token.slice(0, eq) : token).replace(/^--?/, "");
    const inline = eq > 0 ? token.slice(eq + 1) : undefined;
    if (spec.boolean.includes(name)) {
      if (inline !== undefined) errors.push(`--${name} takes no value`);
      else flags[name] = true;
    } else if (spec.valued.includes(name) || spec.repeated.includes(name)) {
      const value = inline ?? args[++i];
      if (value === undefined) {
        errors.push(`flag --${name} needs a value`);
      } else if (spec.repeated.includes(name)) {
        repeats[name] = [...(repeats[name] ?? []), value];
      } else {
        flags[name] = value;
      }
    } else {
      errors.push(`unknown flag ${eq > 0 ? token.slice(0, eq) : token}`);
    }
  }
  for (const [on, off] of OPPOSITES) {
    if (flags[on] === true && flags[off] === true) errors.push(`--${on} and --${off} contradict each other`);
  }
  return { positionals, flags, repeats, errors };
}

/** Is this string one of the kits? A guard rather than a bare `includes`, so
 *  the value narrows to BoxKit for the call below and the list stays the only
 *  place a kit is named. */
const isBoxKit = (k: string): k is BoxKit => (BOX_KITS as readonly string[]).includes(k);
const isGameKit = (k: string): k is GameKit => (GAME_KITS as readonly string[]).includes(k);

function printIssues(issues: Issue[], io: Io): void {
  for (const issue of issues) {
    const where = issue.where ? ` [${issue.where}]` : "";
    io.error(`${issue.severity}: ${issue.path}${where}: ${issue.message}`);
  }
}

/** The same issue said once: `format` prints the load's issues and its own,
 *  and an unparseable shard is in both. */
function uniqueIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = JSON.stringify([i.severity, i.path, i.where ?? "", i.message]);
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

const hasError = (issues: readonly Issue[]): boolean => issues.some((i) => i.severity === "error");

function commitWrites(writes: PlannedWrite[], io: Io): boolean {
  const batch = writeTextFiles(writes.map((w) => ({ filePath: w.path, content: w.content })));
  const failures = batch.results.filter((r) => !r.success);
  for (const f of failures) io.error(`write failed [${f.status}]: ${f.message}`);
  return batch.success;
}

/** Write one binary artefact (a pack, a workbook, a picture) through the VC
 *  layer, so a target that is under version control and read-only is checked
 *  out rather than refused. The folder first: the VC layer's text batch makes
 *  it and its binary write does not, so `-o` into a folder not there yet
 *  failed for a pack and worked for a bundle. */
function commitBinary(path: string, bytes: Uint8Array, io: Io): boolean {
  try {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  } catch (e) {
    io.error(`write failed: ${path}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  const result = writeBinaryFile(path, bytes);
  if (!result.success) io.error(`write failed [${result.status}]: ${result.message}`);
  return result.success;
}

/** Commit a plan of text and binary writes in the order it gives, stopping at
 *  the first that fails: the order is the plan's (export's pictures before
 *  the bundle that names them), never the front end's. */
function commitPlan(writes: PlannedFileWrite[], io: Io): boolean {
  for (const w of writes) {
    if (!(isBinaryWrite(w) ? commitBinary(w.path, w.bytes, io) : commitWrites([w], io))) return false;
  }
  return true;
}

/** Delete one file through the VC layer, saying so when it cannot. */
function commitDelete(path: string, io: Io): boolean {
  const result = deleteFile(path);
  if (!result.success) io.error(`delete failed [${result.status}]: ${result.message}`);
  return result.success;
}

/** Split repeated `k=v` flag values into a record, the values as written. */
function pairs(values: string[], flag: string, errors: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of values) {
    const eq = raw.indexOf("=");
    if (eq <= 0) {
      errors.push(`--${flag} expects k=v, got "${raw}"`);
      continue;
    }
    out[raw.slice(0, eq)] = raw.slice(eq + 1);
  }
  return out;
}

/** `a`, `a and b`, `a, b and c`. */
const listed = (items: string[]): string =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** Run one CLI invocation. Returns the process exit code. */
export async function run(
  argv: string[],
  io: Io = { log: console.log, error: console.error, write: (text) => { process.stdout.write(text); } },
): Promise<number> {
  const [rawCommand, ...rest] = argv;
  const alias = (name: string | undefined): string | undefined => (name === "fmt" ? "format" : name);
  const command = alias(rawCommand);
  // `help <command>`: that command's usage, as `<command> --help` gives it.
  if (command === "help" && rest[0] !== undefined) {
    const asked = alias(rest[0])!;
    if (!isCommand(asked)) { io.error(`usage: unknown command "${asked}" (storyletengine --help lists them)`); return 2; }
    io.log(commandUsage(asked));
    return 0;
  }
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    io.log(USAGE);
    return command === undefined ? 2 : 0;
  }
  // Which build is this? A standalone binary has no package.json beside it and no
  // npm to ask, so without this there is no way to answer "what are you running?",
  // which is the first question any support conversation opens with. The version is
  // read from package.json at BUILD time: both shipping paths (tsup for dist/cli.js,
  // Bun --compile for the standalone binaries) bundle this entry and inline the
  // import, so the number cannot drift from the manifest the tag is checked against.
  if (command === "version" || command === "--version" || command === "-v") {
    io.log(pkg.version);
    return 0;
  }
  if (!isCommand(command)) {
    io.error(`usage: unknown command "${command}" (storyletengine --help lists them)`);
    return 2;
  }
  // Asking for help is not a usage error: the command's own block, exit 0.
  if (rest.includes("--help") || rest.includes("-h")) {
    io.log(commandUsage(command));
    return 0;
  }
  const parsed = parseArgs(command, rest);
  if (parsed.errors.length > 0) return usage(io, command, ...parsed.errors);
  const { positionals, flags, repeats } = parsed;
  // `-o -`: the file's own bytes on stdout, with nothing added after them.
  const raw = (text: string): void => (io.write ?? io.log)(text);

  switch (command) {
    case "init": {
      try {
        const kit = flags["kit"];
        if (kit !== undefined && (typeof kit !== "string" || !isGameKit(kit))) {
          return usage(io, "init", `--kit is one of ${GAME_KITS.map((k) => `"${k}"`).join(", ")}, got "${String(kit)}"`);
        }
        const result = runInit({
          dir: positionals[0] ?? ".",
          ...(typeof flags["name"] === "string" ? { name: flags["name"] } : {}),
          ...(kit !== undefined ? { kit } : {}),
        });
        // A half-written project would refuse every rerun ("a project already
        // exists here"), so a failed write takes back the files just made.
        if (!commitWrites(result.writes, io)) { undoInit(result); return 1; }
        io.log(`initialised "${result.name}" in ${result.dir}`);
        io.log(`next: storyletengine export ${result.dir}`);
        return 0;
      } catch (e) {
        io.error(e instanceof Error ? e.message : String(e));
        return 1;
      }
    }
    case "new": {
      if (positionals[0] !== "box") return usage(io, "new");
      const kit = typeof flags["kit"] === "string" ? flags["kit"] : "blank";
      // Validated against the ONE list, so a kit added or withdrawn in ops
      // needs no edit here. The literal that used to be on this line is why
      // the usage line above still offered two kits after `dialogue` landed.
      if (!isBoxKit(kit)) return usage(io, "new", `--kit is one of ${BOX_KITS.map((k) => `"${k}"`).join(", ")}, got "${kit}"`);
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
      // The load's issues always (they were never printed here), then the
      // format's own; an unparseable shard is in both and is said once.
      printIssues(uniqueIssues([...loaded.issues, ...result.issues]), io);
      if (hasError(result.issues)) return 1;
      if (result.changed.length === 0 && result.removed.length === 0 && result.moved.length === 0) {
        io.log("all shards canonical");
        return 0;
      }
      if (flags["check"] === true) {
        for (const w of result.changed) io.error(`not canonical: ${w.path}`);
        for (const stale of result.removed) io.error(`not canonical: ${stale} (what it held belongs elsewhere now)`);
        for (const move of result.moved) io.error(`not canonical: ${move.from} (belongs in the project's assets folder)`);
        return 1;
      }
      // The project map's pictures first, to the project's one folder, so a
      // picture that cannot be copied stops the format before any shard names
      // it at its new address. The old copies are deleted only once the shards
      // that pointed at them have been rewritten.
      for (const move of result.moved) {
        if (!commitBinary(move.to, readFileSync(move.from), io)) return 1;
      }
      if (!commitWrites(result.changed, io)) return 1;
      // A shard the migration emptied. Deleted through the VC layer, like
      // every other write, so a checked-in read-only file is checked out
      // first. Every delete is tried and every failure said: the new copies
      // are written by now, so what is left is a tidy-up the author can finish.
      let deleted = true;
      for (const path of result.removed) deleted = commitDelete(path, io) && deleted;
      for (const move of result.moved) {
        deleted = commitDelete(move.from, io) && deleted;
        const folder = dirname(move.from);
        try { if (readdirSync(folder).length === 0) rmdirSync(folder); } catch { /* not ours to insist on */ }
      }
      for (const line of result.migrated) io.log(line);
      const touched = result.changed.length + result.removed.length;
      io.log(`formatted ${touched} shard(s)${result.moved.length > 0 ? `, moved ${result.moved.length} picture(s)` : ""}`);
      return deleted ? 0 : 1;
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
        raw(result.text!);
        return 0;
      }
      // The plan's own order: the map pictures, the bundle that names them,
      // then the game's shared scopes file, written only when it changed.
      if (!commitPlan(result.writes, io)) return 1;
      io.log(`exported ${result.path!}`);
      const pictures = result.writes.filter(isBinaryWrite).length;
      if (pictures > 0) io.log(`  with ${pictures} map picture(s)`);
      for (const w of result.writes) if (!isBinaryWrite(w) && w.path !== result.path) io.log(`wrote ${w.path}`);
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
        raw(result.html);
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
      if (typeof flags["o"] !== "string") return usage(io, "export-xlsx");
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
      if (target === undefined) return usage(io, command);
      const errors: string[] = [];
      // --where names a tag, so its value is taken as written ("1.0" is the
      // tag 1.0); only --set's are typed, since they are property values.
      const criteria = pairs(repeats["where"] ?? [], "where", errors);
      const sets = Object.fromEntries(
        Object.entries(pairs(repeats["set"] ?? [], "set", errors)).map(([k, v]) => [k, parseFlagValue(v)]));
      const seed = typeof flags["seed"] === "string" ? Number(flags["seed"]) : undefined;
      if (seed !== undefined && !Number.isInteger(seed)) errors.push("--seed must be an integer");
      const n = typeof flags["n"] === "string" ? Number(flags["n"]) : undefined;
      if (n !== undefined && !Number.isInteger(n)) errors.push("--n must be an integer");
      if (errors.length > 0) return usage(io, command, ...errors);
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
    // What a VENUE depends on (design/engine-server.md 4.11). Read-only, and one
    // line per dependency in the same shape `resolve` prints: nothing here is a
    // build step, and the errors this material raises need no verb of their own
    // because `validate` already raises them.
    case "contract": {
      if (positionals[0] !== "show") return usage(io, "contract");
      // `contract show <path>` with no installation has to be told apart from
      // `contract show <installation>`: a path is a thing on disk, a name is not.
      const asked = positionals[1];
      const looksLikePath = asked !== undefined && existsSync(asked);
      const installation = looksLikePath ? undefined : asked;
      const where = looksLikePath ? asked : positionals[2];
      const loaded = loadProject(where ?? ".");
      printIssues(loaded.issues, io);
      if (!loaded.source) return 1;
      const contracts = loaded.source.contracts
        .filter((c) => installation === undefined || c.shard.installation === installation);
      if (contracts.length === 0) {
        io.error(installation === undefined
          ? `no installation contracts in ${loaded.dir}`
          : `no contract for installation "${installation}" in ${loaded.dir}`);
        return 1;
      }
      for (const contract of contracts) {
        const shard = contract.shard;
        const by = [shard.by, shard.revision !== undefined ? `revision ${shard.revision}` : undefined]
          .filter((x) => x !== undefined).join(", ");
        io.log(`${shard.installation}${by !== "" ? `  (${by})` : ""}  (${contract.path})`);
        for (const hand of shard.hands ?? []) io.log(`  hand      ${hand}   dealt here`);
        for (const [box, want] of Object.entries(shard.boxes ?? {})) {
          io.log(`  box       ${box}   the scheduler ticks it every ${want.turn}s`);
        }
        for (const entry of shard.properties ?? []) {
          const type = contractPropertyType(entry);
          io.log(`  property  ${contractPropertyPath(entry)}${type !== undefined ? `   ${type}` : ""}`);
        }
        for (const field of shard.fields ?? []) io.log(`  field     ${field}   the crew and the bridges read it`);
        for (const field of shard.outcomeFields ?? []) io.log(`  field     ${field}   the crew and the bridges read it, on an outcome`);
      }
      return 0;
    }
    case "resolve": {
      const query = positionals[0];
      if (query === undefined) return usage(io, "resolve");
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
    case "share-scopes": {
      // The terminal's twin of Storyletter's File > Share Scopes with Other Tools
      // (patterkit design/shared-scopes.md): the same plan, committed as it
      // stands in one batch, so the two can't disagree about what is written.
      const loaded = loadProject(positionals[0] ?? ".");
      printIssues(loaded.issues, io);
      if (!loaded.source || hasError(loaded.issues)) return 1;
      const parent = typeof flags["at"] === "string" ? resolve(flags["at"]) : defaultGameScopesParent(loaded.dir);
      const plan = planShareScopes(loaded, parent);
      if ("error" in plan) { io.error(`share-scopes: ${plan.error}`); return 1; }
      if (!commitWrites(plan.writes, io)) return 1;
      for (const w of plan.writes) io.log(`wrote ${w.path}`);
      if (plan.override !== undefined) {
        io.log(`the project names the folder (gameScopes: ${plan.override}), since looking up from the project wouldn't find it`);
      }
      return 0;
    }

    case "pack": {
      if (typeof flags["o"] !== "string") return usage(io, "pack");
      // A pack is a HANDOVER, so what is wrong with it is worth saying before
      // it goes: you could once pack a project with a deck that does not even
      // load and be told "packed <file>", exit 0 (2026-08-29). These are the
      // LOAD's issues, not a compile's: a condition that does not compile is
      // validate's to find. Reported, not refused: sending somebody a broken
      // project to FIX is a real errand, and an unresolved MERGE is the case
      // that is refused (in runPack itself). The one load serves both.
      const loaded = loadProject(positionals[0] ?? ".");
      printIssues(loaded.issues, io);
      let bytes: Buffer;
      try {
        // --assets / --no-assets override the project's own default for this
        // one delivery: a pack is a handover, and who it is for changes the
        // answer (a designer wants the site plan, a writer does not). Both at
        // once is a usage error, caught with the flags.
        const assets = flags["assets"] === true ? true : (flags["no-assets"] === true ? false : undefined);
        bytes = await runPack(loaded.source !== undefined ? loaded : (positionals[0] ?? "."), ...(assets === undefined ? [] : [{ assets }]));
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
      if (file === undefined || typeof flags["o"] !== "string") return usage(io, "unpack");
      const target = flags["o"];

      try {
        if (flags["merge"] === true) {
          // The return leg: fold a RETURNED pack into the project at -o, using
          // the pack we sent as the common ancestor.
          if (typeof flags["base"] !== "string") return usage(io, "unpack", "--merge needs --base SENT.storyletpack (the pack you sent)");
          const result = await runUnpackMerge(readFileSync(file), readFileSync(flags["base"]), target);
          // BEFORE the writes and before the per-shard list, so it is the first
          // thing on screen rather than scrollback. The person most likely to
          // choose the wrong ancestor is the one at a terminal with no file
          // picker to remind them what they just chose, and they were the only
          // one getting no help at all (the Patter side's point).
          if (result.provenance.message !== undefined) io.error(`warning: ${result.provenance.message}`);
          // Sidecars first: if one fails, the shard it flags must not be left
          // holding provisional content with nothing saying so.
          if (!commitWrites([...result.sidecars, ...result.writes], io)) return 1;
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
          // The returned pack's copy of the game's scopes is never written back:
          // the folder here is the truth. A World edit the other author made is
          // the exception, since the project's copy of it would otherwise be
          // rewritten from game.scopes.json on the next save and lost.
          if (result.gameWorld !== undefined) {
            if ("error" in result.gameWorld) {
              io.error(`warning: the returned World properties could not be written to ${result.gameWorld.path}: ${result.gameWorld.error}`);
            } else {
              if (!commitWrites([result.gameWorld], io)) return 1;
              io.log(`updated the game's World properties: ${result.gameWorld.path}`);
            }
          }
          io.log(`${result.shards.length} shard(s) -> ${target}; ${result.conflicts} conflict(s), ${result.warnings} warning(s)`);
          return result.conflicts > 0 ? 1 : 0;
        }

        const { shards, assets, scopes } = await runUnpack(readFileSync(file), target);
        // The game's shared scopes the pack carried land in game-scopes/ inside
        // the project, where discovery looks first, so validate and the rest
        // know the other tools' names here as they did where it was packed.
        if (!commitWrites([...shards, ...scopes], io)) return 1;
        for (const w of shards) io.log(`unpacked: ${w.path}`);
        for (const w of scopes) io.log(`unpacked: ${w.path}`);
        // Assets go through fs rather than the VC layer: they are bytes, not
        // text, and nothing downstream should be asked to diff them.
        for (const a of assets) {
          mkdirSync(dirname(a.path), { recursive: true });
          writeFileSync(a.path, a.bytes);
          io.log(`unpacked: ${a.path}`);
        }
        io.log(`${shards.length} shard(s)${assets.length > 0 ? `, ${assets.length} asset(s)` : ""}`
          + `${scopes.length > 0 ? `, ${scopes.length} game scopes file(s)` : ""} -> ${target}`);
        return 0;
      } catch (e) {
        // A pack from outside the team that tries to write outside the target
        // is a refusal, not a crash.
        if (e instanceof UnsafeEntryError) { io.error(`unpack refused: ${e.message}`); return 1; }
        // A file that is not a zip at all: said, naming it, not a stack trace.
        if (e instanceof NotAPackError) {
          io.error(`unpack refused: ${e.which === "base" ? String(flags["base"]) : file} is ${e.message}`);
          return 1;
        }
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
      if (!basePath || !oursPath || !theirsPath) return usage(io, "merge");
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
      // An analysis of a project that did not wholly load answers about the
      // part that did, as though it were the whole: refused (ruling M).
      const loaded = loadProject(positionals[0] ?? ".");
      printIssues(loaded.issues, io);
      if (!loaded.source || hasError(loaded.issues)) return 1;
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
      for (const w of graph.warnings) io.error(w.cardGameId !== undefined ? `warning: card ${w.cardGameId}: ${w.message}` : `warning: ${w.message}`);
      return 0;
    }
    case "coverage": {
      // The flags first: a usage error is exit 2 whatever the project holds.
      const num = (name: string): number | undefined => {
        const value = flags[name];
        return typeof value === "string" ? Number(value) : undefined;
      };
      for (const name of ["runs", "max-turns"]) {
        const v = num(name);
        // Zero runs reported an empty sweep as a clean one.
        if (v !== undefined && !(Number.isInteger(v) && v > 0)) return usage(io, "coverage", `--${name} must be a positive integer`);
      }
      const seedValue = num("seed");
      if (seedValue !== undefined && !Number.isInteger(seedValue)) return usage(io, "coverage", "--seed must be an integer");
      const order = flags["order"] ?? "least";
      if (order !== "least" && order !== "deck") return usage(io, "coverage", "--order must be least or deck");
      // --propose prints a block and runs nothing, so the run's flags are said
      // to do nothing rather than silently dropped.
      const ignored = flags["propose"] === true
        ? ["runs", "max-turns", "seed", "order", "json", "fail-on-gap"].filter((f) => flags[f] !== undefined).map((f) => `--${f}`)
        : [];
      if (ignored.length > 0) io.error(`warning: ${listed(ignored)} ${ignored.length === 1 ? "does" : "do"} nothing with --propose`);

      // An analysis of a project that did not wholly load answers about the
      // part that did, as though it were the whole: refused (ruling M).
      const loaded = loadProject(positionals[0] ?? ".");
      printIssues(loaded.issues, io);
      if (!loaded.source || hasError(loaded.issues)) return 1;
      if (flags["propose"] === true) {
        const proposed = proposeCoverage(loaded.source);
        printIssues(proposed.issues, io);
        if (proposed.issues.some((i) => i.severity === "error")) return 1;
        io.log(canonicalStringify({ coverage: proposed.coverage }).trimEnd());
        return 0;
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
        const cardsPlayed = report.cards.filter((c) => c.played > 0).length;
        const outcomesPlayed = report.outcomes.filter((o) => o.played > 0).length;
        // A card with no outcomes cannot be played: dealt is its whole job
        // (the news/codex pattern), so the played count answers over the
        // cards that COULD be.
        const playableIds = new Set(report.outcomes.map((o) => o.card));
        const playable = playableIds.size;
        const t = report.totals;
        // A project whose every box is timed can have its turns read as time
        // (design/engine-server.md 4.8); a mixed project cannot, and says
        // nothing rather than something misleading.
        const asTime = (turns: number): string => report.turnSeconds === undefined
          ? "" : ` (${turnSpan(turns, report.turnSeconds)})`;
        io.log(`coverage: ${report.runs} run(s), seed ${report.seed}, max ${report.maxTurns} turns/run${asTime(report.maxTurns)}, ${report.turns} turns${asTime(report.turns)}, ${report.plays} plays`);
        io.log(report.drivers.length > 0
          ? `inputs driven: ${report.drivers.join(", ")}`
          : "no input drivers: content gated on @world reads as never dealt");
        // How the runs ended, in the window's words: running to the cap is
        // what most runs of a branching story do, not a fault.
        const term = report.terminations;
        io.log(`runs ended: ${term.exhausted} saw everything, ${term.maxTurns} ran to the turn cap, ${term.stuck} stuck`);
        io.log(`cards dealt ${t.dealt}/${t.cards}, played ${cardsPlayed}/${playable}${playable < t.cards ? " playable" : ""}; outcomes played ${outcomesPlayed}/${report.outcomes.length}`);
        io.log(`never dealt ${t.neverDealt}, rarely dealt ${t.rare} (under ${report.rareThresholdPct}% of runs), dealt but never played ${t.dealtNeverPlayed}`);
        if (playable < t.cards) {
          io.log(`dealt-only: ${t.cards - playable} card(s) with no outcomes, so being dealt is their whole job`);
        }
        // Out of the cards that could come up at the hand (by tags and place),
        // not out of its whole box, so a short count is a real gap. Seen is
        // counted from the gap list, so it can never exceed the possible.
        for (const h of report.hands) {
          const possible = h.cardsPossible.length;
          io.log(possible === 0
            ? `hand ${h.gameId}: no card's tags let it come up here (${h.deals} deal(s))`
            : `hand ${h.gameId}: saw ${possible - h.cardsNeverDealt.length}/${possible} cards that can come up here, over ${h.deals} deal(s) in all runs`);
        }

        // The card table, least reached first unless --order deck (patter
        // coverage's shape after 72c625f): headed columns, and a mark that
        // says which of the three faults a row is.
        const boxes = new Set(report.cards.map((c) => c.box));
        const cardById = new Map(report.cards.map((c) => [c.id, c]));
        const deckLabel = (c: CardCoverage): string => (boxes.size > 1 ? `${c.boxName}/${c.deckName}` : c.deckName);
        const heading = "    runs dealt   dealt  played  card";
        const cardRow = (c: CardCoverage, withDeck: boolean): void => {
          const hint = (c.unwrittenRefs?.length ?? 0) > 0 || (c.refsWrittenOnlyByNeverDealtCards?.length ?? 0) > 0;
          const neverPlayed = c.dealtRuns > 0 && c.playedRuns === 0 && playableIds.has(c.id);
          const mark = c.dealtRuns === 0 ? (hint ? "? " : "‼ ") : neverPlayed ? "! " : c.rare ? "~ " : "  ";
          const played = playableIds.has(c.id) ? String(c.played) : "n/a";
          io.log(`  ${mark}${sharePct(c.dealtRuns, report.runs).padStart(10)}  ${String(c.dealt).padStart(6)}  ${played.padStart(6)}  ${withDeck ? `[${deckLabel(c)}] ` : ""}${c.gameId}`);
          // The remedy depends on the scope: a driver feeds @world (the host
          // seam), so "add a driver" is only honest advice there. @story and
          // @hand state is the content's own to write, and a misspelt name
          // never gets this far (it is a compile error), so what is left is a
          // declared property no outcome writes.
          if (c.unwrittenRefs) {
            const anyWorld = c.unwrittenRefs.some((r) => r.startsWith("@world."));
            io.log(`        gated on ${c.unwrittenRefs.join(", ")}, which nothing writes${anyWorld ? " or drives (add a coverage driver?)" : ""}`);
          }
          // The second hop: a gate that IS written, but only by content that
          // never happened. Says where to look next rather than leaving two
          // never-dealt cards looking like two separate problems.
          for (const d of c.refsWrittenOnlyByNeverDealtCards ?? []) {
            const names = d.by.map((id) => cardById.get(id)?.gameId ?? id);
            io.log(`        gated on ${d.ref}, written only by ${names.join(", ")}, which never came up either`);
          }
        };
        if (report.cards.length > 0) {
          io.log("");
          io.log("runs dealt = share of runs that dealt the card at least once; dealt, played = times across all runs; n/a = no outcomes");
          io.log(`‼ never dealt   ? never dealt, gated on state nothing sets   ~ rarely dealt (under ${report.rareThresholdPct}% of runs)   ! dealt, never played`);
          if (order === "least") {
            io.log("");
            io.log("least reached first");
            io.log(heading);
            for (const c of leastReachedFirst(report.cards)) cardRow(c, true);
          } else {
            // Deck order: the report's own, box by box and deck by deck as
            // authored, under a heading per deck that counts its faults.
            const byDeck = new Map<string, CardCoverage[]>();
            for (const c of report.cards) (byDeck.get(c.deck) ?? byDeck.set(c.deck, []).get(c.deck)!).push(c);
            for (const cards of byDeck.values()) {
              const never = cards.filter((c) => c.dealtRuns === 0).length;
              const rare = cards.filter((c) => c.rare).length;
              const unplayed = cards.filter((c) => c.dealtRuns > 0 && c.playedRuns === 0 && playableIds.has(c.id)).length;
              const notes = [
                never ? `${never} never dealt` : "", rare ? `${rare} rarely dealt` : "", unplayed ? `${unplayed} dealt, never played` : "",
              ].filter(Boolean).join(", ");
              io.log("");
              io.log(`${deckLabel(cards[0]!)}${notes ? `  (${notes})` : ""}`);
              io.log(heading);
              for (const c of cards) cardRow(c, false);
            }
          }
          io.log("");
        }
        for (const o of report.outcomes.filter((x) => x.played === 0)) {
          io.log(`never played: ${cardById.get(o.card)?.gameId}/${o.gameId}`);
        }
        // The composed-name net: evaluation faults there, so the content
        // silently never deals from those hands - worth a line each. On
        // stderr, where every other command's warnings go.
        for (const u of report.unprovidedHandRefs) {
          io.error(`unprovided: ${u.where} uses ${u.ref}, which ${u.hands.join(", ")} never composes`);
        }
        for (const d of report.diagnostics) {
          io.error(`warning (${d.runs}/${report.runs} runs): ${d.where}: ${d.message}`);
        }
      }
      const gap = report.cards.some((c) => c.dealt === 0)
        || report.unprovidedHandRefs.length > 0 || report.diagnostics.length > 0;
      return flags["fail-on-gap"] === true && gap ? 1 : 0;
    }
  }
}
