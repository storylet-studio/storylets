// @vitest-environment jsdom
// The nav + centre views, rendered headlessly: the navigator disambiguates
// kinds with group labels, and the deck centre shows cards as title+beat
// (the ranking machinery is recessive, in the inspector).

import { describe, expect, it, vi } from "vitest";
import { cardHasContent, navId, renderBoxCentre, renderDeckCentre, renderDecksCentre, renderHandsCentre, renderNav, renderProblems, renderProjectCentre } from "./views.js";
import type { Focus, ViewActions } from "./views.js";
import { resetDocTabMemory, setDocTab } from "./inspector.js";
import type { BoxDto, CardDto, DeckDto, ProjectDto } from "../../shared/api.js";

const deck: DeckDto = {
  id: "k_1", gameId: "docks", title: "Docks", purpose: "Beats for the harbour arc.",
  properties: [],
  cards: [{
    id: "c_1", gameId: "ambush", title: "Ambush at the ford",
    purpose: "Cutthroats spring from the reeds.",
    condition: "@hand.danger >= 2", priority: 2, redraw: "5",
    tags: [{ group: "zone", values: ["docks"] }], copies: "", sharedCopies: "", fields: [],
    outcomes: [{ id: "o_1", gameId: "flee", changes: [] }],
  }],
};
const box: BoxDto = {
  id: "b_1", gameId: "box", ranking: { specificity: true }, fields: [], properties: [], decks: [deck],
  templates: [{ id: "t_1", gameId: "street-hands", bindings: ["zone = ?"], slots: "3", instances: 1 }],
  tagGroups: [{ id: "d_1", gameId: "zone", values: ["docks", "market"] }],
  hands: [{ id: "h_1", gameId: "docks-street", template: "street-hands", slots: 2, tags: {} }],
};
const project: ProjectDto = { dir: "/p", name: "Saltmarsh", threads: {}, storyPropertyCount: 0, play: "venue", boxes: [box] };

const stubActions = (over: Partial<ViewActions> = {}): ViewActions => ({
  openThreads: () => 0, showComments: vi.fn(), focus: vi.fn(), toggleNav: vi.fn(), openProjectSettings: vi.fn(), revealProject: vi.fn(), inspectCard: vi.fn(), inspectTemplate: vi.fn(), inspectTagGroup: vi.fn(), inspectHand: vi.fn(),
  newCard: vi.fn(), newDeck: vi.fn(), newBox: vi.fn(), newTemplate: vi.fn(), newTagGroup: vi.fn(), newMap: vi.fn(), newHand: vi.fn(), editBox: vi.fn(), saveDeck: vi.fn(), saveBox: vi.fn(),
  duplicateBox: vi.fn(), deleteBox: vi.fn(), moveBox: vi.fn(), moveDeck: vi.fn(), moveHand: vi.fn(),
  duplicateCard: vi.fn(), deleteCard: vi.fn(), showLinks: vi.fn(), selectCard: vi.fn(), setViewMode: vi.fn(), mountNodeView: vi.fn(), mountMapView: vi.fn(), moveCard: vi.fn(),
  duplicateDeck: vi.fn(), deleteDeck: vi.fn(), duplicateTemplate: vi.fn(), deleteTemplate: vi.fn(),
  duplicateHand: vi.fn(), deleteHand: vi.fn(), duplicateTagGroup: vi.fn(), deleteTagGroup: vi.fn(), ...over,
});

