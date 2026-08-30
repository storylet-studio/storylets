// ---------------------------------------------------------------------------
// The playable export: a single self-contained `.html` file that plays the
// project in any browser, with no engine, no server and no install (parity
// audit 9.3). The Storylet Engine runtime, the Board demo as a player, and
// the compiled bundle are all inlined, so the file opens from disk and makes
// no request. Hand one file to anyone and it plays.
//
// The bundle is compiled from the loaded source with `metadata: full`
// whatever the project's own setting says: a page for people shows titles
// and purposes, and stripping them is a shipping concern, not a playing one.
// Patter's export-html.ts, in the card-shaped idiom.
// ---------------------------------------------------------------------------

import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { compileProject, serialiseBundle, spatialGroups } from "@storylet-studio/compiler";
import type { Issue, SourceProject, SpatialGroup } from "@storylet-studio/compiler";
import { effectiveGameId, handBinding, labelPoint } from "@storylet-studio/model";
import { assetPath } from "./assets.js";
import type { LoadedProject } from "./load.js";
import { sharedSpaces } from "./spaces.js";
import { mapSites } from "./view.js";
import { PLAYABLE_PLAYER_JS } from "./playable-player.js";

export interface ExportHtmlResult {
  issues: Issue[];
  /** The whole page; absent when the project does not compile. */
  html?: string;
}

// --- the maps the page draws ---------------------------------------------------
// The playable page is for people who are NOT the designer, exploring the
// running project - and a drawn map is how a stranger reads the world. Zones,
// placed hands and the background pictures all travel IN the page (pictures as
// data URIs), keeping the export's one promise: one file, no requests.
//
// A deliberate departure from Patter's playable page, argued in
// design/playable-maps.md: Patter ships source-only and substitutes reading
// pace for its (heavy, per-line) audio; a map's picture has no substitute and
// costs megabytes, not tens of them.

export interface PlayableMap {
  /** The box that carries the geometry (the first member, for a shared space). */
  box: string;
  boxTitle?: string;
  /** EVERY box this map speaks for: one entry normally; several when boxes
   *  share the same place (sharedSpaces) and the page draws it once. */
  boxes: string[];
  group: string;
  zones: { tag: string; polygon: { x: number; y: number }[]; label: { x: number; y: number } }[];
  backgrounds: { src: string; x: number; y: number; width: number; height: number; opacity?: number }[];
  sites: { hand: string; label: string; box: string; x: number; y: number; zone?: string }[];
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif",
};

/** How a map's background pictures travel.
 *
 *  `inline` is the playable page's promise: one file, no requests, so every
 *  picture is a data URI. `byName` is for a client that ships as a FOLDER (the
 *  Village sample): `src` is the picture's file name and the caller copies the
 *  box's `assets/` beside the page. The derivation is otherwise identical, and
 *  it stays one derivation deliberately - "where is a site on the map" is the
 *  kind of question that gets answered twice and then differently. */
export interface PlayableMapOptions {
  pictures?: "inline" | "byName";
}

