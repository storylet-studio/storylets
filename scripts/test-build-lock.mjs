// One build at a time across the test suites that build a real app in their
// setup (the Village client and the Hamlet client). Each writes
// its own dist, but the Hamlet suite also rebuilds the libraries when their
// dist is missing, which on a cold runner is while the other two read them:
// a full run then fails one file with its tests skipped, and passes on the
// next run. Seen 2026-09-05. A directory is the lock because mkdir is atomic.
import { mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const lockDir = join(fileURLToPath(new URL("..", import.meta.url)), ".build.lock");
const STALE_MS = 10 * 60 * 1000;
const WAIT_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` holding the repo's build lock, waiting for a holder to finish. */
export async function withBuildLock(fn) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > STALE_MS) rmSync(lockDir, { recursive: true, force: true });
      } catch { /* gone between the two calls: try again */ }
      if (Date.now() > deadline) throw new Error(`build lock at ${lockDir} held for over ${WAIT_MS / 60000} minutes`);
      await sleep(100);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
