// @vitest-environment jsdom
// The version-control surface: folding a shard snapshot over an item's keys,
// the badge each state flies, painting badges in place, and the read-only
// guard that stops a locked document being typed into.

import { describe, expect, it } from "vitest";
import { foldVc, lockControls, lockNotice, paintVcBadges, vcBadgeFor } from "./vc-view.js";
import type { ShardVcDto } from "../../shared/api.js";

const snapshot = (...shards: ShardVcDto[]): Map<string, ShardVcDto> =>
  new Map(shards.map((s) => [s.key, s]));

describe("folding a snapshot over an item's shard keys", () => {
  it("is undefined for a clean item (absent from the trimmed snapshot)", () => {
    expect(foldVc(snapshot(), "deck:k_1")).toBeUndefined();
    expect(foldVc(snapshot({ key: "deck:k_9", writable: false }), "deck:k_1")).toBeUndefined();
    expect(foldVc(snapshot(), undefined)).toBeUndefined();
  });

  it("folds a box row's three shards, most actionable winning", () => {
    const shards = snapshot(
      { key: "box:b_1", writable: false },
      { key: "hands:b_1", writable: true, outOfDate: true },
      { key: "tags:b_1", writable: false, lockedBy: ["bo@bo-ws"] },
    );
    expect(foldVc(shards, "box:b_1 tags:b_1 hands:b_1")).toEqual({
      key: "box:b_1", writable: false, lockedBy: ["bo@bo-ws"], outOfDate: true,
    });
  });

  it("unions holders across the shards, without repeating one", () => {
    const shards = snapshot(
      { key: "box:b_1", writable: false, lockedBy: ["bo@bo-ws"] },
      { key: "hands:b_1", writable: false, lockedBy: ["bo@bo-ws", "ada@ada-ws"] },
    );
    expect(foldVc(shards, "box:b_1 tags:b_1 hands:b_1")?.lockedBy).toEqual(["bo@bo-ws", "ada@ada-ws"]);
  });
});

describe("the badge an item flies", () => {
  it("says nothing about a clean shard", () => {
    expect(vcBadgeFor(undefined)).toBeNull();
    expect(vcBadgeFor({ key: "k", writable: true })).toBeNull();
    // The three states the port dropped and app-shell 0.26.0 restored. Asserted
    // from HERE as well as in the shell, because the way they went missing was a
    // lossy hand-port that nothing on either side was checking.
    expect(vcBadgeFor({ key: "k", writable: true, checkedOutByMe: true })).toMatchObject({ cls: "vc-mine" });
    expect(vcBadgeFor({ key: "k", writable: true, dirty: true })).toMatchObject({ cls: "vc-dirty" });
    expect(vcBadgeFor({ key: "k", writable: true, untracked: true })).toMatchObject({ cls: "vc-new" });
    // A holder outranks everything about your own copy: the badge answers "what
    // would I do about this?", not "what is this file's state".
    expect(vcBadgeFor({ key: "k", writable: true, dirty: true, lockedBy: ["Ada"] })).toMatchObject({ cls: "vc-locked" });
  });

  it("puts a holder first, then out-of-date, then plain read-only", () => {
    expect(vcBadgeFor({ key: "k", writable: false, lockedBy: ["bo@bo-ws"], outOfDate: true }))
      .toMatchObject({ cls: "vc-locked", title: "Locked by bo@bo-ws" });
    expect(vcBadgeFor({ key: "k", writable: true, outOfDate: true })).toMatchObject({ cls: "vc-stale" });
    // Read-only with no other holder is still editable: the save checks it out.
    expect(vcBadgeFor({ key: "k", writable: false })).toMatchObject({ cls: "vc-frozen" });
  });

  it("names every holder in the tooltip", () => {
    expect(vcBadgeFor({ key: "k", writable: false, lockedBy: ["bo@bo-ws", "ada@ada-ws"] })?.title)
      .toBe("Locked by bo@bo-ws, ada@ada-ws");
  });
});

