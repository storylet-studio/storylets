// A deck keeps its colour when renamed (Ian's ruling, 2026-10-28). A deck is
// coloured by its title's hash until its first rename, which stores the OLD
// title's slot in the box's view sidecar (model `DeckCanvas.colour`), in the
// rename's own undo step. A deck never renamed has nothing stored, and the
// slot is the editor's: it never reaches the bundle.

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashColour } from "@wildwinter/app-shell";
import { compileProject } from "@storylet-studio/compiler";
import { openProject } from "./project.js";
import { renameDeck, saveCard, undo } from "./mutate.js";
import { linksFor } from "./read/links.js";
import type { ProjectSession } from "./project.js";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));

function scratchProject(): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-deck-colour-")), "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

const docks = "k_docks";
const viewFile = (session: ProjectSession): string => join(session.loaded.dir, "encounters", "view.storyletview");
const deckDto = (session: ProjectSession) => session.dto.boxes[0]!.decks.find((d) => d.id === docks)!;

describe("a deck's colour across a rename", () => {
  it("stores the old title's colour on the first rename, in the same undo step", async () => {
    const session = scratchProject();
    const before = deckDto(session);
    const oldName = before.title ?? before.gameId;
    expect(before.colour).toBeUndefined();
    expect(existsSync(viewFile(session))).toBe(false);

    const r = await renameDeck(session, docks, { title: "The Waterfront" });
    if ("error" in r) throw new Error(r.error);
    expect(deckDto(session).title).toBe("The Waterfront");
    expect(deckDto(session).colour).toBe(hashColour(oldName));
    expect(readFileSync(viewFile(session), "utf8")).toContain(`colour: ${hashColour(oldName)}`);

    // One Undo takes back the rename and the stored colour together.
    await undo(session);
    expect(deckDto(session).title).toBe(oldName);
    expect(deckDto(session).colour).toBeUndefined();
    expect(existsSync(viewFile(session))).toBe(false);
  });

  it("keeps the first stored colour through later renames", async () => {
    const session = scratchProject();
    const oldName = deckDto(session).title ?? deckDto(session).gameId;
    await renameDeck(session, docks, { title: "The Waterfront" });
    await saveCard(session, docks, deckDto(session).cards[0]!.id, { title: "Something else" });   // a different step
    await renameDeck(session, docks, { title: "The Quays" });
    expect(deckDto(session).colour).toBe(hashColour(oldName));
  });

  it("stores nothing for an edit that leaves the name alone", async () => {
    const session = scratchProject();
    const r = await renameDeck(session, docks, { purpose: "Harbour-side beats." });
    if ("error" in r) throw new Error(r.error);
    expect(deckDto(session).colour).toBeUndefined();
    expect(existsSync(viewFile(session))).toBe(false);
  });

  it("gives the Links window the stored colour with the deck's title", async () => {
    const session = scratchProject();
    const oldName = deckDto(session).title ?? deckDto(session).gameId;
    await renameDeck(session, docks, { title: "The Waterfront" });
    const card = deckDto(session).cards[0]!.id;
    const view = linksFor(session, card, undefined, false);
    expect(view.card).toMatchObject({ deckTitle: "The Waterfront", deckColour: hashColour(oldName) });
  });

  it("never reaches the bundle", async () => {
    const session = scratchProject();
    await renameDeck(session, docks, { title: "The Waterfront" });
    const renamed = session.loaded.source!;
    expect(renamed.boxes[0]!.view?.canvases?.[docks]?.colour).toBe(deckDto(session).colour);
    // The same project without the stored slot compiles to the same bytes.
    const stripped = { ...renamed, boxes: renamed.boxes.map((b) => { const { view: _view, ...rest } = b; return rest; }) };
    expect(JSON.stringify(compileProject(renamed).bundle)).toBe(JSON.stringify(compileProject(stripped).bundle));
    expect(JSON.stringify(compileProject(renamed).bundle)).not.toContain("colour");
  });
});