describe("navigator", () => {
  it("shows only the CONTENT collections of an expanded box (setup stays off the nav)", () => {
    const host = document.createElement("div");
    const expanded = new Set([navId.box("b_1")]);
    renderNav(host, project, { kind: "deck", box: "b_1", deck: "k_1" } as Focus, expanded, stubActions());
    const labels = [...host.querySelectorAll(".nav-d1 .nav-label")].map((g) => g.textContent);
    // Hand templates and Tags are box setup: tabs on the box page (rule 8).
    expect(labels).toEqual(["Decks", "Hands"]);
    // The focused deck is not visible (Decks is collapsed), but its path is lit.
    expect(host.querySelector(".nav-d1.on-path .nav-label")!.textContent).toBe("Decks");
  });

  it("the nav stops at containers: the deck row carries sel for its open card", () => {
    const host = document.createElement("div");
    const expanded = new Set([navId.box("b_1"), navId.collection("b_1", "decks")]);
    // A card editor is open: focus stays on its deck, which has no leaf to
    // light, so the deck row itself carries sel (the Mail model).
    renderNav(host, project, { kind: "deck", box: "b_1", deck: "k_1" } as Focus, expanded, stubActions());
    const deckRow = [...host.querySelectorAll<HTMLElement>(".nav-d2")].find((b) => b.textContent?.includes("Docks"))!;
    expect(deckRow.classList.contains("sel")).toBe(true);        // "which deck am I in"
    expect(deckRow.querySelector(".nav-chev")).toBeNull();       // no disclosure: no leaves
    expect(host.querySelector(".nav-d3")).toBeNull();            // no card rows anywhere
  });

  it("the box row selects the box; an open master lights its collection at full strength", () => {
    const host = document.createElement("div");
    const focusFn = vi.fn();
    const expanded = new Set([navId.box("b_1"), navId.collection("b_1", "hands")]);
    renderNav(host, project, { kind: "hands", box: "b_1" } as Focus, expanded, stubActions({ focus: focusFn }));
    host.querySelector<HTMLButtonElement>(".nav-boxrow")!.click();
    expect(focusFn).toHaveBeenCalledWith({ kind: "box", box: "b_1" });
    const handsRow = [...host.querySelectorAll<HTMLButtonElement>(".nav-d1")].find((b) => b.textContent?.includes("Hands"))!;
    expect(handsRow.classList.contains("sel")).toBe(true);   // master list OR an item editor
    expect(handsRow.querySelector(".nav-chev")).toBeNull();  // not expandable
    expect([...host.querySelectorAll(".nav-d2 .nav-label")].map((g) => g.textContent)).not.toContain("docks-street");
  });

  it("a collapsed box shows only its row; the chevron toggles without navigating", () => {
    const host = document.createElement("div");
    const focusFn = vi.fn();
    const toggleNav = vi.fn();
    renderNav(host, project, undefined, new Set<string>(), stubActions({ focus: focusFn, toggleNav }));
    expect(host.querySelector(".nav-d1")).toBeNull();
    const chev = host.querySelector<HTMLElement>(".nav-boxrow .nav-chev")!;
    chev.click();
    expect(toggleNav).toHaveBeenCalledWith(navId.box("b_1"));
    expect(focusFn).not.toHaveBeenCalled();
  });
});

describe("the shard keys items carry (data-vc, for the lock / read-only badges)", () => {
  const keysIn = (host: HTMLElement): string[] =>
    [...host.querySelectorAll<HTMLElement>("[data-vc]")].map((e) => e.dataset["vc"]!);

  it("names the project, each box (its three own shards) and each deck in the nav", () => {
    const host = document.createElement("div");
    const expanded = new Set([navId.box("b_1"), navId.collection("b_1", "decks")]);
    renderNav(host, project, { kind: "deck", box: "b_1", deck: "k_1" } as Focus, expanded, stubActions());
    expect(keysIn(host)).toEqual([
      "project",
      "project",                      // the Story row: @story lives in the project shard
      "box:b_1 tags:b_1 hands:b_1",   // a box row stands for its box + tags + hands
      "deck:k_1",                     // decks are a shard each, so they badge per row
      "hands:b_1",                    // every hand lives in the one shard: the collection carries it
    ]);
  });

  it("names each box on the project page and each deck on the decks master", () => {
    const boxes = document.createElement("div");
    renderProjectCentre(boxes, project, stubActions());
    expect(keysIn(boxes)).toEqual(["box:b_1 tags:b_1 hands:b_1"]);
    const decks = document.createElement("div");
    renderDecksCentre(decks, box, "cards", stubActions());
    expect(keysIn(decks)).toEqual(["deck:k_1"]);
    const table = document.createElement("div");
    renderDecksCentre(table, box, "table", stubActions());
    expect(keysIn(table)).toEqual(["deck:k_1"]);   // on the cell, never the <tr>
  });

  it("says WHERE the project is, and offers to reveal it", () => {
    // Two projects can share a name (a working copy beside the original is the
    // ordinary case, not a corner one), and until 2026-08-30 nothing inside the
    // editor could tell them apart. The path is not decoration here: it is the
    // answer to "which of these am I editing?".
    const host = document.createElement("div");
    const revealProject = vi.fn();
    renderProjectCentre(host, project, stubActions({ revealProject }));
    const dir = host.querySelector<HTMLButtonElement>(".pdir");
    expect(dir?.textContent).toBe("/p");
    dir?.click();
    expect(revealProject).toHaveBeenCalledOnce();
  });

  it("names the hands shard on the hands master", () => {
    const host = document.createElement("div");
    renderHandsCentre(host, box, stubActions());
    expect(keysIn(host)).toEqual(["hands:b_1"]);
  });

  it("scopes the box page's setup tabs to the shard they actually write", () => {
    const host = document.createElement("div");
    setDocTab("box:b_1", "templates");
    renderBoxCentre(host, box, () => {}, stubActions());
    expect(host.querySelector<HTMLElement>("[data-vc-scope]")!.dataset["vcScope"]).toBe("hands:b_1");
    setDocTab("box:b_1", "tags");
    renderBoxCentre(host, box, () => {}, stubActions());
    expect(host.querySelector<HTMLElement>("[data-vc-scope]")!.dataset["vcScope"]).toBe("tags:b_1");
    setDocTab("box:b_1", "contents");   // leave the shared tab state clean
  });
});