describe("painting badges in place", () => {
  const rows = (): HTMLElement => {
    const host = document.createElement("div");
    host.innerHTML = `
      <button class="nav-row" data-vc="deck:k_1"><span class="nav-label">Docks</span></button>
      <button class="nav-row" data-vc="box:b_1 tags:b_1 hands:b_1"><span class="nav-label">Encounters</span></button>
      <button class="nav-row"><span class="nav-label">Decks</span></button>`;
    return host;
  };

  it("badges only what the snapshot mentions, and leaves the row's own content alone", () => {
    const host = rows();
    paintVcBadges(host, snapshot({ key: "deck:k_1", writable: false, lockedBy: ["bo@bo-ws"] }));
    const badges = host.querySelectorAll(".vc-badge");
    expect(badges.length).toBe(1);
    expect(badges[0]!.classList.contains("vc-locked")).toBe(true);
    expect(badges[0]!.getAttribute("aria-label")).toBe("Locked by bo@bo-ws");
    expect(host.querySelector<HTMLElement>("[data-vc='deck:k_1'] .nav-label")!.textContent).toBe("Docks");
  });

  it("repaints without stacking, and clears a badge once the lock is released", () => {
    const host = rows();
    const locked = snapshot({ key: "hands:b_1", writable: false, lockedBy: ["bo@bo-ws"] });
    paintVcBadges(host, locked);
    paintVcBadges(host, locked);
    expect(host.querySelectorAll(".vc-badge").length).toBe(1);   // repaint replaces, never stacks
    paintVcBadges(host, snapshot());
    expect(host.querySelectorAll(".vc-badge").length).toBe(0);
  });
});

describe("the read-only guard on a locked document", () => {
  const doc = (): HTMLElement => {
    const host = document.createElement("div");
    host.innerHTML = `
      <button class="crumb-back">‹ Encounters</button>
      <input class="doc-title" />
      <textarea class="doc-purpose"></textarea>
      <button class="doc-tab on">Cards</button>
      <button class="doc-menu">⋯</button>
      <button class="chip">docks</button>
      <select class="insp-input"><option>a</option></select>
      <div class="scard">Ambush<div class="cardwhen"><button class="exed-pill">danger</button></div></div>
      <button class="scard ghost">+ New card</button>
      <button class="centre-step" disabled>‹</button>`;
    return host;
  };
  const off = (host: HTMLElement): string[] =>
    [...host.querySelectorAll<HTMLElement>(".vc-off")].map((c) => c.className.split(" ")[0]!);

  it("stops the writing and leaves the reading alone", () => {
    const host = doc();
    lockControls(host, true);
    expect(host.classList.contains("vc-readonly")).toBe(true);
    // Editing controls off: the identity fields, the overflow menu, the tag
    // chips, the pickers, and the "+ New" ghost.
    expect(off(host).sort()).toEqual(["chip", "doc-menu", "doc-purpose", "doc-title", "insp-input", "scard"].sort());
    // Navigation, tabs and the card faces stay live.
    expect(host.querySelector<HTMLButtonElement>(".crumb-back")!.disabled).toBe(false);
    expect(host.querySelector<HTMLButtonElement>(".doc-tab")!.disabled).toBe(false);
    // ...including a card face's condition preview, whose pills ARE buttons:
    // disabling them would swallow the click that opens the card.
    expect(host.querySelector<HTMLButtonElement>(".cardwhen .exed-pill")!.disabled).toBe(false);
  });

  it("gives back only what it took: a control disabled for its own reasons stays so", () => {
    const host = doc();
    lockControls(host, true);
    lockControls(host, false);
    expect(host.classList.contains("vc-readonly")).toBe(false);
    expect(off(host)).toEqual([]);
    expect(host.querySelector<HTMLInputElement>(".doc-title")!.disabled).toBe(false);
    expect(host.querySelector<HTMLButtonElement>(".centre-step")!.disabled).toBe(true);   // its own reason
  });

  it("is idempotent (a poll re-applies it every 30 seconds)", () => {
    const host = doc();
    lockControls(host, true);
    lockControls(host, true);
    lockControls(host, false);
    expect(host.querySelector<HTMLInputElement>(".doc-title")!.disabled).toBe(false);
  });

  it("names the holders in the notice", () => {
    expect(lockNotice(["bo@bo-ws", "ada@ada-ws"]).textContent)
      .toContain("Locked by bo@bo-ws, ada@ada-ws");
  });
});
