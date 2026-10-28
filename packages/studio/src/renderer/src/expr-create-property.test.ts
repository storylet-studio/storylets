// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Making a property from an outcome's Changes (expr-editor 0.18.0, the hands-on
// review of 2026-10): typing a name no property has offers `+ New property
// "<name>"` in @story, Storyletter's own scope, and choosing it hands the name
// to the renderer's creator, then goes straight on to the change. Without a
// creator registered nothing is offered. And the catalogues in hand take the
// new property in place, so the next draw knows it without a fetch.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountChanges, NEW_PROPERTY_SCOPES, setPropertyCreator } from "./expr-panels.js";
import { createCatalogues } from "./catalogues.js";
import type { ConditionProperty } from "../../shared/api.js";
import type { Session } from "./session.js";

const properties: ConditionProperty[] = [{ scope: "story", name: "act", type: "number" }];
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => { setPropertyCreator(undefined); document.body.replaceChildren(); });

/** Open the "+ set property" picker on a fresh Changes editor and type `query`. */
async function pick(query: string, onChange = vi.fn()): Promise<{ list: HTMLElement; onChange: typeof onChange }> {
  const host = document.body.appendChild(document.createElement("div"));
  mountChanges(host, { changes: [], properties, onChange });
  const add = [...host.querySelectorAll<HTMLButtonElement>(".exed-eff-add")].find((b) => b.textContent === "+ set property")!;
  add.click();
  await settle();
  const search = document.querySelector<HTMLInputElement>(".exed-picker input")!;
  search.value = query;
  search.dispatchEvent(new Event("input"));
  return { list: document.querySelector<HTMLElement>(".exed-picker-list")!, onChange };
}

describe("+ New property in the Changes picker", () => {
  it("offers @story alone", () => {
    expect(NEW_PROPERTY_SCOPES).toEqual(["story"]);
  });

  it("is offered only when the renderer has registered a creator", async () => {
    const { list } = await pick("gold");
    expect(list.querySelector(".exed-opt-create")).toBeNull();
  });

  it("hands the name and @story to the creator, then goes straight on to the value", async () => {
    const create = vi.fn(async (name: string, scope: string) => ({ scope, name, type: "number" as const }));
    setPropertyCreator(create);
    const { list } = await pick("gold");
    const row = list.querySelector<HTMLButtonElement>(".exed-opt-create")!;
    expect(row.textContent).toContain('+ New property "gold"');
    expect(row.textContent).toContain("in story");
    row.click();
    await settle();
    expect(create).toHaveBeenCalledWith("gold", "story");
    // The picker has gone and the value step is open, as for a listed property.
    expect(document.querySelector(".exed-picker")).toBeNull();
    expect(document.querySelector(".exed-vwiz")).not.toBeNull();
  });

  it("says a refusal under the row and adds nothing", async () => {
    setPropertyCreator(async () => { throw new Error("\"gold\" is already declared."); });
    const { list, onChange } = await pick("gold");
    list.querySelector<HTMLButtonElement>(".exed-opt-create")!.click();
    await settle();
    expect(document.querySelector(".exed-create-why")?.textContent).toContain("already declared");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("a new property, in the catalogues in hand", () => {
  it("joins the open deck's catalogue once, without a fetch or a redraw", async () => {
    const cardCatalogue = vi.fn(async () => [...properties]);
    const render = vi.fn();
    const catalogues = createCatalogues({
      session: { studio: { cardCatalogue } } as unknown as Session,
      render, renderCentre: vi.fn(), boxDecks: () => [], onBoxPage: () => false,
    });
    await catalogues.loadDeck("k_1");
    render.mockClear();
    const gold: ConditionProperty = { scope: "story", name: "gold", type: "number" };
    catalogues.adopt(gold);
    catalogues.adopt(gold);
    expect(catalogues.forDeck("k_1").filter((p) => p.name === "gold")).toHaveLength(1);
    expect(cardCatalogue).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
  });
});
