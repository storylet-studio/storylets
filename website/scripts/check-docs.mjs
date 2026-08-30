// ---------------------------------------------------------------------------
// The two docs faults that build clean.
//
// Astro reports neither of these, which is the reason this file exists: a green
// build is what both of them look like.
//
// 1. A BLANK LINE INSIDE A RAW <svg>. Markdown ends an HTML block at the first
//    blank line, so the rest of the diagram is re-parsed as prose. The page
//    renders half a picture followed by a paragraph of loose SVG label text, and
//    nothing anywhere fails. Found on `concepts.md` and `format/shards.md` the
//    first time either was looked at in a browser.
//
// 2. A WORD RUN INTO A LINK. Astro collapses a newline between text and an
//    adjacent inline element to NOTHING, so a legal line broken over three
//    source lines for readability ships as "Made byIan Thomas". Both Footer
//    components carry a comment warning about this; the landing page did it
//    anyway, which is the argument for a check over a comment.
//
// 3. A DEAD INTERNAL LINK. Two were shipped in one pass: an anchor that never
//    existed, and a page that did not cover what the link claimed. Checked
//    against `dist/` rather than the source, because that is where the routing,
//    the slugs and the generated heading ids are all finally true.
//
// 4. A DOC THAT ENUMERATES A CLOSED VOCABULARY AND MISSES A MEMBER. The trace
//    verdicts are a union in the runtime and a contract across four ports, and
//    three separate pages list them in prose. Shared scarcity added two, and all
//    three lists went stale in one commit - including the page that EXPLAINS
//    both new verdicts higher up and then omits them from its own summary. A
//    list that claims to be complete can be checked against the source of
//    truth, so it is.
//
// 5. A LINK TO A DOMAIN THAT IS NOT OURS. The Unreal plugin shipped a
//    `storyletstudio.com` link (we are `storylet.studio`) in a README that goes
//    out inside the released plugin, where nothing here would ever have seen
//    it. One line to check, so it is checked repo-wide rather than in `dist/`.
//
// Runs as `postbuild`, so `npm run build` is the whole gate and there is nothing
// separate to remember.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

/** Every file under `dir` whose name ends in one of `exts`. */
function walk(dir, exts) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

// --- 1. blank lines inside a raw <svg> -------------------------------------
for (const file of walk(join(root, "src/content/docs"), [".md", ".mdx"])) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/<svg\b[\s\S]*?<\/svg>/g)) {
    if (!/\n[ \t]*\n/.test(m[0])) continue;
    const line = text.slice(0, m.index).split("\n").length;
    problems.push(
      `${relative(root, file)}:${line}  blank line inside <svg> - markdown will end the HTML ` +
      `block there and render the rest of the diagram as prose`,
    );
  }
}