export function playableMaps(
  loaded: LoadedProject, issues: Issue[], opts: PlayableMapOptions = {},
): PlayableMap[] {
  const source = loaded.source!;
  const maps: PlayableMap[] = [];
  // Boxes sharing the same place draw it ONCE, every member's hands on it
  // (the author's ruling: they should feel like the same space, not three
  // repetitions). The first member carries the geometry and pictures; later
  // members contribute their pins and emit no map of their own.
  const spaces = sharedSpaces(source);
  const memberOf = new Map<string, { boxes: string[]; first: boolean }>();
  for (const space of spaces) {
    space.boxes.forEach((b, i) => memberOf.set(`${b}|${space.group}`, { boxes: space.boxes, first: i === 0 }));
  }
  /** One box's placed hands as playable sites, bound against ITS OWN copy of
   *  the group (each member box has its own group instance and ids). */
  const sitesOf = (boxGameId: string, groupGameId: string): PlayableMap["sites"] => {
    const box = source.boxes.find((b) => effectiveGameId(b.box.box) === boxGameId);
    if (!box) return [];
    const group = box.tags.groups.find((g) => effectiveGameId(g) === groupGameId);
    if (!group) return [];
    const placed = mapSites(box);
    const sites: PlayableMap["sites"] = [];
    for (const hand of box.hands.hands) {
      const at = placed[hand.id];
      if (!at) continue;
      const template = box.hands.templates.find((t) => t.id === hand.template);
      const binding = handBinding(hand, template, group.id);
      sites.push({
        hand: effectiveGameId(hand), label: hand.title ?? effectiveGameId(hand),
        box: boxGameId, x: at.x, y: at.y,
        ...(binding.kind !== "none" && binding.tag !== undefined ? { zone: binding.tag } : {}),
      });
    }
    return sites;
  };
  for (const g of spatialGroups(source)) {
    {
      // The zones come from the shared walk; the page adds a LABEL point per
      // zone, which the bundle has no use for. The Board's own rule (model
      // labelPoint, bias top): the MIDDLE of a zone is where its sites stand,
      // so a name there collides with the very pins the zone contains.
      const zones: PlayableMap["zones"] = g.zones.map((z: SpatialGroup["zones"][number]) => {
        const at = labelPoint(z.polygon, { bias: "top" });
        return { ...z, label: { x: at.x, y: at.y } };
      });
      const backgrounds: PlayableMap["backgrounds"] = [];
      for (const b of g.backgrounds) {
        const full = assetPath(loaded.dir, g.box, b.file);
        let src: string | undefined;
        try {
          if (full !== undefined) {
            const mime = MIME[extname(b.file).toLowerCase()];
            // `byName` still READS nothing but still proves the file is there,
            // so a picture that is declared and missing warns in both modes
            // rather than only in the one that happens to open it.
            if (mime !== undefined && opts.pictures === "byName") src = statSync(full).isFile() ? b.file : undefined;
            else if (mime !== undefined) src = `data:${mime};base64,${readFileSync(full).toString("base64")}`;
          }
        } catch { /* missing on disk: warned below */ }
        if (src === undefined) {
          issues.push({ severity: "warning", path: g.box.path, where: g.groupGameId,
            message: `map picture "${b.file}" could not be read; the page ships without it` });
          continue;
        }
        backgrounds.push({ src, x: b.x, y: b.y, width: b.width, height: b.height,
          ...(b.opacity !== undefined ? { opacity: b.opacity } : {}) });
      }
      // Checked AGAIN, because this page can lose backgrounds the shared walk
      // kept: a picture that is declared, visible and unreadable on disk is
      // dropped just above. A group left with nothing at all is not drawn.
      if (zones.length === 0 && backgrounds.length === 0) continue;
      const boxGameId = g.boxGameId;
      const groupGameId = g.groupGameId;
      const membership = memberOf.get(`${boxGameId}|${groupGameId}`);
      if (membership !== undefined && !membership.first) continue;   // drawn by the first member
      const speaks = membership?.boxes ?? [boxGameId];
      maps.push({
        box: boxGameId,
        ...(g.box.box.box.title !== undefined ? { boxTitle: g.box.box.box.title } : {}),
        boxes: speaks,
        group: groupGameId, zones, backgrounds,
        sites: speaks.flatMap((member) => sitesOf(member, groupGameId)),
      });
    }
  }
  return maps;
}

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

/** The suggested file name: the project's name, with path-hostile characters
 *  folded to spaces (the spreadsheet's rule, and Patterpad's safeStem). */