// What a VENUE depends on (design/engine-server.md 4.11). Quiet, one line per
// installation, and NOTHING at all on an ordinary project - which is the shape
// the density rule asks for, and the half worth testing hardest.
describe("the contract line on a box page", () => {
  it("says nothing when no venue depends on this box", () => {
    const host = document.createElement("div");
    setDocTab("box:b_1", "contents");
    renderBoxCentre(host, box, () => {}, stubActions());
    expect(host.querySelector(".doc-contract")).toBeNull();
  });

  it("says what the venue does with it, under the name it claims", () => {
    const host = document.createElement("div");
    setDocTab("box:b_1", "contents");
    renderBoxCentre(host, { ...box, contract: ["Ticked at the-park every 60s"] }, () => {}, stubActions());
    const lines = [...host.querySelectorAll(".doc-contract")].map((n) => n.textContent);
    expect(lines).toEqual(["Ticked at the-park every 60s"]);
  });

  it("marks the rename field and puts the same sentence in its hint, rather than refusing", () => {
    const host = document.createElement("div");
    setDocTab("box:b_1", "contents");
    renderBoxCentre(host, { ...box, contract: ["Ticked at the-park every 60s"] }, () => {}, stubActions());
    const gid = host.querySelector<HTMLElement>(".doc-gid .gid")!;
    expect(gid.classList.contains("gid-bound")).toBe(true);
    expect(gid.title).toContain("Ticked at the-park every 60s");
    // Marked, never disabled: the refusal is the server's, on push.
    expect(gid.hasAttribute("disabled")).toBe(false);
  });

  it("says one line per venue for a project that tours", () => {
    const host = document.createElement("div");
    setDocTab("box:b_1", "contents");
    renderBoxCentre(host, {
      ...box, contract: ["Ticked at the-park every 60s", "Ticked at the-pier every 90s"],
    }, () => {}, stubActions());
    expect(host.querySelectorAll(".doc-contract")).toHaveLength(2);
  });
});

