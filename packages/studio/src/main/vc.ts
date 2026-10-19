// ---------------------------------------------------------------------------
// Per-shard version-control state: the shell's, named for this app.
//
// The module itself moved to @wildwinter/app-shell/vc-status (2026-08-09):
// it follows from the app SHAPE - an Electron editor over JSON shards in a
// working copy - rather than from anything about storylets, and it had already
// been written twice. What stays here is the one thing that is ours: which
// SHARDS exist, which is decided by whoever calls `shardStatus`.
// ---------------------------------------------------------------------------

import { setVcLogPrefix } from "@wildwinter/app-shell/vc-status";
import {
  FilesystemProvider, GitProvider, PerforceProvider, PlasticProvider, SvnProvider, clearProvider, setProvider,
} from "@wildwinter/simple-vc-lib";
import type { VcsKind } from "@storylet-studio/model";

export {
  REMOTE_STATUS_THROTTLE_MS, resetShardStatus, setStatusReader, shardStatus,
} from "@wildwinter/app-shell/vc-status";
export type { ShardRef, ShardState, ShardStatus } from "@wildwinter/app-shell/vc-status";

setVcLogPrefix("storyletter");

/**
 * Talk to the project's own version control system and no other (Patterpad's `pinVcProvider`).
 *
 * Left to itself the library walks UP from each file and takes any enclosing `.git` as the project's
 * system, so a project kept out of version control inside a larger git checkout would have its writes
 * `git add`ed into that unrelated repository, and its status polls run `git lfs locks` (Patterpad's
 * #26, a credential prompt on a loop on Windows); a Perforce project under a stray `.git` is read as
 * git. A system named in the project is that system; `"none"` is plain writes with no version control
 * calls. A project that names nothing, every project made before the setting, is found from the
 * folders as it always was.
 */
export function pinVcProvider(vcs: VcsKind | "none" | undefined): void {
  switch (vcs) {
    case "git": setProvider(new GitProvider()); break;
    case "perforce": setProvider(new PerforceProvider()); break;
    case "plastic": setProvider(new PlasticProvider()); break;
    case "svn": setProvider(new SvnProvider()); break;
    case "none": setProvider(new FilesystemProvider()); break;
    default: clearProvider(); break;
  }
  pinned = vcs;
}

let pinned: VcsKind | "none" | undefined;
/** The setting the provider was last pinned for, so a reload re-pins only when it changed. */
export const pinnedVcs = (): VcsKind | "none" | undefined => pinned;
