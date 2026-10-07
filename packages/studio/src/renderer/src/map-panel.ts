// ---------------------------------------------------------------------------
// The project map's side panel when something is SELECTED (the surfacing
// review's plan item 2, mock-up screens 2a and 2b): a hand shows what can come
// up there, a zone shows its properties, declared once, and everything every
// box on the map has in it.
//
// A hand's panel is the hand page's Cards tab in the panel's width: the same
// tiers (ops `placeTiers`, asked of main), the same card row, the same "+ New
// card here" and its deck picker (inspector.ts), so a hand reads the same from
// the map as from its own page. "Open" goes to that page. Under its title, what
// kind of hand it is in the designer's own words: its template's title.
//
// A zone's panel honours the layers: a box hidden on the map is hidden here
// too, and its share folds into one quiet line that shows those layers again.
// Hiding a layer is a FOCUS tool (the author, 2026-10-01), and a panel that
// still listed the hidden box would defeat it.
// ---------------------------------------------------------------------------

import { el, iconNode } from "@wildwinter/app-shell";
import { boxColour, boxPin } from "./box-tint.js";
import { handCardRow, openDeckPickerAcross, openDeckPickerFor } from "./inspector.js";
import { NEVER_LABEL, anywhereLine, movingNote, tierLabel } from "./hand-tiers.js";
import { zoneShareLine } from "./zone-share.js";
import { soloSharePointer } from "./solo-pointer.js";
import { shows } from "./play-ladder.js";
import { chipDot } from "./views.js";
import type {
  BoxDto, ConditionProperty, HandCardRef, HandCardsDto, MapZoneDetailDto, MapZonePropertyDto,
  ProjectMapLayerDto, ProjectMapSiteDto,
} from "../../shared/api.js";

export interface MapPanelHost {
  box: (id: string) => BoxDto | undefined;
  handCards: (box: string, hand: string) => Promise<HandCardsDto | null>;
  zone: (tagId: string) => Promise<MapZoneDetailDto | null>;
  /** A deck's condition catalogue, for a card row's `if` line. */
  catalogue: (deck: string) => Promise<ConditionProperty[]>;
  /** Open a card from the panel: a sideways arrival, with the way back to the
   *  map (and to the hand it was opened from). */
  openCard: (box: string, deck: string, card: string, from: string) => void;
  /** The hand's own page, on its Cards tab. */
  openHand: (box: string, hand: string) => void;
  /** Make a card in `deck` whose place is this hand, and open it. */
  newCardAt: (box: string, deck: string, hand: { id: string; title: string }) => void;
  /** The zone group's page, where every zone's properties are declared. */
  editZones: () => void;
  /** The boxes on the project map, in project order: every one of them can
   *  file a card to a zone. */
  mapBoxes: () => BoxDto[];
  /** Make a card in `deck` filed to this zone (anywhere in it), and open it. */
  newCardInZone: (box: string, deck: string, zone: { id: string; gameId: string }) => void;
}

/** Which request is the panel's latest, so a slow answer for a hand the author
 *  has already moved on from never paints over the one they are looking at. */
let painting = 0;

const pill = (name: string, label = name): HTMLElement => el("span", { className: "pill" }, chipDot(name), label);
const boxPill = (layer: { box: string; gameId: string; title?: string }): HTMLElement => {
  const dot = el("i");
  dot.style.background = boxColour(layer.box);
  return el("span", { className: "pill" }, dot, layer.title ?? layer.gameId);
};
const backRow = (back: () => void): HTMLElement =>
  el("button", { className: "btn mapside-back", tip: "Back to the layers", onClick: back }, iconNode("back", 12), "Layers");

/** Load the catalogues the rows need, one per deck that appears. */
async function catalogues(h: MapPanelHost, refs: HandCardRef[]): Promise<Map<string, ConditionProperty[]>> {
  const out = new Map<string, ConditionProperty[]>();
  await Promise.all([...new Set(refs.map((r) => r.deck))].map(async (d) => { out.set(d, await h.catalogue(d)); }));
  return out;
}

