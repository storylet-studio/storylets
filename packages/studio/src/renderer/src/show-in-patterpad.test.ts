// Show Scene in Patterpad when Storyletter can't find Patterpad (the Patterpad
// review, 2026-10-07): asked in the window, in the shell's confirm, as Patterpad
// asks its mirror, never in a native message box.
import { describe, expect, it, vi } from "vitest";

const asked: { title: string; body: string; confirmLabel?: string }[] = [];
let answer = true;
vi.mock("@wildwinter/app-shell", () => ({
  confirmDialog: async (o: { title: string; body: string; confirmLabel?: string }) => { asked.push(o); return answer; },
}));

const { showInPatterpad } = await import("./show-in-patterpad.js");
import type { StudioApi } from "../../shared/api.js";

const studioWith = (found: boolean): { studio: StudioApi; calls: (boolean | undefined)[] } => {
  const calls: (boolean | undefined)[] = [];
  const studio = {
    editInPatterpad: async (_card: string, locate?: boolean) => {
      calls.push(locate);
      if (!found && locate !== true) return { locate: { title: "Storyletter can't find Patterpad", body: "Point to it once." } };
      return { address: "the-gate", published: true };
    },
  } as unknown as StudioApi;
  return { studio, calls };
};

describe("showInPatterpad", () => {
  it("opens straight away when Patterpad is found, asking nothing", async () => {
    asked.length = 0;
    const { studio, calls } = studioWith(true);
    expect(await showInPatterpad(studio, "c_1")).toEqual({ address: "the-gate", published: true });
    expect(asked).toHaveLength(0);
    expect(calls).toEqual([undefined]);
  });

  it("asks in the window, then goes back to main to locate it", async () => {
    asked.length = 0; answer = true;
    const { studio, calls } = studioWith(false);
    expect(await showInPatterpad(studio, "c_1")).toEqual({ address: "the-gate", published: true });
    expect(asked).toEqual([{ title: "Storyletter can't find Patterpad", body: "Point to it once.", confirmLabel: "Locate Patterpad…" }]);
    expect(calls).toEqual([undefined, true]);
  });

  it("stops at Cancel", async () => {
    asked.length = 0; answer = false;
    const { studio, calls } = studioWith(false);
    expect(await showInPatterpad(studio, "c_1")).toBeNull();
    expect(calls).toEqual([undefined]);
  });
});
