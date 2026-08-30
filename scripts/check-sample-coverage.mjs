// Verify the Village client still teaches the API it claims to teach, and that
// everything it does NOT teach was a decision rather than an oversight.
//
// Why this exists, and why a typecheck is not enough:
//
//   `packages/village-client` is a sample: its job is to be READ. Four gates
//   already stop it BREAKING - the root typecheck compiles it against the
//   runtime's source, CI builds it, a jsdom test plays it, and the website
//   build needs it. None of them notice the failure a sample actually dies of,
//   which is going STALE: compiling, passing, playing, and quietly teaching two
//   thirds of an API that grew underneath it. Nothing goes red. It just stops
//   being the answer to "how do I use this".
//
//   So this asks the other question. Every public member of the runtime and the
//   play-helpers is either DEMONSTRATED by the client, or listed below as
//   deliberately not, with a why. A member that is neither fails. Adding an API
//   to the runtime therefore forces a one-line decision about the sample in the
//   commit that adds it, which is the only moment anyone knows the answer.
//
//   It is check-runtime-api-parity.mjs one layer up: that asks whether four
//   runtimes agree about what they have, this asks whether the sample still
//   shows what there is to show.
//
// THE SURFACE IS DERIVED, NOT RESTATED. A second hand-written list of the API
// would rot exactly as fast as the sample does, and would then hide the rot.
// The public members come from `packages/runtime/src/index.ts`,
// `packages/play-helpers/src/index.ts` and the `@internal`-aware class scan of
// `engine.ts`. Only the OMISSIONS are written by hand, because a reason cannot
// be derived from anything.
//
// AND IT CHECKS BOTH WAYS, three times over:
//   - a member that is used but has no README row  -> the table has rotted
//   - a README row naming something not used       -> the table is lying
//   - an omission that turns out to be used        -> the reason is stale
//   - an omission naming a member that is gone     -> the list has rotted
// Every one of those is a way for this file to become the thing it is guarding
// against, so each is a failure rather than a warning.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const SAMPLE_SRC = "packages/village-client/src";
const SAMPLE_README = "packages/village-client/README.md";

// ---------------------------------------------------------------------------
// The omissions: what the Village client deliberately does not show, and why.
//
// A game is not a test harness, so most of these are "a game has no use for
// it", and saying so is the point: a reader who wants that member learns here
// that the sample is not where to look, and is told where is.
// ---------------------------------------------------------------------------
const OMITTED = [
  // --- flows: the author's ruling, 2026-08-30 -------------------------------
  // The client DOES open its one flow (there is no default flow to inherit),
  // so `openFlow` is demonstrated - and so is `getFlow`, because a LOAD rebuilds
  // the flows and the handle held across it is inert. What is omitted is the
  // multi-flow half: a second flow, closing one, listing them.
  { member: "closeFlow", why: "flows: nothing here closes a flow, because nothing here opens a second one. Same ruling" },
  { member: "flows", why: "flows: a list of one is not a demonstration. Same ruling" },
  { member: "Flow", why: "a game never CONSTRUCTS a flow: `openFlow` hands you one, and `getFlow` hands it back after a load. The class is exported for its type and for the ports" },
  { member: "close", why: "flows: the flow lives as long as the tab does" },
  { member: "isClosed", why: "flows: a handle that is never closed is never inert" },
  { member: "id", why: "flows: the client has one flow and a name for it already" },

  // --- the designer's instruments, which a shipped game does not mount ------
  { member: "subscribeTrace", why: "an editor facility: the Board and Live Link watch a run being played, a game just plays it. Demonstrated in Storyletter's Board and in packages/play-helpers/demo" },
  { member: "createLiveLink", why: "an editor facility by definition - it connects a running game to the EDITOR. A shipped game has no editor to talk to" },
  { member: "boardFrame", why: "part of the Live Link protocol, same reason" },
  { member: "applyLiveBundle", why: "Live Link's hot-reload half, same reason" },
  { member: "createPropertyInspector", why: "a debug examiner mounted beside a board. The client shows state the way a GAME does, so the examiners stay in packages/play-helpers/demo where they belong" },
  { member: "createBundleInspector", why: "same: an examiner, not a game surface" },
  { member: "ensureInspectorStyle", why: "belongs to the inspectors above" },
  { member: "formatLogEntry", why: "belongs to the inspectors above" },
  { member: "formatPropertySummary", why: "belongs to the bundle inspector" },
  { member: "formatScopeLabel", why: "belongs to the bundle inspector" },
  { member: "createStateLogger", why: "a diagnostic that watches state change so a developer can see it. The journal is the game's version of that idea, written from what was played rather than from property diffs" },
  { member: "createKernelStateLogger", why: "the lower-level half of the state logger, same reason" },
  { member: "snapshotState", why: "part of the state logger's machinery" },
  { member: "diffState", why: "part of the state logger's machinery" },

  // --- doors a game should not go through -----------------------------------
  { member: "setProperty", why: "DELIBERATE TEACHING: a game changes state by PLAYING an outcome, never by writing @story behind the engine's back. The door exists for hosts driving @world, and the Village has no @world" },
  { member: "peek", why: "asks what WOULD be dealt without dealing it, which is an editor and tooling question (Storyletter's Board uses it). A game deals" },
  { member: "listBags", why: "the mounted property bags: an integrator's introspection, not a player's" },
  { member: "reset", why: "the client restarts by building a fresh Engine, which is what a game does when you start again. `reset` is for a host that must keep the same object" },

  // --- the same thing, one layer down ---------------------------------------
  { member: "saveGame", why: "the engine's own envelope. The client goes through play-helpers' serializeState, which is the door a game should use and which wraps this" },
  { member: "loadGame", why: "the read half of the same pair, wrapped by deserializeState" },
  { member: "saveState", why: "the object half of the save pair. What a browser has in localStorage is TEXT, so the client shows serializeState; saveState / loadState are in the play-helpers README" },
  { member: "loadState", why: "same pair, same reason" },
  { member: "log", why: "the run log is a diagnostic. The client writes a journal from what it played, which is what a game shows a player" },
  { member: "clearLog", why: "belongs to the run log" },

  // --- engine internals exposed for ports and tests --------------------------
  { member: "makePrng", why: "the seeded PRNG is the engine's own; a game passes a seed and lets it get on with it" },
  { member: "shuffleInPlace", why: "an internal of the deal, exported for the ports and the corpus" },
  { member: "createWorldContainer", why: "@world is the HOST game's state and the Village has none - every property it moves is @story, @deck or @hand. A client with world state is the Port Meridian demo's job" },
];

