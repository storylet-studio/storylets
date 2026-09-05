// ---------------------------------------------------------------------------
// The bundle inspector, JS idiom (design/engine-runtimes.md 2, piece 6).
//
// describeBundle() IS the JS half of the parity member - JS has no engine
// asset pipeline to hang an editor view off - so this is the optional DOM
// rendering of it: a read-only panel over a compiled bundle, in the property
// examiner's CSS grammar (inspector.ts), with NO session anywhere. Identity
// first, then collapsible sections: hands (the deal() surface), tags by box
// (the peek() criteria surface), declared properties, counts.
//
// Read-only by construction: there is no state to edit here, only the shape
// that shipped.
// ---------------------------------------------------------------------------
/// <reference lib="dom" />

import { describeBundle } from "@storylet-studio/runtime";
import type {
  BundleDescription, PropertyScopeSummary, PropertySummary,
} from "@storylet-studio/runtime";
import type { Bundle, ScalarValue } from "@storylet-studio/model";
import { ensureInspectorStyle } from "./inspector.js";

export interface BundleInspectorOptions {
  /** Mount point; defaults to document.body. */
  container?: HTMLElement;
  title?: string;
  /** Start the collapsible sections open (default true). */
  open?: boolean;
}

export interface BundleInspector {
  el: HTMLElement;
  /** The description this panel rendered (the API is the parity member). */
  description: BundleDescription;
  destroy(): void;
}

const showVal = (v: ScalarValue | undefined): string =>
  v === undefined ? "<unset>" : JSON.stringify(v);

/** "name: type = default", plus enum/flags options where declared, plus
 *  "(durable)" where the declaration says the value outlives a run
 *  (design/engine-server.md 4.2). Nothing is added for the ordinary
 *  run-scoped property: that is what a property is. */
export function formatPropertySummary(p: PropertySummary): string {
  const options = p.values !== undefined && p.values.length > 0 ? ` [${p.values.join(", ")}]` : "";
  const durable = p.durable === true ? " (durable)" : "";
  return `${p.name}: ${p.type} = ${showVal(p.default)}${options}${durable}`;
}

/** The scope label a declaration block files under ("world", "box box",
 *  "tag docks (zone)"). */
export function formatScopeLabel(scope: PropertyScopeSummary): string {
  if (scope.scope === "world" || scope.scope === "story") return scope.scope;
  const group = scope.group !== undefined ? ` (${scope.group})` : "";
  return `${scope.scope} ${scope.owner}${group}`;
}

const line = (parent: HTMLElement, text: string, cls = "sl-line"): HTMLElement => {
  const div = document.createElement("div");
  div.className = cls;
  div.textContent = text;
  parent.append(div);
  return div;
};

/** A collapsible section in the examiner's grammar. */
const fold = (parent: HTMLElement, label: string, open: boolean): HTMLElement => {
  const details = document.createElement("details");
  details.className = "sl-fold";
  details.open = open;
  const summary = document.createElement("summary");
  summary.textContent = label;
  details.append(summary);
  const body = document.createElement("div");
  details.append(body);
  parent.append(details);
  return body;
};

/** Render a read-only summary of a compiled bundle: what an integrator may
 *  call, with no session and no game running. */
