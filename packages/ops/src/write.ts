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

/**
 * One write of a plan that holds both kinds, in the order the plan wants them
 * committed: an export's map pictures, bundle and scopes file are one list, so
 * the CLI and Storyletter cannot write them in two different orders. The
 * caller still decides what to do with bytes, through `isBinaryWrite`.
 */
export type PlannedFileWrite = PlannedWrite | PlannedBinaryWrite;

/** Is this write bytes rather than text? */
export const isBinaryWrite = (write: PlannedFileWrite): write is PlannedBinaryWrite => "bytes" in write;
