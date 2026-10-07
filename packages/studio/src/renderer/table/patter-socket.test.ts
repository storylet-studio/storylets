// The Board's link to Patterpad is judged by its LATEST socket (patter-socket.ts):
// an old link's close, landing after its replacement opened, no longer reads as
// the link going down and tearing a working one up every ten seconds.

import { describe, expect, it } from "vitest";
import { trackSockets } from "./patter-socket.js";

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = FakeSocket.CONNECTING;
  constructor(readonly url: string) {}
}

describe("trackSockets", () => {
  it("says nothing is live before a socket is made", () => {
    expect(trackSockets(FakeSocket).live()).toBe(false);
  });

  it("follows the latest socket, whatever an older one does", () => {
    const tracker = trackSockets(FakeSocket);
    const first = new tracker.Socket("ws://127.0.0.1:4471") as FakeSocket;
    first.readyState = FakeSocket.OPEN;
    tracker.forget();   // the rebuild closes the old link...
    const second = new tracker.Socket("ws://127.0.0.1:4471") as FakeSocket;
    second.readyState = FakeSocket.OPEN;   // ...and the new one opens
    first.readyState = FakeSocket.CLOSED;  // then the old close lands
    expect(tracker.live()).toBe(true);
    second.readyState = FakeSocket.CLOSED;
    expect(tracker.live()).toBe(false);
  });

  it("counts a socket still opening as live, so the retry does not pile up", () => {
    const tracker = trackSockets(FakeSocket);
    new tracker.Socket("ws://127.0.0.1:4471");
    expect(tracker.live()).toBe(true);
  });

  it("makes real instances of the class it wraps", () => {
    const tracker = trackSockets(FakeSocket);
    expect(new tracker.Socket("ws://x")).toBeInstanceOf(FakeSocket);
  });
});