export function createBundleInspector(
  bundle: Bundle,
  opts: BundleInspectorOptions = {},
): BundleInspector {
  ensureInspectorStyle();
  const description = describeBundle(bundle);
  const open = opts.open ?? true;

  const el = document.createElement("div");
  el.className = "sl-insp";

  const head = document.createElement("div");
  head.className = "sl-head";
  const h = document.createElement("h3");
  h.textContent = opts.title ?? "Bundle";
  head.append(h);
  el.append(head);

  // --- identity (always visible: which bundle is this?) --------------------
  const { identity, totals } = description;
  const ident = document.createElement("div");
  ident.className = "sl-ident";
  el.append(ident);
  line(ident, `${identity.project} ${identity.version}`, "sl-line");
  line(ident, `schema ${identity.schema}`, "sl-line sl-note");
  line(ident, `hash ${identity.hash === "" ? "(none)" : identity.hash} - metadata ${identity.metadata}`,
    "sl-line sl-note");

  // --- hands: the deal() surface -------------------------------------------
  const handsBody = fold(el, "Hands (deal)", open);
  handsBody.className = "sl-hands";
  if (description.hands.length === 0) {
    line(handsBody, "(no hands - this bundle is peek-only)", "sl-line sl-note");
  }
  for (const hand of description.hands) {
    const template = hand.template !== undefined ? `, template ${hand.template}` : "";
    // A movable hole is the one thing about a hand its name cannot say: write
    // that property and the hand moves (4.6).
    const moves = hand.movable === undefined ? ""
      : `, moves ${hand.movable.map((m) => `${m.group} from ${m.from}`).join(" and ")}`;
    line(handsBody, `${hand.gameId}: box ${hand.box}, slots ${hand.slots}${template}${moves}`
      + (hand.title !== undefined ? ` - ${hand.title}` : ""));
  }

  // --- tag groups by box: the peek() criteria surface ----------------------
  const tagsBody = fold(el, "Tags by box (peek criteria)", open);
  tagsBody.className = "sl-tags";
  for (const box of description.boxes) {
    line(tagsBody, `${box.title ?? box.gameId}`, "sl-group");
    if (box.tagGroups.length === 0) {
      line(tagsBody, "  (no tag groups)", "sl-line sl-note");
    }
    for (const group of box.tagGroups) {
      line(tagsBody, `  ${group.gameId}: ${group.tags.length > 0 ? group.tags.join(", ") : "(no tags)"}`);
    }
  }

  // --- declared properties: what expressions read, what a host may set ----
  const propsBody = fold(el, "Properties (declared)", open);
  propsBody.className = "sl-props";
  for (const scope of description.properties) {
    line(propsBody, formatScopeLabel(scope), "sl-group");
    if (scope.properties.length === 0) {
      line(propsBody, "  (none declared)", "sl-line sl-note");
    }
    for (const p of scope.properties) {
      line(propsBody, `  ${formatPropertySummary(p)}`);
    }
  }

  // --- maps: inert payload, and therefore worth saying out loud -----------
  //
  // Only when there ARE some. An empty section on every ordinary bundle would
  // teach the reader to skip a section that only ever matters when it is not
  // empty, and most bundles carry no geometry at all.
  if (description.maps.length > 0) {
    const mapsBody = fold(el, "Maps (carried, not read)", open);
    mapsBody.className = "sl-maps";
    line(mapsBody, "Geometry the build was asked to carry. The engine ignores it.", "sl-line sl-note");
    for (const map of description.maps) {
      line(mapsBody, `${map.box} - ${map.group}: zones ${map.zones}, pictures ${map.backgrounds}, sites ${map.sites}`);
    }
  }

  // --- counts: orientation, not inventory ---------------------------------
  const countsBody = fold(el, "Counts", open);
  countsBody.className = "sl-counts";
  line(countsBody, `boxes ${totals.boxes} - decks ${totals.decks} - cards ${totals.cards}`);
  line(countsBody, `hands ${totals.hands} - templates ${totals.templates} - tag groups ${totals.tagGroups}`);
  for (const box of description.boxes) {
    // A timed box says its unit here (design/engine-server.md 4.8), because
    // this is the line an integrator reads to find out what their host has to
    // tick. Nothing is added for an ordinary box: the answer "a turn is a
    // play" belongs in the docs, not on every line of every bundle.
    line(countsBody, `${box.gameId}: decks ${box.counts.decks}, cards ${box.counts.cards}, `
      + `hands ${box.counts.hands}, templates ${box.counts.templates}, `
      + `tag groups ${box.counts.tagGroups}, ranking.specificity ${box.ranking.specificity}`
      + (box.turn !== undefined ? `, turn = ${box.turn.seconds}s` : "")
      // Only when there are any: a box whose cards all come back with the run
      // has nothing for a server to lift, and the zero would be noise.
      + (box.durableCards !== undefined ? `, durable cards ${box.durableCards}` : ""));
  }

  (opts.container ?? document.body).append(el);
  return {
    el,
    description,
    destroy(): void {
      el.remove();
    },
  };
}
