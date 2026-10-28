// ---------------------------------------------------------------------------
// Project Settings > Game scopes: the game's own scopes the story reads
// (`@world`, `@player`, ...), host scopes like Patter's, with the coverage
// drivers that feed them below (Patterpad's World Properties tab, grown to
// every scope).
//
// @world comes first and behaves as it always has: its token is fixed, it
// can't be removed or made opaque, and an empty one is no scope at all. Every
// other scope is the author's to add, name (a rename carries every reference
// to it), remove, and declare either
// property by property or opaque (any name, unchecked). Each scope carries a
// scope-level Read-only switch, the default for its properties; a property's
// own Read-only switch still says the same of that one property.
//
// Mutates `data.hostScopes` in place; the dialog saves the whole DTO.
// ---------------------------------------------------------------------------

import { el, iconBtn, labelledToggle } from "@wildwinter/app-shell";
import type { SettingsSectionHandle } from "@wildwinter/app-shell";
import { mountPropertyList } from "./prop-list.js";
import { mountDriverList, splitRef } from "./driver-list.js";
import type { DriverListHandle } from "./driver-list.js";
import type { CoverageDriverDto, HostScopeDto, ProjectSettingsDto, StageTargetDto } from "../../shared/api.js";

/** The Storylet Engine's own scopes, and the family's other engines': never a game's. */
const ENGINE_OWN = ["story", "box", "deck", "hand"];
const OTHER_ENGINES = ["patter"];

/** Why `token` can't name a host scope here, or undefined when it can. The same rules the
 *  save checks (main mutate/settings.ts `hostScopesProblem`), said at the field. */
export function tokenProblem(token: string, others: readonly string[]): string | undefined {
  const t = token.trim();
  if (t === "") return "Give the scope a name, such as player.";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return "A scope's name is letters, digits and _, and doesn't start with a digit.";
  if (t === "world") return "@world is already the first scope.";
  if (ENGINE_OWN.includes(t)) return `@${t} is the Storylet Engine's own scope, so the game can't provide it.`;
  if (OTHER_ENGINES.includes(t)) return `@${t} belongs to another engine in the family.`;
  if (others.includes(t)) return `There is already an @${t} scope.`;
  return undefined;
}

export interface HostScopesHost {
  /** A stage renamed on a saved scope's quality, carried at Save. */
  renameStage(target: StageTargetDto, from: string, to: string): void;
  /** A saved scope's property renamed, carried through every reference at Save. */
  renameProperty(target: StageTargetDto, from: string, to: string): void;
  stageGates(target: StageTargetDto): Promise<number>;
  proposeDrivers(): Promise<CoverageDriverDto[]>;
}

