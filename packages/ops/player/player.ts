// ---------------------------------------------------------------------------
// The playable page's script: the Board demo (packages/play-helpers/demo)
// as a player, over a bundle the page carries inline.
//
// Same board, same controls in the same order, same transcript grammar as
// the demo the four runtimes ship: every hand is a labelled group of card
// buttons, clicking a card reveals its outcomes, clicking an available
// outcome plays it, Deal all hands / Next turn / Restart. What differs is
// what a page handed to a player needs: the bundle comes from
// window.STORYLET_BUNDLE rather than a fetch (so the file opens from disk),
// there are no examiners beside the board (Patter's playable page ships no
// inspector either), and the player's place is kept in that browser
// (localStorage, the runtime's own save envelope) so closing the tab is not
// losing the game. Restart clears it.
//
// Bundled into packages/ops/src/playable-player.ts by
// scripts/gen-player-blob.mjs; runExportHtml inlines that string.
// ---------------------------------------------------------------------------
/// <reference lib="dom" />

import { SAVE_SCHEMA } from "@storylet-studio/model";
import type { Bundle, PropertyBag, SaveEnvelope } from "@storylet-studio/model";
import { Engine, describeBundle } from "@storylet-studio/runtime";
import type { DealtCard, Flow, OutcomeView } from "@storylet-studio/runtime";

/** The maps the page carries beside the bundle (export-html.ts builds them:
 *  zones, placed hands, and the background pictures as data URIs). The page
 *  is for people who are NOT the designer, and a drawn map is how a stranger
 *  reads the world. */
interface PlayableMap {
  box: string;
  boxTitle?: string;
  /** Every box this map speaks for: several = a shared space, drawn once. */
  boxes: string[];
  group: string;
  zones: { tag: string; polygon: { x: number; y: number }[]; label: { x: number; y: number } }[];
  backgrounds: { src: string; x: number; y: number; width: number; height: number; opacity?: number }[];
  sites: { hand: string; label: string; box: string; x: number; y: number; zone?: string }[];
}

/** Seed 7: the Board demo's session, identical in all four runtimes. */
const SEED = 7;
/** What an empty hand says, on the board and in the transcript. */
const NOTHING = "(nothing here right now)";

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`no #${id}`);
  return el;
};

const named = (title: string | undefined, gameId: string): string => title ?? gameId;

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// --- the board's own state ---------------------------------------------------

let bundle: Bundle;
let identity = "";
let engine: Engine;
let session: Flow;
/** The page IS the host, so it owns the @world container (design/flows.md):
 *  the engine reads and writes it through this resolver and never saves it -
 *  the page saves it beside the envelope. */
let worldValues: PropertyBag = {};
const freshWorld = (): void => {
  worldValues = {};
  for (const d of bundle.world.properties) worldValues[d.name] = d.default;
};
const worldResolver = {
  get: (n: string) => worldValues[n],
  set: (n: string, v: PropertyBag[string]) => { worldValues[n] = v; },
};
const freshEngine = (): void => {
  freshWorld();
  engine = new Engine(bundle, { seed: SEED, world: worldResolver });
  session = engine.openFlow("main");
};
/** Hand gameId -> title-or-gameId: board() and dealMany() key by gameId. */
const handNames = new Map<string, string>();
/** The boxes in bundle order, and each box's hands, for the board's sections. */
let boxOrder: { gameId: string; title?: string }[] = [];
const handsByBox = new Map<string, string[]>();
let maps: PlayableMap[] = [];
/** The one open card, if any: only ever one at a time. */
let open: { hand: string; card: string } | undefined;

// --- the player's place ------------------------------------------------------

/** Keyed by the content hash, so a republished page after an edit starts
 *  fresh rather than loading a place from a project that no longer exists. */
let saveKey = "";

/** What the page stores: the engine's envelope AND the page's own @world
 *  container - the host-saves-its-container rule, in miniature. */