/** A selected HAND: what could come up there, tiered, and the way to add one. */
export function paintSitePanel(
  host: HTMLElement, h: MapPanelHost, layer: ProjectMapLayerDto, site: ProjectMapSiteDto,
  zoneName: string | undefined, back: () => void,
): void {
  const ticket = ++painting;
  const title = site.title ?? site.gameId;
  const head = el("div", { className: "mapside-headrow" },
    el("h3", { className: "mapside-h", text: title }),
    el("button", { className: "btn", text: "Open", tip: `Open ${title}'s page`, onClick: () => h.openHand(layer.box, site.id) }));
  const kind = site.kind !== undefined ? [el("p", { className: "mapside-kind", text: site.kind })] : [];
  const chips = el("div", { className: "mapside-chips" }, boxPill(layer), ...(zoneName !== undefined ? [pill(zoneName)] : []));
  const body = el("div", { className: "mapside-body" });
  host.replaceChildren(backRow(back), head, ...kind, chips, body);
  void (async () => {
    const tiers = await h.handCards(layer.box, site.id);
    const box = h.box(layer.box);
    if (ticket !== painting || !host.isConnected || !box) return;
    if (!tiers) { body.replaceChildren(el("p", { className: "doc-tab-note", text: "This hand is gone." })); return; }
    const cats = await catalogues(h, [...tiers.only, ...tiers.never, ...tiers.tiers.flatMap((t) => t.cards), ...tiers.anywhere]);
    if (ticket !== painting || !host.isConnected) return;
    const row = (ref: HandCardRef & { why?: string }): HTMLElement | null =>
      handCardRow(box, ref, cats.get(ref.deck) ?? [], site.gameId, (deck, card) => h.openCard(layer.box, deck, card, site.id),
        { ...(tiers.gated[ref.card] !== undefined ? { gates: tiers.gated[ref.card] } : {}), ...(ref.why !== undefined ? { why: ref.why } : {}) });
    const tier = (label: string, refs: (HandCardRef & { why?: string })[]): HTMLElement => el("div", { className: "mapside-tier" },
      el("div", { className: "mapside-cap" }, el("span", { text: label }), el("span", { className: "handcard-n", text: String(refs.length) })),
      refs.length > 0 ? el("div", { className: "handcards" }, ...refs.map(row)) : el("p", { className: "mapside-none", text: "None." }));
    // ANYWHERE IS A COUNT, as on the hand page: in a big box it is most of the
    // box, and a hand's panel that listed it would stop being about the hand.
    let showing = false;
    const any = el("div", { className: "mapside-tier" });
    const paintAny = (): void => {
      const n = tiers.anywhere.length;
      any.replaceChildren(
        n > 0
          ? el("p", { className: "handcard-any" },
              el("span", { text: anywhereLine(tiers)! }),
              el("button", { className: "linkbtn", text: showing ? "Hide" : "Show", onClick: () => { showing = !showing; paintAny(); } }))
          : el("p", { className: "handcard-any", text: "Nothing else can come up here." }),
        ...(n > 0 && showing ? [el("div", { className: "handcards" }, ...tiers.anywhere.map(row))] : []));
    };
    paintAny();
    const add = el("button", { className: "listrow ghost", text: "+ New card here" });
    add.addEventListener("click", () => openDeckPickerFor(add, box, (deck) => h.newCardAt(layer.box, deck, { id: site.id, title })));
    const moving = movingNote(tiers);
    body.replaceChildren(
      ...(moving !== undefined ? [el("p", { className: "mapside-note", text: moving })] : []),
      tier("Only here", tiers.only),
      ...(tiers.never.length > 0 ? [tier(NEVER_LABEL, tiers.never)] : []),
      ...tiers.tiers.map((t) => tier(tierLabel(t), t.cards)),
      any, add,
      // "Could", never "comes": nothing here evaluates a condition.
      el("p", { className: "mapside-note", text: `Could be dealt here from ${layer.title ?? layer.gameId}'s own decks, whatever the conditions say right now.` }));
  })();
}

/** One property, read: name, kind, its values in order, where this zone
 *  starts, and who shares its value (zone-share.ts), which follows the
 *  property's own Shared tick-box. */
function propertyRow(p: MapZonePropertyDto): HTMLElement {
  return el("div", { className: "mapzone-prop" },
    el("div", { className: "mapzone-prop-head" },
      el("span", { className: "mapzone-prop-name", text: p.name }),
      el("span", { className: "mapzone-prop-type", text: `${p.type}${p.own === true ? ", this zone's own" : ""}` })),
    el("p", { className: "mapzone-prop-share", text: zoneShareLine(p.shared === true, !shows("sharing")) }),
    el("div", { className: "mapzone-prop-vals" },
      // A quality's stages are an ORDER, so they are drawn as one, with the
      // vocabulary's arrow; an enum's values are a set, and read as a list.
      ...(p.values !== undefined
        ? [el("span", { className: "mapzone-prop-stages" }, ...(p.type === "quality"
            ? p.values.flatMap((v, i) => [...(i > 0 ? [iconNode("arrowRight", 10)] : []), el("span", { text: v })])
            : [el("span", { text: p.values.join(", ") })]))]
        : []),
      el("span", { className: "mapzone-prop-start", text: `Starts at ${p.start}` })));
}