/** Mount the section into `h`. */
export function mountHostScopes(h: HTMLElement, data: ProjectSettingsDto, host: HostScopesHost): SettingsSectionHandle {
  const scopes = data.hostScopes;
  // @world always, first: a DTO from a project that declares none still gets the row.
  if (scopes[0]?.token !== "world") {
    const at = scopes.findIndex((s) => s.token === "world");
    const world = at >= 0 ? scopes.splice(at, 1)[0]! : { token: "world", declarations: [] };
    scopes.unshift(world);
  }
  // Only a saved scope can carry a property rename into the cards, and it does so under the
  // token it was saved with (`savedAs`): one added in this dialog has no references yet, so its
  // own list change is the whole of it. A scope renamed here is renamed at Save, after the
  // property renames, and its references follow it (main mutate/settings.ts).
  const tokenInputs: { input: HTMLInputElement; scope: HostScopeDto }[] = [];
  // Tolerate a DTO without the field rather than blanking the panel:
  // a section that throws mid-mount leaves the tab half-built.
  data.drivers ??= [];
  // A driver follows the scope it feeds when that scope is renamed here. Tied to the scope
  // itself rather than its token, so a name typed through another scope's on the way never
  // takes that scope's drivers; a driver no single scope answers to is tied to none.
  const feeds = new Map<CoverageDriverDto, HostScopeDto>();
  const tie = (): void => {
    for (const d of data.drivers) {
      if (feeds.has(d)) continue;
      const owners = scopes.filter((s) => s.token === splitRef(d.ref).scope);
      if (owners.length === 1) feeds.set(d, owners[0]!);
    }
  };
  tie();
  // The token each renamed scope's drivers last took: an empty or unusable name is passed
  // over, so the drivers wait under the last good one.
  const applied = new Map<HostScopeDto, string>();
  const follow = (scope: HostScopeDto, next: string): void => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(next)) return;
    const was = applied.get(scope)!;
    for (const d of data.drivers) {
      const parts = splitRef(d.ref);
      if (feeds.get(d) === scope && parts.scope === was) d.ref = `@${next}.${parts.name}`;
    }
    applied.set(scope, next);
  };
  let lists: SettingsSectionHandle[] = [];

  h.append(el("p", {
    className: "set-note",
    text: "Values your game owns and your story reads, such as @world.time or @player.hp. Each starts at its default until the game sets it.",
  }));
  // Where the game shares its scopes, these are the game's, not this project's: said first,
  // so an author editing them knows the other tools will see the change.
  if (data.worldFile !== undefined) {
    h.append(el("p", { className: "set-note", text: `Shared with the game's other tools: saving writes these to ${data.worldFile} first, then copies them into this project, so it still compiles on its own. Renaming a scope here renames it in that file too, but not in the other tools' projects: update those where they use it.` }));
  }
  const scopesHost = el("div", { className: "host-scopes" });
  h.append(scopesHost);

  const markToken = (input: HTMLInputElement, scope: HostScopeDto): string | undefined => {
    const problem = tokenProblem(scope.token, scopes.filter((s) => s !== scope).map((s) => s.token.trim()));
    input.classList.toggle("illegal", problem !== undefined);
    if (problem !== undefined) input.dataset.tip = problem; else delete input.dataset.tip;
    return problem;
  };

  function scopeBlock(scope: HostScopeDto, i: number): HTMLElement {
    const block = el("section", { className: "host-scope" });
    const world = i === 0;
    const head = el("div", { className: "host-scope-head" });
    if (world) {
      head.append(el("h3", { className: "set-cap", text: "@world" }));
    } else {
      const token = el("input", { className: "set-name host-scope-token" });
      token.value = scope.token;
      token.placeholder = "Scope name";
      token.spellcheck = false;
      token.setAttribute("aria-label", "Scope name");
      token.addEventListener("input", () => {
        tie();
        if (!applied.has(scope)) applied.set(scope, scope.token);
        scope.token = token.value.trim();
        follow(scope, scope.token);
        for (const t of tokenInputs) markToken(t.input, t.scope);
        drivers?.render();
      });
      tokenInputs.push({ input: token, scope });
      markToken(token, scope);
      const remove = iconBtn("close", "Remove scope", () => {
        scopes.splice(i, 1);
        renderScopes();
      }, false, true);
      head.append(el("h3", { className: "set-cap host-scope-cap" }, el("span", { text: "@" }), token), remove);
    }
    block.append(head);

    block.append(labelledToggle("Read-only to the story", {
      checked: scope.writable === false,
      hint: "The story can read every property here but not set one. A write is reported as a problem.",
      onChange: (on) => { if (on) scope.writable = false; else delete scope.writable; },
    }).row);

    const listHost = el("div", { className: "host-scope-props" });
    const drawProps = (): void => {
      listHost.replaceChildren();
      if (scope.opaque === true) {
        listHost.append(el("p", { className: "set-note", text: `Any @${scope.token || "scope"} name is accepted, and nothing checks it.` }));
        return;
      }
      const target = (decl: { name: string }): StageTargetDto | undefined =>
        decl.name.trim() === "" || scope.savedAs === undefined ? undefined : { kind: "property", scope: scope.savedAs, name: decl.name };
      lists.push(mountPropertyList(listHost, scope.declarations, {
        readOnlySwitch: true, sharingSwitches: false,
        // A declaration added, renamed or removed changes what a driver may name.
        onChange: () => drivers?.revalidate(),
        stages: {
          target,
          rename: (t, from, to) => host.renameStage(t, from, to),
          renameProperty: (t, from, to) => host.renameProperty(t, from, to),
          gates: (t) => host.stageGates(t),
        },
      }));
    };
    if (!world) {
      block.append(labelledToggle("Any name, unchecked", {
        checked: scope.opaque === true,
        hint: "The game decides what this scope holds, so the story may name any property on it. Turn it off to declare its properties instead.",
        onChange: (on) => {
          if (on) scope.opaque = true; else delete scope.opaque;
          lists = [];
          renderScopes();
        },
      }).row);
    }
    drawProps();
    block.append(listHost);
    return block;
  }

  function renderScopes(): void {
    lists = [];
    tokenInputs.length = 0;
    scopesHost.replaceChildren(...scopes.map((s, i) => scopeBlock(s, i)));
    drivers?.render();
  }

  const add = el("button", { className: "settings-add", text: "+ Add scope" });
  add.type = "button";
  add.addEventListener("click", () => {
    scopes.push({ token: "", declarations: [] });
    renderScopes();
    tokenInputs[tokenInputs.length - 1]?.input.focus();
  });
  h.append(el("div", { className: "set-actions" }, add));

  h.append(el("h3", { className: "set-cap", text: "Game values for coverage" }));
  h.append(el("p", { className: "set-note", text: "Values the coverage test feeds these properties, so cards gated on them get dealt." }));
  // Declared before the first render reads it; the scope blocks repaint the drivers when a
  // token or a declaration changes what a driver may point at.
  let drivers: DriverListHandle | undefined;
  renderScopes();
  drivers = mountDriverList(h, data.drivers, {
    onPropose: () => host.proposeDrivers(),
    // Read fresh on every check: declare a property and the driver naming it stops complaining.
    hostScopes: () => scopes.filter((s) => s.token.trim() !== "").map((s) => ({
      token: s.token.trim(),
      names: s.declarations.map((p) => p.name).filter(Boolean),
      ...(s.opaque === true ? { opaque: true } : {}),
    })),
  });

  return {
    firstInvalid: () => {
      for (const t of tokenInputs) {
        const message = markToken(t.input, t.scope);
        if (message !== undefined) return { el: t.input, message };
      }
      for (const l of lists) { const bad = l.firstInvalid?.(); if (bad) return bad; }
      return drivers?.firstInvalid?.() ?? null;
    },
  };
}
