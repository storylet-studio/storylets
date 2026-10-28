// @vitest-environment jsdom
// The browse keys act on the cards only when the keyboard is on the cards: a
// Delete on a focused button deleted the selected cards (the hands-on review,
// foundation 8).

import { afterEach, describe, expect, it } from "vitest";
import { keyIsTheCards, overlayOpen } from "./browse-keys.js";

afterEach(() => { document.body.innerHTML = ""; });

function page(): { card: HTMLElement; ghost: HTMLElement; tab: HTMLElement; cell: HTMLElement; rowButton: HTMLElement } {
  document.body.innerHTML = `
    <div class="tabs"><button id="tab">Cards</button></div>
    <div class="cards">
      <button class="scard" id="card"><h3>A card</h3></button>
      <button class="scard ghost" id="ghost">+ New card</button>
    </div>
    <table class="ctable"><tbody><tr><td id="cell">A card</td><td><button id="rowButton">…</button></td></tr></tbody></table>`;
  const get = (id: string): HTMLElement => document.getElementById(id)!;
  return { card: get("card"), ghost: get("ghost"), tab: get("tab"), cell: get("cell"), rowButton: get("rowButton") };
}

describe("keyIsTheCards", () => {
  it("takes a key on the page itself, a card, its face, or a table row", () => {
    const p = page();
    expect(keyIsTheCards(document.body)).toBe(true);
    expect(keyIsTheCards(null)).toBe(true);
    expect(keyIsTheCards(p.card)).toBe(true);
    expect(keyIsTheCards(p.cell)).toBe(true);
  });

  it("leaves a key on any other control to that control", () => {
    const p = page();
    expect(keyIsTheCards(p.ghost)).toBe(false);
    expect(keyIsTheCards(p.tab)).toBe(false);
    expect(keyIsTheCards(p.rowButton)).toBe(false);
  });

  it("takes nothing while a dialog, menu or popover is on top", () => {
    const p = page();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    expect(overlayOpen()).toBe(true);
    expect(keyIsTheCards(document.body)).toBe(false);
    expect(keyIsTheCards(p.card)).toBe(false);
    dialog.remove();
    const menu = document.createElement("div");
    menu.className = "ctxmenu";
    document.body.append(menu);
    expect(keyIsTheCards(p.card)).toBe(false);
  });
});