describe("box page", () => {
  it("Contents lists content only; setup rides the tab bar beside Card template", () => {
    const host = document.createElement("div");
    setDocTab("box:b_1", "contents");
    renderBoxCentre(host, box, () => {}, stubActions());
    const tabs = [...host.querySelectorAll(".doc-tab")].map((t) => t.textContent);
    // Zero counts SHOW (audit C15): a dimmed tab with no number read as
    // disabled, and dim-with-a-zero is learnable as "empty".
    // Maps leads and is ALWAYS offered, with no count when there is none: the tab
    // used to appear only once a spatial group existed, which left the word "map"
    // nowhere in the editor until after you had made one.
    expect(tabs).toEqual(["Maps", "Contents", "Dealing", "Card template0", "Hand templates1", "Tags1", "Properties0"]);
    const rows = [...host.querySelectorAll(".listrow .listname")].map((r) => r.textContent);
    expect(rows).toEqual(["Decks", "Hands"]);
  });

  it("the Hand templates tab lists templates and opens their editors", () => {
    const host = document.createElement("div");
    const inspectTemplate = vi.fn();
    setDocTab("box:b_1", "templates");
    renderBoxCentre(host, box, () => {}, stubActions({ inspectTemplate }));
    const row = [...host.querySelectorAll<HTMLButtonElement>(".listrow")].find((r) => r.textContent?.includes("street-hands"))!;
    row.click();
    expect(inspectTemplate).toHaveBeenCalledWith("b_1", "t_1");
    expect([...host.querySelectorAll(".listrow.ghost")].map((g) => g.textContent)).toEqual(["+ New hand template"]);
  });

  it("a box with a map LEADS with it, and lands on it", () => {
    // A place that has been drawn is what the box is: opening it to two rows
    // saying Decks and Hands, with the drawing behind a tab, buries it.
    const host = document.createElement("div");
    const mounted = vi.fn();
    // The DEFAULT is what is under test, so the type-level tab memory (which
    // deliberately follows the author from page to page) is reset to the
    // fresh-sitting state a project open gives it.
    resetDocTabMemory();
    const mapped: BoxDto = { ...box, id: "b_map", tagGroups: [{ ...box.tagGroups[0]!, spatial: true }] };
    renderBoxCentre(host, mapped, () => {}, stubActions({ mountMapView: mounted }));
    const tabs = [...host.querySelectorAll(".doc-tab")].map((t) => t.textContent);
    // "Maps", plural and counted like its siblings: the tab holds one map per
    // spatial group, with a picker inside it.
    expect(tabs[0]).toMatch(/^Maps/);
    expect(host.querySelector(".doc-tab.on")?.textContent).toMatch(/^Maps/);
    expect(mounted).toHaveBeenCalled();
  });

  it("holds the tab the author picked, map or not", () => {
    const host = document.createElement("div");
    const mapped: BoxDto = { ...box, id: "b_map2", tagGroups: [{ ...box.tagGroups[0]!, spatial: true }] };
    setDocTab("box:b_map2", "dealing");
    renderBoxCentre(host, mapped, () => {}, stubActions());
    expect(host.querySelector(".doc-tab.on")?.textContent).toBe("Dealing");
  });

  it("stays on Maps when the remembered map has stopped being one, and explains itself", () => {
    // This USED to fall back to Contents, and that was right while unmarking a
    // group took the tab away with it: a page remembering its way somewhere that
    // no longer existed was how a stale memory emptied a screen.
    //
    // The tab is permanent now and has something to say, so falling back would
    // move somebody without telling them why their map went. Staying put and
    // explaining is the better answer, and it names the way back.
    const host = document.createElement("div");
    setDocTab("box:b_1", "map");
    renderBoxCentre(host, box, () => {}, stubActions());
    const notes = [...host.querySelectorAll(".doc-tab-note")].map((n) => n.textContent ?? "");
    expect(notes[0]).toContain("A map is a tag group you can draw");
    // And that it need not be geography, which the words around it all imply.
    expect(notes[1]).toContain("does not have to be geography");
    expect([...host.querySelectorAll(".listrow")].map((r) => r.textContent)).toEqual(["+ New map"]);
    setDocTab("box:b_1", "contents");
  });

  it("the Tags tab lists tag groups with their tags as chips", () => {
    const host = document.createElement("div");
    const inspectTagGroup = vi.fn();
    setDocTab("box:b_1", "tags");
    renderBoxCentre(host, box, () => {}, stubActions({ inspectTagGroup }));
    const row = [...host.querySelectorAll<HTMLButtonElement>(".listrow")].find((r) => r.textContent?.includes("zone"))!;
    expect(row.textContent).toContain("docks");
    row.click();
    expect(inspectTagGroup).toHaveBeenCalledWith("b_1", "d_1");
    setDocTab("box:b_1", "contents");   // leave the shared tab state clean
  });
});

