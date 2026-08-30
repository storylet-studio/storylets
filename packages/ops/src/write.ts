/** A planned file write: ops functions return these; callers commit them
 *  through the VC layer (simple-vc-lib), never raw fs. */
export interface PlannedWrite {
  path: string;
  content: string;
}

/**
 * A planned BINARY write: an asset, kept in its own type on purpose.
 *
 * Assets could have been folded into `PlannedWrite` by widening `content`, and
 * that would have been less code and a worse idea. A shard is text a human
 * reads, git merges and the studio snapshots into its undo history as a string;
 * a picture is none of those. Separate types make every caller decide what to do
 * with bytes instead of silently handing them to something built for text.
 */
export interface PlannedBinaryWrite {
  path: string;
  bytes: Uint8Array;
}