interface PageSave {
  engine: SaveEnvelope;
  world: PropertyBag;
}

const persist = (): void => {
  try {
    localStorage.setItem(saveKey, JSON.stringify({ engine: engine.saveGame(), world: worldValues }));
  } catch {
    // Storage can be off or full; the game still plays, it just starts over next time.
  }
};

const forget = (): void => {
  try {
    localStorage.removeItem(saveKey);
  } catch {
    // as above
  }
};

/** The saved place, if there is one this page can use. A foreign or
 *  malformed blob is dropped rather than trusted. */
const recall = (): PageSave | undefined => {
  try {
    const raw = localStorage.getItem(saveKey);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    const page = parsed as PageSave;
    if (!parsed || typeof parsed !== "object" || page.engine?.schema !== SAVE_SCHEMA) {
      forget();
      return undefined;
    }
    return page;
  } catch {
    forget();
    return undefined;
  }
};

// --- the transcript ----------------------------------------------------------

const say = (text: string): void => {
  const transcript = $("transcript");
  const div = document.createElement("div");
  div.className = "tr-line";
  div.textContent = text;
  transcript.append(div);
  transcript.scrollTop = transcript.scrollHeight;
};

// --- the header line ---------------------------------------------------------

const renderHeader = (): void => {
  const clocks = session.listBoxes()
    .map((box) => `${named(box.title, box.gameId)} turn ${box.turn}`)
    .join(", ");
  $("header-line").textContent = `${identity} - ${clocks}`;
};

// --- the board ---------------------------------------------------------------

/** Play one outcome and move the board, or report the refusal. */
const playOutcome = (hand: string, card: DealtCard, outcome: OutcomeView): void => {
  try {
    session.play(card.id, outcome.gameId, hand);
  } catch (e) {
    say(`! ${message(e)}`);
    return;
  }
  say(`played "${named(card.title, card.gameId)}" -> ${named(outcome.title, outcome.gameId)}`);
  open = undefined;
  refill();
  persist();
};

/** The world moved, so the board does too: re-deal every hand, which fills
 *  the slots the play emptied and drops any card the new state invalidated.
 *  Silently, on purpose: the transcript keeps the beats you caused. */
const refill = (): void => {
  session.dealMany();
  renderHeader();
  renderBoard();
};

/** The revealed outcomes of one card: available ones clickable, unavailable
 *  ones still shown but disabled and labelled "(locked)". */
const renderOutcomes = (hand: string, card: DealtCard): HTMLElement => {
  const wrap = document.createElement("div");
  wrap.className = "bd-outcomes";
  for (const outcome of session.outcomes(card.id, hand)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bd-outcome";
    const label = named(outcome.title, outcome.gameId);
    button.textContent = outcome.available ? label : `${label} (locked)`;
    button.disabled = !outcome.available;
    if (outcome.available) {
      button.addEventListener("click", () => playOutcome(hand, card, outcome));
    }
    wrap.append(button);
  }
  return wrap;
};

// --- the map ----------------------------------------------------------------

const SVG = "http://www.w3.org/2000/svg";
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** A stable hue per zone name (Patter's hueOf, the editor's colour-by-name idea). */
const hueOf = (name: string): number => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
};

const centroid = (points: { x: number; y: number }[]): { x: number; y: number } => {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
};

/** Scroll the pinned hand's group into view and flash it: the pin is the
 *  stranger's way from the picture to the cards. */
const goToHand = (hand: string): void => {
  // The SECTION, by element: the pin itself carries the same data-hand and
  // comes first in the DOM, and a bare attribute selector found the pin -
  // which scrolled itself into its own view and flashed a class no CSS
  // matches on it. (jsdom has no scrollIntoView; the flash still shows.)
  const group = document.querySelector<HTMLElement>(`section[data-hand="${hand}"]`);
  if (!group) return;
  // Instant, not smooth: smooth scrolling is quietly dropped by some
  // embedded webviews, and the flash already says where you landed.
  group.scrollIntoView?.({ block: "center" });
  group.classList.add("bd-found");
  setTimeout(() => group.classList.remove("bd-found"), 1400);
};