describe("deck centre", () => {
  it("shows cards as title + beat, no ranking clutter, and a faded new-card ghost", () => {
    const host = document.createElement("div");
    const inspectCard = vi.fn();
    const catalogue = [{ scope: "hand", name: "danger", type: "number" as const }];
    renderDeckCentre(host, box, deck, catalogue, new Set(), "cards", () => {}, stubActions({ inspectCard }));
    const card = host.querySelector<HTMLButtonElement>(".scard:not(.ghost)")!;
    expect(card.querySelector("h3")!.textContent).toBe("Ambush at the ford");
    expect(card.querySelector(".beat")!.textContent).toContain("Cutthroats");
    expect(card.textContent).not.toContain("priority");   // machinery is in the inspector
    expect(card.textContent).not.toContain("redraw");
    // The eligibility condition rides as a restrained read-only "if" preview.
    const when = card.querySelector(".cardwhen")!;
    expect(when.querySelector(".cardwhen-if")!.textContent).toBe("if");
    expect(when.textContent).toContain("danger");
    expect(host.querySelector(".scard.ghost")).not.toBeNull();
  });

  it("click selects a card, double-click opens it (the Finder rule, all three views)", () => {
    // Single click used to open. It became a trapdoor once a card was a full
    // centre document rather than a pane beside the list, and it made selecting
    // two cards impossible. See the gesture note in views.ts.
    const host = document.createElement("div");
    const inspectCard = vi.fn();
    const selectCard = vi.fn();
    renderDeckCentre(host, box, deck, [], new Set(), "cards", () => {}, stubActions({ inspectCard, selectCard }));
    const card = host.querySelector<HTMLButtonElement>(".scard:not(.ghost)")!;

    card.click();
    expect(selectCard).toHaveBeenCalledWith("c_1", false);
    expect(inspectCard).not.toHaveBeenCalled();

    card.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    expect(selectCard).toHaveBeenLastCalledWith("c_1", true);   // extends, not replaces

    card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(inspectCard).toHaveBeenCalledWith("b_1", "k_1", "c_1");
  });

  it("shows the selection every view shares", () => {
    const host = document.createElement("div");
    renderDeckCentre(host, box, deck, [], new Set(["c_1"]), "cards", () => {}, stubActions());
    expect(host.querySelector(".scard.sel")).not.toBeNull();
  });

  it("right-clicking a card opens a Duplicate / Delete context menu", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const duplicateCard = vi.fn();
    const deleteCard = vi.fn();
    renderDeckCentre(host, box, deck, [], new Set(), "cards", () => {}, stubActions({ duplicateCard, deleteCard }));
    const card = host.querySelector<HTMLButtonElement>(".scard:not(.ghost)")!;
    card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    const menu = document.querySelector(".ctxmenu")!;
    expect(menu).not.toBeNull();
    const items = [...menu.querySelectorAll<HTMLButtonElement>(".ctxmenu-item")].map((b) => b.textContent);
    // "Links..." first: it is the one that asks a question rather than changing
    // something, and the two that change something stay together at the bottom.
    expect(items).toEqual(["Links...", "Duplicate", "Delete"]);
    menu.querySelectorAll<HTMLButtonElement>(".ctxmenu-item")[1]!.click();   // Duplicate
    expect(duplicateCard).toHaveBeenCalledWith("b_1", "k_1", "c_1");
    expect(document.querySelector(".ctxmenu")).toBeNull();             // dismissed on action
  });

  it("asks the Links lens about the card under the pointer", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const showLinks = vi.fn();
    renderDeckCentre(host, box, deck, [], new Set(), "cards", () => {}, stubActions({ showLinks }));
    const card = host.querySelector<HTMLButtonElement>(".scard:not(.ghost)")!;
    card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    document.querySelector<HTMLButtonElement>(".ctxmenu-item")!.click();   // Links...
    // The card the pointer was over, whatever the editor happens to have open.
    expect(showLinks).toHaveBeenCalledWith("c_1");
  });

  it("table view lists cards in a table; the toggle switches mode", () => {
    const host = document.createElement("div");
    const inspectCard = vi.fn();
    const setViewMode = vi.fn();
    renderDeckCentre(host, box, deck, [], new Set(), "table", () => {}, stubActions({ inspectCard, setViewMode }));
    const rows = host.querySelectorAll("table.ctable tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector(".ct-title")!.textContent).toBe("Ambush at the ford");
    // Same grammar as the card view: click selects, double-click opens.
    (rows[0] as HTMLElement).click();
    expect(inspectCard).not.toHaveBeenCalled();
    rows[0]!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(inspectCard).toHaveBeenCalledWith("b_1", "k_1", "c_1");
    // The toggle offers a card-view button that switches mode.
    // Found by its rollover, which is the themed `data-tip` now rather than the
    // platform's `title` (app-shell's tooltip controller reads that attribute).
    const cardsBtn = [...host.querySelectorAll<HTMLButtonElement>(".viewbtn")].find((b) => b.dataset["tip"] === "Card view")!;
    cardsBtn.click();
    expect(setViewMode).toHaveBeenCalledWith("cards");
  });

  it("dragging one card row onto another calls moveCard", () => {
    const host = document.createElement("div");
    const two: DeckDto = { ...deck, cards: [
      deck.cards[0]!,
      { id: "c_2", gameId: "rat-job", title: "A rat job", priority: 1, redraw: "always", tags: [], copies: "", sharedCopies: "", fields: [], outcomes: [] },
    ] };
    const moveCard = vi.fn();
    renderDeckCentre(host, box, two, [], new Set(), "table", () => {}, stubActions({ moveCard }));
    const rows = host.querySelectorAll<HTMLElement>("table.ctable tbody tr");
    rows[0]!.dispatchEvent(new MouseEvent("dragstart"));
    rows[1]!.dispatchEvent(new MouseEvent("dragover", { clientX: 5, clientY: 5 }));
    rows[1]!.dispatchEvent(new MouseEvent("drop"));
    expect(moveCard).toHaveBeenCalledWith("b_1", "k_1", "c_1", "c_2", expect.any(Boolean));
  });

  it("previews a check_flags condition compactly (quests: +main), not check_flags(...)", () => {
    const host = document.createElement("div");
    const flagDeck: DeckDto = {
      id: "k_2", gameId: "quest", properties: [], cards: [{
        id: "c_2", gameId: "reveal", title: "The reveal", purpose: "A secret surfaces.",
        condition: "check_flags(@story.quests, +main, -done)", priority: 0, redraw: "always",
        tags: [], copies: "", sharedCopies: "", fields: [], outcomes: [],
      }],
    };
    const catalogue = [{ scope: "story", name: "quests", type: "flags" as const, enumValues: ["main", "done"] }];
    renderDeckCentre(host, box, flagDeck, catalogue, new Set(), "cards", () => {}, stubActions());
    const when = host.querySelector(".cardwhen")!;
    // Compact form from the shared expr-editor: property, colon, flag pills.
    expect(when.textContent).toContain("quests");
    expect(when.textContent).toContain("+main");
    expect(when.textContent).toContain("-done");
    expect(when.textContent).not.toContain("check_flags");
    expect(when.textContent).not.toContain("(");
  });
});

