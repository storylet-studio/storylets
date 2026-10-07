// ---------------------------------------------------------------------------
// Whether the Board's link to Patterpad is up, judged by ITS socket.
//
// The Board hands play-helpers' `createDebugLink` a WebSocket class that says
// when it opens, so the Board knows when to try again. That used to be one flag
// every socket wrote to. A rebuild (Restart, a stale refresh) closes the old
// link and opens a new one, and the OLD socket's close arrives after the new one
// has opened, so the flag said "down" while the link was up, and the retry tore
// a working link down and connected again, every ten seconds. Now only the
// latest socket counts.
// ---------------------------------------------------------------------------

/** The WebSocket shape the tracker needs: a constructor taking a URL, and a
 *  readyState with the standard OPEN and CONNECTING values. */
export interface SocketClass {
  new (url: string): { readonly readyState: number };
  readonly OPEN: number;
  readonly CONNECTING: number;
}

export interface SocketTracker<S extends SocketClass> {
  /** The class to hand `createDebugLink`: each one made is the latest. */
  Socket: S;
  /** Is the latest socket open, or still opening? Nothing made yet: no. */
  live: () => boolean;
  /** Forget the latest socket (the link it belonged to was closed). */
  forget: () => void;
}

export function trackSockets<S extends SocketClass>(Base: S): SocketTracker<S> {
  let latest: { readonly readyState: number } | undefined;
  // A subclass, so play-helpers constructs it exactly as it would the real one.
  const Tracked = class extends (Base as unknown as new (url: string) => { readonly readyState: number }) {
    constructor(url: string) {
      super(url);
      latest = this;
    }
  } as unknown as S;
  return {
    Socket: Tracked,
    live: () => latest !== undefined && (latest.readyState === Base.OPEN || latest.readyState === Base.CONNECTING),
    forget: () => { latest = undefined; },
  };
}