// ---------------------------------------------------------------------------
// Deriving the public surface.
// ---------------------------------------------------------------------------

/** Value exports of a barrel file: `export { a, b } from "./x.js"`, minus the
 *  `export type` lines, which are not callable and not teachable. */
function barrelExports(path) {
  const src = read(path);
  const names = [];
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    // `export type { ... }` is skipped by the regex above needing `export {`.
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/** The public members of a class in engine.ts: every declaration at the class's
 *  own indent whose doc comment does not say `@internal`. Derived, so a member
 *  added tomorrow is asked about tomorrow. */
function classMembers(src, className) {
  const start = src.indexOf(`export class ${className} {`);
  if (start === -1) throw new Error(`no class ${className}`);
  const lines = src.slice(start).split("\n");
  const members = [];
  let doc = "";
  let depth = 0;
  for (const line of lines) {
    if (/^\s*\/\*\*/.test(line)) doc = line;
    else if (doc && /^\s*\*/.test(line)) doc += line;
    const before = depth;
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (before > 0 && depth === 0) break; // class closed
    const m = /^ {2}(?:get\s+|readonly\s+)?([a-zA-Z][A-Za-z0-9_]*)\s*[(:]/.exec(line);
    if (m && before === 1) {
      const name = m[1];
      const internal = /@internal/.test(doc);
      if (!internal && name !== "constructor") members.push(name);
    }
    if (/^\s*\*\//.test(line)) { /* doc ends; keep it for the next line */ }
    else if (!/^\s*[/*]/.test(line)) doc = "";
  }
  return members;
}

const engineSrc = read("packages/runtime/src/engine.ts");
const surface = new Map(); // member -> the object it lives on, for the report
const note = (name, on) => { if (!surface.has(name)) surface.set(name, on); };

for (const n of barrelExports("packages/runtime/src/index.ts")) note(n, "runtime");
for (const n of barrelExports("packages/play-helpers/src/index.ts")) note(n, "play-helpers");
for (const n of classMembers(engineSrc, "Engine")) note(n, "Engine");
for (const n of classMembers(engineSrc, "Flow")) note(n, "Flow");
// The exported CLASSES are part of the surface too, and a class is
// demonstrated by being CONSTRUCTED. Derived rather than listed, so a new
// exported class is asked about the day it appears.
const classes = new Set([...engineSrc.matchAll(/^export class (\w+)/gm)].map((m) => m[1]));
for (const name of classes) if (surface.has(name)) surface.set(name, "class");

// ---------------------------------------------------------------------------
// What the sample actually uses, and what its README claims.
// ---------------------------------------------------------------------------
const walk = (dir) => (existsSync(join(root, dir))
  ? readdirSync(join(root, dir)).flatMap((name) => {
      const rel = `${dir}/${name}`;
      return statSync(join(root, rel)).isDirectory() ? walk(rel) : (rel.endsWith(".ts") ? [rel] : []);
    })
  : []);

const sampleFiles = walk(SAMPLE_SRC);
if (sampleFiles.length === 0) {
  console.error(`check-sample-coverage: no sources under ${SAMPLE_SRC}.

This is the contract for a client that does not exist yet (design/village-client.md
section 9 builds it in this order deliberately). It fails until the sample is there,
which is the point: a guard that has never failed has never been shown to work.`);
  process.exit(1);
}
const sampleSrc = sampleFiles.map(read).join("\n");

/** Is this member DEMONSTRATED by the client?
 *
 *  A class member is matched on its RECEIVER (`engine.x` / `flow.x`), not by
 *  its bare name, because half of them collide with ordinary field names: a
 *  bare `\bid\b` matches `card.id` and would report `Flow.id` as demonstrated
 *  by a client that never touches it, and `\boutcomes\b` matches the local
 *  variable holding them. So the sample owes this file one small convention -
 *  it calls its engine `engine` and its flow `flow` - which a sample wants
 *  anyway, and which the failure message says out loud. Module exports are
 *  distinctive enough to match bare. */
const uses = (member, on) => {
  if (on === "class") return new RegExp(`new ${member}\\(`).test(sampleSrc);
  if (on === "Engine" || on === "Flow") return new RegExp(`\\b(engine|flow)\\.${member}\\b`).test(sampleSrc);
  return new RegExp(`\\b${member}\\b`).test(sampleSrc);
};

/** The README's API table: rows of `| \`member\` | what it shows |`. */
const readmeRows = new Set();
if (existsSync(join(root, SAMPLE_README))) {
  for (const m of read(SAMPLE_README).matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9_.]*)`\s*\|/gm)) {
    readmeRows.add(m[1].split(".").pop());
  }
}

// ---------------------------------------------------------------------------
// The four ways this can be wrong.
// ---------------------------------------------------------------------------
const omitted = new Map(OMITTED.map((o) => [o.member, o.why]));
const problems = [];

for (const [member, on] of surface) {
  const used = uses(member, on);
  const skipped = omitted.has(member);
  if (!used && !skipped) {
    problems.push(`  ${on}.${member}  ->  NEITHER demonstrated nor listed as omitted.`
      + `\n      Show it in the client, or add it to OMITTED in this file with a why.`
      + (on === "Engine" || on === "Flow"
        ? `\n      (A class member counts when it is called on \`engine.\` or \`flow.\` - see the note on \`uses\`.)` : ""));
  }
  if (used && skipped) {
    problems.push(`  ${on}.${member}  ->  listed as OMITTED, but the client uses it. The reason is stale:`
      + `\n      "${omitted.get(member)}"`);
  }
  if (used && !readmeRows.has(member)) {
    problems.push(`  ${on}.${member}  ->  used by the client but absent from the README's API table.`
      + `\n      The table is what a reader is pointed at; a call it does not list is a call nobody finds.`);
  }
}

for (const { member } of OMITTED) {
  if (!surface.has(member)) {
    problems.push(`  ${member}  ->  listed as OMITTED but no longer part of the public surface.`
      + `\n      Drop the row: an omission for something that does not exist teaches nothing.`);
  }
}

for (const row of readmeRows) {
  if (!surface.has(row)) {
    problems.push(`  ${row}  ->  the README's API table names it, but it is not a public member.`);
  } else if (!uses(row, surface.get(row))) {
    problems.push(`  ${row}  ->  the README's API table claims the client shows it, and the client does not.`);
  }
}

if (problems.length) {
  console.error("Village client API coverage FAILED:\n");
  console.error(problems.join("\n"));
  console.error(`\nThe sample's job is to stay the answer to "how do I use this". See design/village-client.md section 6.`);
  process.exit(1);
}

const shown = [...surface].filter(([m, on]) => uses(m, on)).length;
console.log(`Village client API coverage OK - ${shown} of ${surface.size} public members demonstrated, `
  + `${OMITTED.length} deliberately omitted (each with a why), README table agrees.`);
