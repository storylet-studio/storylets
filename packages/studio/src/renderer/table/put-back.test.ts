// @vitest-environment jsdom
// Putting a card back on the Board (session.ts putBack): a card whose Patter
// scene has already changed something asks first, and its changes stay
// (ruled 2026-10-28); a card whose scene changed nothing goes back at once.

import { beforeEach, describe, expect, it, vi } from "vitest";

const confirm = vi.fn<(o: { title: string; body: string; confirmLabel: string }) => Promise<boolean>>();
vi.mock("@wildwinter/app-shell", async (orig) => ({ ...(await orig<object>()), confirmDialog: (o: never) => confirm(o) }));

const { putBack } = await import("./session.js");
import type { Board } from "./board-state.js";

function board(wrote: number): Board {
  const state = {
    open: { card: "c_gate", hand: "h_1" }, pending: undefined, asking: false,
    performing: { card: "c_gate" }, performingWrote: wrote,
  };
  return { state, render: vi.fn() } as unknown as Board;
}

beforeEach(() => confirm.mockReset());

describe("putBack", () => {
  it("puts a card back at once when its scene has changed nothing", async () => {
    const b = board(0);
    await putBack(b);
    expect(confirm).not.toHaveBeenCalled();
    expect(b.state.open).toBeUndefined();
  });

  it("asks first when the scene has changed something, and keeps the card open on Cancel", async () => {
    const b = board(2);
    confirm.mockResolvedValue(false);
    await putBack(b);
    expect(confirm.mock.calls[0]![0].body).toBe("Its Patter scene has already changed 2 values. Those changes stay, and the card isn't played.");
    expect(b.state.open).toEqual({ card: "c_gate", hand: "h_1" });
    expect(b.state.asking).toBe(false);
  });

  it("puts it back on a yes", async () => {
    const b = board(1);
    confirm.mockResolvedValue(true);
    await putBack(b);
    expect(b.state.open).toBeUndefined();
  });
});
