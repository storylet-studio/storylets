// The comment name's offer (offeredIdentity): with a project open, that working copy's VCS says; with none
// open, which is when the box first asks, git's own user.name for the machine, read from the home folder
// (Patter's hands-on step 6, Q20). It came back empty before a project was open.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";

const vc = vi.hoisted(() => ({
  currentUserAsync: vi.fn<(dir?: string) => Promise<string | undefined>>(),
  gitUser: vi.fn<(dir?: string) => Promise<string | undefined>>(),
}));

vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));
vi.mock("@wildwinter/simple-vc-lib", () => ({
  currentUserAsync: vc.currentUserAsync,
  GitProvider: class { currentUserAsync(dir?: string) { return vc.gitUser(dir); } },
}));

const { offeredIdentity } = await import("./state.js");

describe("the comment name's offer", () => {
  beforeEach(() => { vc.currentUserAsync.mockReset(); vc.gitUser.mockReset(); });

  it("asks the open project's working copy", async () => {
    vc.currentUserAsync.mockResolvedValue("Ada Lovelace");
    expect(await offeredIdentity("/work/saltmarsh.storylets")).toBe("Ada Lovelace");
    expect(vc.currentUserAsync).toHaveBeenCalledWith("/work/saltmarsh.storylets");
    expect(vc.gitUser).not.toHaveBeenCalled();
  });

  it("with no project open, reads git's user.name from the home folder", async () => {
    vc.gitUser.mockResolvedValue("Ada Lovelace");
    expect(await offeredIdentity(undefined)).toBe("Ada Lovelace");
    expect(vc.gitUser).toHaveBeenCalledWith(homedir());
    expect(vc.currentUserAsync).not.toHaveBeenCalled();
  });

  it("offers nothing when git can't say, or fails", async () => {
    vc.gitUser.mockResolvedValue(undefined);
    expect(await offeredIdentity(undefined)).toBeUndefined();
    vc.gitUser.mockRejectedValue(new Error("git not found"));
    expect(await offeredIdentity(undefined)).toBeUndefined();
  });
});