export function playableFileName(source: SourceProject): string {
  const stem = source.project.project.name.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${stem || "project"}.html`;
}

/** The demo page's look (packages/play-helpers/demo/index.html), minus the
 *  examiner columns: self-contained, neutral, readable on a phone. */
const STYLE = String.raw`
  :root { --ink: #1d1f21; --surface: #fff; --line: #ccc; --muted: #666; --page: #f2f2f0; color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px 20px 24px; font: 14px system-ui, sans-serif;
         color: var(--ink); background: var(--page); }
  .wrap { max-width: 40rem; margin: 0 auto; }

  /* With a map the page becomes a stage: the map takes the left of the
     screen, big and sticky, and the lists keep a column on the right -
     the Board's own Map view, translated to a page. */
  body.has-map .wrap { max-width: 78rem; display: grid;
                       grid-template-columns: minmax(0, 1fr) minmax(22rem, 27rem);
                       gap: 20px; align-items: start; }
  body.has-map #mappane { position: sticky; top: 16px; height: calc(100vh - 40px);
                          display: flex; flex-direction: column; min-width: 0; }
  #mapbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  #mappicker { font-size: 12px; color: var(--muted); }
  #mappicker select { font: inherit; padding: 2px 4px; }
  #mapnav { margin-left: auto; display: flex; gap: 4px; }
  #mapnav button { font: inherit; font-size: 12px; min-width: 26px; padding: 2px 8px; cursor: pointer;
                   border: 1px solid var(--line); border-radius: 5px; background: #fff; }
  #mapnav button:hover { background: #eee; }
  #mapview { flex: 1; min-height: 0; }
  #mapview .bd-map { width: 100%; height: 100%; touch-action: none; cursor: grab; }
  #mapview .bd-map.bd-panning { cursor: grabbing; }
  @media (max-width: 900px) {
    body.has-map .wrap { display: block; max-width: 40rem; }
    body.has-map #mappane { position: static; height: 48vh; margin-bottom: 12px; }
  }
  header { display: flex; align-items: baseline; gap: 0.75rem; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  header .by { color: var(--muted); font-size: 11px; margin-left: auto; }
  #header-line { font: 12px ui-monospace, monospace; color: var(--muted); margin-bottom: 14px; }

  .bd-hand { background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
             padding: 8px 10px; margin-bottom: 10px; }
  .bd-hand-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
                   color: var(--muted); margin: 0 0 6px; }
  .bd-empty { font: 12px ui-monospace, monospace; color: var(--muted); }
  .bd-card-row { margin: 2px 0 4px; }
  .bd-card { font: inherit; font-size: 13px; text-align: left; padding: 4px 10px; cursor: pointer;
             border: 1px solid var(--line); border-radius: 5px; background: #fff; }
  .bd-card:hover { background: #eee; }
  .bd-card-open { border-color: #888; background: #ebebe8; }
  .bd-outcomes { display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
                 margin: 4px 0 2px 16px; }
  .bd-outcome { font: inherit; font-size: 12px; text-align: left; padding: 2px 8px; cursor: pointer;
                border: 1px solid var(--line); border-radius: 5px; background: #fafafa; }
  .bd-outcome:hover:enabled { background: #eee; }
  .bd-outcome:disabled { color: var(--muted); cursor: default; opacity: 0.6; }

  #controls { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 10px; }
  .bd-control { font: inherit; font-size: 12px; padding: 4px 10px; cursor: pointer;
                border: 1px solid var(--line); border-radius: 5px; background: #fff; }
  .bd-control:hover { background: #eee; }

  #transcript { font: 11px ui-monospace, monospace; background: #fff; border: 1px solid var(--line);
                border-radius: 6px; padding: 6px 8px; height: 9rem; overflow: auto;
                white-space: pre-wrap; }

  .bd-box-head { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em;
                 color: var(--muted); margin: 16px 0 8px; }
  .bd-map { display: block; background: #fff;
            border: 1px solid var(--line); border-radius: 8px; }
  .bd-zone { fill-opacity: 0.10; stroke-opacity: 0.65; stroke-width: 2; }
  .bd-zone-label { font: 600 13px system-ui, sans-serif; fill: #444; opacity: 0.75; }
  .bd-pin { cursor: pointer; }
  .bd-pin-ring { fill: #fff; }
  .bd-pin-count { font: 700 12px system-ui, sans-serif; fill: var(--ink); text-anchor: middle; }
  .bd-pin-name { font: 12px system-ui, sans-serif; fill: #333; text-anchor: middle;
                 paint-order: stroke; stroke: #fff; stroke-width: 3px; }
  .bd-hand.bd-found { outline: 2px solid #888; transition: outline 0.2s; }
`;

/**
 * Build the playable page for the loaded project. Pure: returns the file's
 * text; the caller writes it (the CLI to `-o` or beside the bundle, the
 * editor through a Save dialog).
 */
export function runExportHtml(loaded: LoadedProject): ExportHtmlResult {
  if (!loaded.source) return { issues: loaded.issues };
  const source: SourceProject = {
    ...loaded.source,
    project: { ...loaded.source.project, export: { ...loaded.source.project.export, metadata: "full" } },
  };
  const { bundle, issues } = compileProject(source);
  const all = [...loaded.issues, ...issues];
  if (!bundle) return { issues: all };

  const title = source.project.project.name.trim() || "A Storylet Studio project";
  // Every `<` in the JSON is escaped, so the data cannot close the <script> it sits in.
  const bundleJson = serialiseBundle(bundle).trimEnd().replace(/</g, "\\u003c");
  const mapsJson = JSON.stringify(playableMaps(loaded, all)).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <aside id="mappane" hidden>
    <div id="mapbar"><span id="mappicker"></span><span id="mapnav"></span></div>
    <div id="mapview"></div>
  </aside>
  <div id="col">
    <header>
      <h1>${esc(title)}</h1>
      <span class="by">Storylet Studio</span>
    </header>
    <div id="header-line"></div>
    <div id="board"></div>
    <div id="controls"></div>
    <div id="transcript"></div>
  </div>
</div>
<script>window.STORYLET_BUNDLE=${bundleJson};</script>
<script>window.STORYLET_MAPS=${mapsJson};</script>
<script>${PLAYABLE_PLAYER_JS}</script>
</body>
</html>
`;
  return { issues: all, html };
}