/** One box's map as an inline SVG: pictures behind, zones over them, a pin
 *  per placed hand carrying its live card count. Scales to the column. */
const renderMap = (map: PlayableMap, held: Record<string, DealtCard[]>): SVGSVGElement => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number): void => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  for (const b of map.backgrounds) { grow(b.x, b.y); grow(b.x + b.width, b.y + b.height); }
  for (const z of map.zones) for (const p of z.polygon) grow(p.x, p.y);
  for (const s of map.sites) { grow(s.x - 40, s.y - 16); grow(s.x + 40, s.y + 34); }
  if (minX > maxX) { minX = 0; minY = 0; maxX = 100; maxY = 100; }
  const pad = 16;
  const svg = svgEl("svg", {
    class: "bd-map",
    viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
  });
  for (const b of map.backgrounds) {
    const image = svgEl("image", {
      x: b.x, y: b.y, width: b.width, height: b.height,
      ...(b.opacity !== undefined ? { opacity: b.opacity } : {}),
    });
    image.setAttribute("href", b.src);
    svg.append(image);
  }
  for (const z of map.zones) {
    const hue = hueOf(z.tag);
    svg.append(svgEl("polygon", {
      class: "bd-zone",
      points: z.polygon.map((p) => `${p.x},${p.y}`).join(" "),
      fill: `hsl(${hue} 60% 45%)`, stroke: `hsl(${hue} 60% 35%)`,
    }));
    // Where the exporter placed it (the Board's labelPoint, biased top):
    // never dead-centre, where the pins stand.
    const label = svgEl("text", { class: "bd-zone-label", x: z.label.x, y: z.label.y + 5, "text-anchor": "middle" });
    label.textContent = z.tag;
    svg.append(label);
  }
  const shared = map.boxes.length > 1;
  for (const site of map.sites) {
    const pin = svgEl("g", { class: "bd-pin" });
    pin.dataset["hand"] = site.hand;
    // A generous invisible halo first: the drawn pin is 11px and a finger is
    // not, and this page's whole audience is someone tapping around a world
    // they do not know yet.
    const halo = svgEl("circle", { cx: site.x, cy: site.y, r: 26 });
    halo.setAttribute("style", "fill: transparent; stroke: none");   // inline: the ring's CSS fill must not paint the halo
    pin.append(halo);
    // On a shared space, the pin's ring wears its box's hue - the quiet
    // answer to "whose pin is this?" on a picture four systems stand on.
    const ring = svgEl("circle", { cx: site.x, cy: site.y, r: 11, class: "bd-pin-ring" });
    ring.setAttribute("style", `stroke: ${shared ? `hsl(${hueOf(site.box)} 55% 42%)` : "#555"}; stroke-width: 2`);
    pin.append(ring);
    const count = svgEl("text", { class: "bd-pin-count", x: site.x, y: site.y + 4 });
    count.textContent = String((held[site.hand] ?? []).length);
    pin.append(count);
    const name = svgEl("text", { class: "bd-pin-name", x: site.x, y: site.y + 27 });
    name.textContent = site.label;
    pin.append(name);
    // A drag that happens to end on a pin is a pan, not a visit.
    pin.addEventListener("click", () => { if (dragDist <= 5) goToHand(site.hand); });
    svg.append(pin);
  }
  return svg;
};

// --- the map pane ------------------------------------------------------------
// The map is the page's stage: it takes the left of the screen, large and
// navigable (wheel or buttons to zoom, drag to pan), with the lists in a
// column beside it - the Board's own Map view, translated to a page. With
// several maps a picker chooses; the shared spaces come first.