describe("problems bar", () => {
  const problems = [
    { severity: "error" as const, path: "encounters/decks/docks.storyletdeck", message: "unknown property @story.gone" },
    { severity: "warning" as const, path: "x", message: "not in canonical form" },
  ];

  it("hides when clean", () => {
    const host = document.createElement("div");
    renderProblems(host, [], 0, () => {}, () => {}, vi.fn());
    expect(host.hidden).toBe(true);
  });

  it("shows ONE problem, with the count and where in the list it is", () => {
    const host = document.createElement("div");
    renderProblems(host, problems, 0, () => {}, () => {}, vi.fn());
    expect(host.hidden).toBe(false);
    expect(host.querySelector(".stepbar-count")!.textContent).toBe("2");
    expect(host.querySelector(".stepbar-of")!.textContent).toBe("1/2");
    expect(host.querySelectorAll(".stepbar-msg").length).toBe(1);
    expect(host.querySelector(".stepbar-msg")!.textContent).toBe(problems[0]!.message);
  });

  it("speaks names when the caller can resolve them, paths only as the fallback", () => {
    // The audit read `items/decks/street-tech.storyletdeck [burner-rig/continue]`
    // where a person thinks "Burner Rig › Continue": storage paths are the
    // fallback, never the voice.
    const host = document.createElement("div");
    renderProblems(host, problems, 0, () => {}, () => {}, vi.fn(),
      (p) => (p.path.includes("docks") ? "Ambush at the ford › Flee" : undefined));
    expect(host.querySelector(".stepbar-where")!.textContent).toBe("Ambush at the ford › Flee");
    renderProblems(host, problems, 1, () => {}, () => {}, vi.fn(),
      (p) => (p.path.includes("docks") ? "Ambush at the ford › Flee" : undefined));
    expect(host.querySelector(".stepbar-where")!.textContent).toBe("x");
  });

  it("steps, and wraps at both ends", () => {
    const host = document.createElement("div");
    const step = vi.fn();
    renderProblems(host, problems, 0, step, () => {}, vi.fn());
    const [prev, next] = [...host.querySelectorAll<HTMLButtonElement>(".stepbar-nav")];
    next!.click();
    expect(step).toHaveBeenLastCalledWith(1);
    prev!.click();                       // from the first, back to the last
    expect(step).toHaveBeenLastCalledWith(1);

    renderProblems(host, problems, 1, step, () => {}, vi.fn());
    host.querySelectorAll<HTMLButtonElement>(".stepbar-nav")[1]!.click();
    expect(step).toHaveBeenLastCalledWith(0);
  });

  it("offers no steppers for a single problem, and no 'details' to open", () => {
    // The bug this shape replaced: with one problem, "details" opened a second
    // bar that said the same sentence again.
    const host = document.createElement("div");
    renderProblems(host, [problems[0]!], 0, () => {}, () => {}, vi.fn());
    expect(host.querySelectorAll(".stepbar-nav").length).toBe(0);
    expect(host.textContent).not.toContain("details");
    expect(host.querySelectorAll(".stepbar-msg").length).toBe(1);
  });

  it("jumps from the message, which is the whole point of the bar", () => {
    const host = document.createElement("div");
    const jump = vi.fn();
    renderProblems(host, problems, 1, () => {}, jump, vi.fn());
    host.querySelector<HTMLButtonElement>(".stepbar-cur")!.click();
    expect(jump).toHaveBeenCalledWith(problems[1]);
  });

  it("clamps an index the list has outgrown rather than drawing nothing", () => {
    const host = document.createElement("div");
    renderProblems(host, [problems[0]!], 5, () => {}, () => {}, vi.fn());
    expect(host.querySelector(".stepbar-msg")!.textContent).toBe(problems[0]!.message);
  });
});

