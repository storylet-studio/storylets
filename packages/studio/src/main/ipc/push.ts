// ---------------------------------------------------------------------------
// Sending a window something unasked, on a channel of the contract's
// (shared/api.ts `PUSH_CHANNELS`): the name and the payload are checked. A
// thin wrapper on purpose, with no electron import: the caller keeps its own
// guard on a destroyed window, as each always has.
// ---------------------------------------------------------------------------

import type { WebContents } from "electron";
import type { PushArgs, PushChannel } from "../../shared/api.js";

export function push<C extends PushChannel>(to: WebContents, channel: C, ...payload: PushArgs<C>): void {
  to.send(channel, ...payload);
}