/** The maps in pane order: shared spaces, then each box's own. */
let paneMaps: PlayableMap[] = [];
let mapPick = 0;
let mapSvg: SVGSVGElement | undefined;
/** The fitted viewBox (the whole world) and the one showing now. */
let fitBox = { x: 0, y: 0, w: 100, h: 100 };
let vb = { ...fitBox };
/** How far the pointer travelled in the last press: pans suppress pin clicks. */
let dragDist = 0;
/** Live count texts by hand, so a play updates them without redrawing (a
 *  redraw would throw away the zoom the player chose). */
const pinCounts = new Map<string, SVGTextElement>();

/** The Board's grammar - a map is named for its group ("Map of area") - with
 *  the box's name in front only when the page has several boxes to tell apart. */
const mapLabel = (map: PlayableMap): string => {
  if (map.boxes.length > 1) return map.group;
  return boxOrder.length > 1 ? `${named(map.boxTitle, map.box)}: ${map.group}` : map.group;
};

const applyView = (): void => {
  mapSvg?.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
};

/** Where a client point lands in map coordinates, letterboxing included. */
const mapPointAt = (clientX: number, clientY: number): { x: number; y: number } => {
  const r = mapSvg?.getBoundingClientRect?.();
  if (!r || r.width === 0 || r.height === 0) return { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 };
  const scale = Math.min(r.width / vb.w, r.height / vb.h);
  const ox = (r.width - vb.w * scale) / 2;
  const oy = (r.height - vb.h * scale) / 2;
  return { x: vb.x + (clientX - r.left - ox) / scale, y: vb.y + (clientY - r.top - oy) / scale };
};

/** Zoom about a map point: it stays put, everything else closes in. Never
 *  further out than the whole world, never in past a twentieth of it. */
const zoomAt = (at: { x: number; y: number }, factor: number): void => {
  const w = Math.min(fitBox.w, Math.max(fitBox.w / 20, vb.w / factor));
  const f = vb.w / w;
  vb = {
    x: at.x - (at.x - vb.x) / f,
    y: at.y - (at.y - vb.y) / f,
    w,
    h: vb.h / f,
  };
  applyView();
};

/** Wheel to zoom, press-and-drag to pan. Pointer events where the browser
 *  has them (that is every real one, and they carry touch); mouse events as
 *  the fallback. */
const wireZoom = (svg: SVGSVGElement): void => {
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(mapPointAt(e.clientX, e.clientY), Math.exp(-e.deltaY * 0.002));
  }, { passive: false });
  let panning = false;
  let lastX = 0, lastY = 0;
  const down = (x: number, y: number): void => {
    panning = true; dragDist = 0; lastX = x; lastY = y;
    svg.classList.add("bd-panning");
  };
  const move = (x: number, y: number): void => {
    if (!panning) return;
    const r = svg.getBoundingClientRect?.();
    if (!r || r.width === 0 || r.height === 0) return;
    const scale = Math.min(r.width / vb.w, r.height / vb.h);
    dragDist += Math.abs(x - lastX) + Math.abs(y - lastY);
    vb.x -= (x - lastX) / scale;
    vb.y -= (y - lastY) / scale;
    lastX = x; lastY = y;
    applyView();
  };
  const up = (): void => { panning = false; svg.classList.remove("bd-panning"); };
  if (typeof (window as { PointerEvent?: unknown }).PointerEvent === "function") {
    svg.addEventListener("pointerdown", (e) => down(e.clientX, e.clientY));
    svg.addEventListener("pointermove", (e) => {
      move(e.clientX, e.clientY);
      // Capture only once this is really a drag: capturing on the press
      // retargets the coming click to the svg, and the pins go deaf.
      if (panning && dragDist > 5) svg.setPointerCapture?.(e.pointerId);
    });
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
  } else {
    svg.addEventListener("mousedown", (e) => down(e.clientX, e.clientY));
    window.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
    window.addEventListener("mouseup", up);
  }
};