/** A selected ZONE: its properties declared once, then what each box has there. */
export function paintZonePanel(
  host: HTMLElement, h: MapPanelHost, tagId: string, hidden: Set<string>,
  show: (boxes: string[]) => void, back: () => void,
): void {
  const ticket = ++painting;
  host.replaceChildren(backRow(back));
  void (async () => {
    const zone = await h.zone(tagId);
    if (ticket !== painting || !host.isConnected) return;
    if (!zone) { host.append(el("p", { className: "doc-tab-note", text: "This zone is gone." })); return; }
    const refs = zone.byBox.filter((b) => !hidden.has(b.box)).flatMap((b) => b.cards);
    const cats = await catalogues(h, refs);
    if (ticket !== painting || !host.isConnected) return;

    // Neutral, as the zone is on the map: only pins wear a colour, a box's, and
    // a tag colour here read "docks" as one of Contracts' things.
    const head = el("div", { className: "mapside-headrow" },
      el("h3", { className: "mapside-h" }, el("i", { className: "mapside-dot zone" }), zone.gameId));
    const visible = zone.byBox.filter((b) => !hidden.has(b.box));
    const away = zone.byBox.filter((b) => hidden.has(b.box));
    // Used by: the boxes with something here, hidden ones included, since this
    // is a fact about the zone rather than about what is on screen.
    const used = el("div", { className: "mapside-chips" },
      el("span", { className: "mapside-label", text: "Used by" }),
      ...(zone.byBox.length > 0 ? zone.byBox.map((b) => boxPill(b)) : [el("span", { className: "mapside-none", text: "no box yet" })]));
    const props = el("div", { className: "mapside-tier" },
      el("div", { className: "mapside-cap" }, el("span", { text: "Properties" }),
        el("button", { className: "linkbtn", text: "Edit", tip: "Every zone's properties, on the zones' own page", onClick: () => h.editZones() })),
      ...(zone.properties.length > 0
        ? [el("div", { className: "mapzone-props" }, ...zone.properties.map(propertyRow)),
            el("p", { className: "mapside-note", text: "Declared once, for every zone on the map." })]
        : [el("p", { className: "mapside-none", text: "None declared." })]),
      // On Solo there is no Shared tick-box, so say once where one comes from.
      ...(!shows("sharing") ? [soloSharePointer("mapside-note")] : []));

    const sites = el("div", { className: "mapside-tier" },
      el("div", { className: "mapside-cap" }, el("span", { text: `Hands in ${zone.gameId}` })),
      ...visible.filter((b) => b.sites.length > 0).flatMap((b) => [
        el("div", { className: "mapside-boxcap" }, boxPill(b), el("span", { className: "handcard-n", text: String(b.sites.length) })),
        ...b.sites.map((s) => el("button", {
          className: "mapside-row titled", tip: `Open ${s.title ?? s.gameId}`, onClick: () => h.openHand(b.box, s.id),
        }, boxPin(b.box), el("span", { className: "mapside-name", text: s.title ?? s.gameId }),
          el("span", { className: "mapside-meta", text: [s.moving === true ? "moving" : "", s.only > 0 ? `${s.only} only here` : ""].filter((x) => x !== "").join(", ") }))),
      ]),
      ...(visible.every((b) => b.sites.length === 0) ? [el("p", { className: "mapside-none", text: "None." })] : []));

    const cards = el("div", { className: "mapside-tier" },
      el("div", { className: "mapside-cap" }, el("span", { text: `Filed to ${zone.gameId}: anywhere in it` })),
      ...visible.filter((b) => b.cards.length > 0).flatMap((b) => {
        const box = h.box(b.box);
        return [
          el("div", { className: "mapside-boxcap" }, boxPill(b), el("span", { className: "handcard-n", text: String(b.cards.length) })),
          el("div", { className: "handcards" }, ...b.cards.map((ref) => (box
            ? handCardRow(box, ref, cats.get(ref.deck) ?? [], undefined, (deck, card) => h.openCard(b.box, deck, card, tagId))
            : null))),
        ];
      }),
      ...(visible.every((b) => b.cards.length === 0) ? [el("p", { className: "mapside-none", text: "None." })] : []));
    // "+ New card here", as a hand's panel has it: filed to the zone, so it can
    // come up at any hand in it. Any box on the map can; the shown layers are
    // offered, since a card made in a hidden one would land out of sight.
    const filers = h.mapBoxes().filter((b) => !hidden.has(b.id));
    if (filers.length > 0) {
      const add = el("button", { className: "listrow ghost", text: "+ New card here" });
      add.addEventListener("click", () => openDeckPickerAcross(add, filers,
        (box, deck) => h.newCardInZone(box, deck, { id: tagId, gameId: zone.gameId })));
      cards.append(add);
    }

    // The hidden layers' share, as one quiet line that brings them back.
    const awayCount = away.reduce((n, b) => n + b.sites.length + b.cards.length, 0);
    const awayLine = awayCount > 0
      ? [el("button", {
          className: "linkbtn mapside-away",
          text: `and ${awayCount} from hidden layers (${away.map((b) => b.title ?? b.gameId).join(", ")})`,
          tip: "Show those layers again",
          onClick: () => show(away.map((b) => b.box)),
        })]
      : [];

    host.replaceChildren(backRow(back), head, used, props, sites, cards, ...awayLine);
  })();
}