describe("cardHasContent (the delete guard)", () => {
  // Delete is guarded only when there is something to lose (Patter's pattern).
  // A freshly created card is a placeholder and goes without ceremony; the moment
  // an author has typed or gated or tagged anything, deleting it asks first.
  const fresh = (over: Partial<CardDto> = {}): CardDto => ({
    id: "c_n", gameId: "new-card", title: "New card", priority: 0, redraw: "always",
    tags: [], copies: "", sharedCopies: "", fields: [], outcomes: [{ id: "o_1", gameId: "continue", title: "Continue", changes: [] }],
    ...over,
  });

  it("treats an untouched new card as empty", () => {
    expect(cardHasContent(fresh())).toBe(false);
    expect(cardHasContent(fresh({ title: "New card 4" }))).toBe(false);
    expect(cardHasContent(fresh({ title: undefined }))).toBe(false);
  });

  it("counts anything an author actually did", () => {
    expect(cardHasContent(fresh({ title: "Arrive at the inn" }))).toBe(true);
    expect(cardHasContent(fresh({ purpose: "A hooded figure waits." }))).toBe(true);
    expect(cardHasContent(fresh({ condition: "@story.act == 1" }))).toBe(true);
    expect(cardHasContent(fresh({ tags: [{ group: "zone", values: ["docks"] }] }))).toBe(true);
    expect(cardHasContent(fresh({ fields: [{ name: "scene", value: "scn_gate" }] }))).toBe(true);
  });

  it("counts an authored outcome, but not the default one", () => {
    expect(cardHasContent(fresh({ outcomes: [
      { id: "o_1", gameId: "continue", title: "Continue", changes: ["@story.gold ← 1"] },
    ] }))).toBe(true);
    expect(cardHasContent(fresh({ outcomes: [
      { id: "o_1", gameId: "a", title: "A", changes: [] },
      { id: "o_2", gameId: "b", title: "B", changes: [] },
    ] }))).toBe(true);
  });

  it("does not count whitespace as content", () => {
    expect(cardHasContent(fresh({ purpose: "   ", condition: " " }))).toBe(false);
    expect(cardHasContent(fresh({ fields: [{ name: "scene", value: "  " }] }))).toBe(false);
    expect(cardHasContent(fresh({ tags: [{ group: "zone", values: [] }] }))).toBe(false);
  });
});