/** Draw the picked map into the pane, fitted, and remember its pins. */
const renderMapView = (): void => {
  const view = $("mapview");
  view.textContent = "";
  pinCounts.clear();
  const map = paneMaps[mapPick];
  if (map === undefined) return;
  const svg = renderMap(map, session.board());
  view.append(svg);
  mapSvg = svg;
  const parts = (svg.getAttribute("viewBox") ?? "0 0 100 100").split(" ").map(Number);
  fitBox = { x: parts[0]!, y: parts[1]!, w: parts[2]!, h: parts[3]! };
  vb = { ...fitBox };
  for (const pin of svg.querySelectorAll<SVGGElement>(".bd-pin")) {
    const count = pin.querySelector<SVGTextElement>(".bd-pin-count");
    const hand = pin.dataset["hand"];
    if (count !== null && hand !== undefined) pinCounts.set(hand, count);
  }
  wireZoom(svg);
};

/** The board moved: the visible pins take their new counts, the zoom stays. */
const updatePins = (held: Record<string, DealtCard[]>): void => {
  for (const [hand, count] of pinCounts) count.textContent = String((held[hand] ?? []).length);
};

/** Open the pane: the picker (a name when there is nothing to choose, the
 *  Board's grammar), the zoom buttons, the first map. */
const renderMapPane = (): void => {
  document.body.classList.add("has-map");
  ($("mappane") as HTMLElement).hidden = false;
  const picker = $("mappicker");
  if (paneMaps.length === 1) {
    picker.textContent = `Map of ${mapLabel(paneMaps[0]!)}`;
  } else {
    const sel = document.createElement("select");
    paneMaps.forEach((m, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = mapLabel(m);
      o.selected = i === mapPick;
      sel.append(o);
    });
    sel.addEventListener("change", () => { mapPick = Number(sel.value); renderMapView(); });
    picker.append(sel);
  }
  const nav = $("mapnav");
  const navBtn = (label: string, tip: string, onClick: () => void): void => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = tip;
    b.addEventListener("click", onClick);
    nav.append(b);
  };
  const centre = (): { x: number; y: number } => ({ x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 });
  navBtn("+", "Zoom in", () => zoomAt(centre(), 1.5));
  navBtn("−", "Zoom out", () => zoomAt(centre(), 1 / 1.5));
  navBtn("Fit", "Show the whole map", () => { vb = { ...fitBox }; applyView(); });
  renderMapView();
};

// --- the board ---------------------------------------------------------------

const renderHand = (hand: string, cards: DealtCard[]): HTMLElement => {
  const group = document.createElement("section");
  group.className = "bd-hand";
  group.dataset["hand"] = hand;
  const label = document.createElement("h2");
  label.className = "bd-hand-label";
  label.textContent = handNames.get(hand) ?? hand;
  group.append(label);

  if (cards.length === 0) {
    const empty = document.createElement("div");
    empty.className = "bd-empty";
    empty.textContent = NOTHING;
    group.append(empty);
    return group;
  }

  for (const card of cards) {
    const row = document.createElement("div");
    row.className = "bd-card-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bd-card";
    button.textContent = named(card.title, card.gameId);
    const isOpen = open !== undefined && open.hand === hand && open.card === card.id;
    if (isOpen) button.classList.add("bd-card-open");
    button.addEventListener("click", () => {
      open = isOpen ? undefined : { hand, card: card.id };
      renderBoard();
    });
    row.append(button);
    if (isOpen) row.append(renderOutcomes(hand, card));
    group.append(row);
  }
  return group;
};

/** The board column: box by box - a heading when there is more than one box
 *  (you cannot notice another box react if boxes are not visible as things),
 *  each box's hands under it. The maps live in the pane beside this column;
 *  the pins take their fresh counts here, without a redraw. */
const renderBoard = (): void => {
  const board = $("board");
  board.textContent = "";
  const held = session.board();
  for (const box of boxOrder) {
    if (boxOrder.length > 1) {
      const head = document.createElement("h2");
      head.className = "bd-box-head";
      head.textContent = named(box.title, box.gameId);
      board.append(head);
    }
    for (const hand of handsByBox.get(box.gameId) ?? []) {
      board.append(renderHand(hand, held[hand] ?? []));
    }
  }
  updatePins(held);
};