// --- 1b. the voice rules ----------------------------------------------------
// Set by the 2026-08-21 language pass (design/website-language-audit.md): the
// site reads in PatterKit's register, for narrative designers, developers and
// leads. Three things creep back in silently and are cheap to refuse here:
//
//  - the DROP LIST: coined design-brief words that appeared in user docs and
//    were taken out ("the ask", "seat", "present truth", "look-versus-use"...);
//  - an EM-DASH, which this project never writes;
//  - the "it's" slips the contraction script made, where "it is" stood before
//    a comma or a gerund and the pronoun was an object ("installing it's
//    dropping", "how far along it's,").
//
// Prose only: fenced code, inline code and front matter are stripped first, so
// a real CLI output or an on-screen string the docs quote is never flagged.
const DROP = /\b(the ask|seated|seat|holes|standalone rule|look-versus-use|firing rule|audit hook|present truth|honesty net|feeders|shadowing|transliterat\w*|exclusivity model|authorial act|new-document moment)\b/i;
// (No end-of-line case: markdown is hard-wrapped, so "what it's" at a line end
// is usually "what it's for" continuing on the next line.)
// The gerund list is verbs, not every -ing word: "the thing it's about" is fine.
const SLIP = /\b(it's|there's)[,;:)]|\b(installing|dropping|keeping|making|using|running|reading|writing|opening|closing|bumping|adding|playing|dealing|editing|loading|saving|calling|putting|taking|leaving|having|doing|seeing|finding|getting|giving|pressing|clicking|choosing|picking|asking|checking|testing|publishing|exporting|importing|renaming|deleting|moving|dragging) it's\b|\bit's what makes\b/;
const prose = (text) =>
  text
    .replace(/^---[\s\S]*?\n---\n/, "")      // front matter
    .replace(/```[\s\S]*?```/g, "")          // fenced code
    .replace(/`[^`\n]*`/g, "")               // inline code
    .replace(/<svg\b[\s\S]*?<\/svg>/g, "");  // diagrams
for (const file of [...walk(join(root, "src/content/docs"), [".md", ".mdx"]), join(root, "src/pages/index.astro")]) {
  const lines = prose(readFileSync(file, "utf8")).split("\n");
  lines.forEach((l, i) => {
    if (l.includes("—")) problems.push(`${relative(root, file)}:${i + 1}  em-dash`);
    if (file.endsWith(".astro")) return;     // the landing's HTML comments use words like "seat" freely
    const d = l.match(DROP);
    if (d && !/player's seat/.test(l)) problems.push(`${relative(root, file)}:${i + 1}  drop-list word "${d[1]}" (see design/website-language-audit.md)`);
    if (SLIP.test(l)) problems.push(`${relative(root, file)}:${i + 1}  "it's" where "it is" was an object or clause end: ${l.trim().slice(0, 70)}`);
  });
}

const dist = join(root, "dist");
if (!existsSync(dist)) {
  console.error("check-docs: no dist/ - run the build first");
  process.exit(1);
}

// --- 2. text run into an adjacent link -------------------------------------
// Checked in the OUTPUT, because the fault is what the collapsing did, not what
// the source looked like. A letter or a `&middot;` hard against `<a ` is never
// deliberate in prose.
for (const file of walk(dist, [".html"])) {
  const html = readFileSync(file, "utf8");
  for (const m of html.matchAll(/([A-Za-z0-9]|&middot;|&nbsp;)<a\s/g)) {
    const ctx = html.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, " ");
    problems.push(`${relative(dist, file)}  text run into a link: ...${ctx}...`);
  }
}

// --- 3. dead internal links in the built site ------------------------------
/** The set of `id`/`name` anchors a built page offers. */
const anchors = (html) =>
  new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

const pageFor = (urlPath) => {
  const clean = urlPath.replace(/\/$/, "");
  // A literal file first: `/badges/x.svg` and the like are static assets copied
  // out of `public/`, and are perfectly good link targets that are not pages.
  for (const candidate of [join(dist, clean), join(dist, clean, "index.html"), join(dist, `${clean}.html`)]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
};

for (const file of walk(dist, [".html"])) {
  const html = readFileSync(file, "utf8");
  const from = relative(dist, file);
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const href = m[1];
    // Off-site, in-page-only and non-navigational hrefs are not ours to check.
    if (/^(https?:|mailto:|tel:|#|\/\/)/.test(href)) continue;
    if (!href.startsWith("/")) continue;
    const [path, hash] = href.split("#");
    const target = pageFor(path);
    if (!target) {
      problems.push(`${from}  -> ${href}  (no such page)`);
      continue;
    }
    if (hash && target.endsWith(".html") && !anchors(readFileSync(target, "utf8")).has(hash)) {
      problems.push(`${from}  -> ${href}  (page exists, anchor does not)`);
    }
  }
}

// --- 4. the closed vocabularies -----------------------------------------------
//
// `TraceVerdict` in the reference runtime is the source of truth. Any doc line
// that lists verdicts in backticks has to list all of them, or say plainly that
// it is showing only some.
const repoRoot = join(root, "..");
const engineSrc = readFileSync(join(repoRoot, "packages/runtime/src/engine.ts"), "utf8");
const verdictBlock = engineSrc.slice(engineSrc.indexOf("export type TraceVerdict ="));
const VERDICTS = [...verdictBlock.slice(0, verdictBlock.indexOf(";")).matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
if (VERDICTS.length < 5) problems.push("check-docs could not read TraceVerdict from the runtime (the check is inert)");

for (const file of walk(join(root, "src/content/docs"), [".md", ".mdx"])) {
  const text = readFileSync(file, "utf8");
  // By PARAGRAPH, not by line: these lists are prose and wrap, so a line is
  // half a list and would report the other half as missing.
  for (const para of text.split(/\n\s*\n/)) {
    // Three of the verdict names are also SHARD FIELD names, so a page about
    // the source format names them innocently. The trigger is therefore two or
    // more of the DISTINCTIVE verdicts - the ones that can only mean a verdict -
    // which is what an actual list always has and prose about `condition` never
    // does.
    // Two conditions, because either alone misfires. FIVE or more named, since
    // a real list names nearly all of them while prose contrasting one verdict
    // with another ("`claimed-elsewhere`, not `claimed`") names two. And at
    // least two DISTINCTIVE ones, because `tags`, `condition` and `priority`
    // are also shard field names, which a page about the source format
    // discusses innocently.
    const AMBIGUOUS = new Set(["tags", "condition", "priority"]);
    const named = VERDICTS.filter((v) => new RegExp("`" + v + "`").test(para));
    if (named.length < 5) continue;
    if (named.filter((v) => !AMBIGUOUS.has(v)).length < 2) continue;
    const missing = VERDICTS.filter((v) => !named.includes(v));
    if (missing.length > 0) {
      problems.push(`${relative(repoRoot, file)}  lists trace verdicts but omits: ${missing.join(", ")}`);
    }
  }
}

// --- 5. our own domain --------------------------------------------------------
//
// Checked over the shipped ports and packages too, not just the website: the
// one that got through was inside a plugin README.
const DOMAIN = /https?:\/\/(?!storylet\.studio)([a-z0-9-]*storylet[a-z0-9-]*\.[a-z.]+)/gi;
for (const dir of ["src/content/docs", "../packages", "../ports", "../design"]) {
  const base = join(root, dir);
  if (!existsSync(base)) continue;
  for (const file of walk(base, [".md", ".mdx"])) {
    if (file.includes("node_modules") || file.includes("/dist/")) continue;
    for (const m of readFileSync(file, "utf8").matchAll(DOMAIN)) {
      problems.push(`${relative(repoRoot, file)}  links to ${m[1]}, which is not storylet.studio`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\ncheck-docs: ${problems.length} problem(s)\n`);
  for (const p of [...new Set(problems)].sort()) console.error(`  ${p}`);
  console.error("");
  process.exit(1);
}
console.log(`check-docs: ok`);
