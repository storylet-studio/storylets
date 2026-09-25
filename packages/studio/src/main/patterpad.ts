// ---------------------------------------------------------------------------
// Edit Scene in Patterpad: open the paired Patter project (the project shard's
// `patter`) in Patterpad, at the scene named after a card (Reboot 10: a card's
// gameId is its scene's address).
//
// Patterpad already takes `patterpad <project> --at <address>` and forwards a
// second launch to the running app, which jumps in place when that project is
// already open (patter packages/patterpad/src/main/index.ts, the single-instance
// lock). So this starts the EXECUTABLE directly, never `open -a` on macOS: a
// cold `open` delivers the project through open-file and drops `--at`.
//
// Finding it: the author's own answer first (remembered per person, since where
// an app is installed differs between machines), then where each platform puts
// it. On macOS that is Spotlight by bundle id, then the two Applications
// folders; on Windows the per-user installer's default. Linux ships an
// AppImage, which lives wherever it was saved, so there the author points at it.
// ---------------------------------------------------------------------------

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Patterpad's appId (patter packages/patterpad/package.json, `build.appId`). */
export const PATTERPAD_BUNDLE_ID = "com.patterkit.patterpad";

/** The executable inside a macOS app bundle, or the path itself for anything else. */
export function patterpadExecutable(path: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" && path.endsWith(".app") ? join(path, "Contents", "MacOS", "Patterpad") : path;
}

/** Where Patterpad is on this machine, or undefined. `remembered` is the author's own answer. */
export function findPatterpad(remembered?: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const candidates: string[] = [];
  if (remembered) candidates.push(patterpadExecutable(remembered, platform));
  if (platform === "darwin") {
    try {
      const found = execFileSync("mdfind", [`kMDItemCFBundleIdentifier == '${PATTERPAD_BUNDLE_ID}'`], { encoding: "utf8", timeout: 3000 });
      for (const app of found.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".app"))) candidates.push(patterpadExecutable(app, platform));
    } catch { /* Spotlight off or slow: the fixed places below still count */ }
    candidates.push(
      patterpadExecutable("/Applications/Patterpad.app", platform),
      patterpadExecutable(join(homedir(), "Applications", "Patterpad.app"), platform),
    );
  } else if (platform === "win32") {
    const local = process.env["LOCALAPPDATA"];
    if (local) candidates.push(join(local, "Programs", "Patterpad", "Patterpad.exe"));
  }
  return candidates.find((c) => existsSync(c));
}

/** Start Patterpad on `projectDir`, at `address` when given. Detached: Patterpad outlives this app. */
export function launchPatterpad(executable: string, projectDir: string, address?: string): void {
  const args = address ? [projectDir, "--at", address] : [projectDir];
  const child = spawn(executable, args, { detached: true, stdio: "ignore" });
  child.unref();
}
