// A report with Undo (the October 2026 review: Undo replaces "Are you sure?"):
// the button takes back the step it reported, only while that step is still the
// newest, and says so instead when it isn't. A step that joined the one before,
// or none, gets the plain toast.
import { describe, expect, it, vi } from "vitest";

interface Shown { message: string; kind?: string; action?: { label: string; run(): void } }
const shown: Shown[] = [];
vi.mock("@wildwinter/app-shell", () => ({
  toast: (message: string, kind?: string, opts?: { action?: { label: string; run(): void } }) => {
    shown.push({ message, ...(kind !== undefined ? { kind } : {}), ...(opts?.action ? { action: opts.action } : {}) });
  },
}));

const { STALE_UNDO, toastWithUndo } = await import("./undo-toast.js");

/** Let the Undo's promise settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("toastWithUndo", () => {
  it("offers Undo for a step of its own, and asks for that step by id", async () => {
    shown.length = 0;
    const asked: number[] = [];
    toastWithUndo(async (id) => { asked.push(id); return "done"; }, "Deleted “The Road North”.", "info", { id: 7, merged: false });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ message: "Deleted “The Road North”.", kind: "info", action: { label: "Undo" } });
    shown[0]!.action!.run();
    await settle();
    expect(asked).toEqual([7]);
    expect(shown).toHaveLength(1);   // done: nothing more to say
  });

  it("says it's no longer the latest change, and does nothing, when the step is stale", async () => {
    shown.length = 0;
    toastWithUndo(async () => "stale", "Deleted 3 cards.", "info", { id: 2, merged: false });
    shown[0]!.action!.run();
    await settle();
    expect(shown[1]).toEqual({ message: STALE_UNDO });
    expect(STALE_UNDO).toBe("That's no longer the latest change. Undo in the Edit menu steps back to it.");
  });

  it("is a plain toast for a step that joined the one before, or for none", () => {
    shown.length = 0;
    const undo = vi.fn(async () => "done" as const);
    toastWithUndo(undo, "Merged.", "ok", { id: 3, merged: true });
    toastWithUndo(undo, "Merged.", "ok", undefined);
    expect(shown).toEqual([{ message: "Merged.", kind: "ok" }, { message: "Merged.", kind: "ok" }]);
    expect(undo).not.toHaveBeenCalled();
  });
});
