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

export {
  REMOTE_STATUS_THROTTLE_MS, resetShardStatus, setStatusReader, shardStatus,
} from "@wildwinter/app-shell/vc-status";
export type { ShardRef, ShardState, ShardStatus } from "@wildwinter/app-shell/vc-status";

setVcLogPrefix("storyletter");