// --- the three controls ------------------------------------------------------

/** Deal every hand in one call, then say what each hand got. */
const dealAllHands = (): void => {
  for (const [hand, cards] of Object.entries(session.dealMany())) {
    const names = cards.map((card) => named(card.title, card.gameId));
    say(`dealt: ${handNames.get(hand) ?? hand} <- ${names.length > 0 ? names.join(", ") : NOTHING}`);
  }
  open = undefined;
  renderHeader();
  renderBoard();
};

/** Advance every box by one, in listBoxes() order. */
const nextTurn = (): void => {
  for (const box of session.listBoxes()) {
    session.advanceTurns(box.gameId);
    say(`turn ${named(box.title, box.gameId)} -> ${session.turn(box.gameId)}`);
  }
  refill();   // time passed: cooldowns lapse, so the hands refresh too
  persist();
};

/** Forget the saved place, build a fresh session, clear the transcript and
 *  deal: the clocks go back to 0 and the first hands come straight back out,
 *  so the board is never empty. Not persisted: a fresh session dealt once is
 *  exactly what the page does on its own when there is nothing saved. */
const restart = (): void => {
  forget();
  freshEngine();
  open = undefined;
  $("transcript").textContent = "";
  say(`restarted (seed ${SEED})`);
  dealAllHands();
};

const control = (label: string, onClick: () => void): void => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bd-control";
  button.textContent = label;
  button.addEventListener("click", () => {
    try {
      onClick();
    } catch (e) {
      say(`! ${message(e)}`);
    }
  });
  $("controls").append(button);
};

// --- start -------------------------------------------------------------------

const start = (): void => {
  const carried = (window as unknown as { STORYLET_BUNDLE?: Bundle }).STORYLET_BUNDLE;
  if (carried === undefined) throw new Error("the page carries no bundle");
  bundle = carried;

  // The description carries the identity and the hand titles the board
  // labels its groups with; no session needed.
  const description = describeBundle(bundle);
  identity = `v${description.identity.version}`;   // the name is the page's heading already
  saveKey = `storylets.play.${description.identity.project}.${description.identity.hash}`;
  boxOrder = description.boxes.map((box) => ({ gameId: box.gameId, ...(box.title !== undefined ? { title: box.title } : {}) }));
  for (const hand of description.hands) {
    handNames.set(hand.gameId, named(hand.title, hand.gameId));
    const list = handsByBox.get(hand.box) ?? [];
    list.push(hand.gameId);
    handsByBox.set(hand.box, list);
  }
  maps = (window as unknown as { STORYLET_MAPS?: PlayableMap[] }).STORYLET_MAPS ?? [];
  paneMaps = [...maps.filter((m) => m.boxes.length > 1), ...maps.filter((m) => m.boxes.length === 1)];

  freshEngine();

  if (paneMaps.length > 0) renderMapPane();

  control("Deal all hands", () => { dealAllHands(); persist(); });
  control("Next turn", nextTurn);
  control("Restart", restart);

  // A saved place takes over from the fresh session; the board shows the
  // hands as they were left. Otherwise the board opens dealt, as the demo
  // does, so there is something to read and play the moment the page loads.
  const saved = recall();
  if (saved !== undefined) {
    try {
      engine.loadGame(saved.engine);
      session = engine.getFlow("main") ?? engine.openFlow("main");
      worldValues = { ...worldValues, ...saved.world };
      say("(resumed where you left off)");
      renderHeader();
      renderBoard();
      return;
    } catch (e) {
      forget();
      say(`! could not resume: ${message(e)}`);
      freshEngine();
    }
  }
  dealAllHands();
};

try {
  start();
} catch (e: unknown) {
  say(`! startup failed: ${message(e)}`);
}
