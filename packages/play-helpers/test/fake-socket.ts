// A scriptable stand-in for a WebSocket: the tests drive open / message /
// close by hand and read back every string the client sent. The shape is the
// LiveSocketLike the client accepts, nothing more.
import type { LiveSocketLike } from "../src/live-link.js";

type Listener = (ev: { data: unknown }) => void;

export class FakeSocket implements LiveSocketLike {
  static instances: FakeSocket[] = [];
  /** The most recently constructed socket (the client makes exactly one). */
  static last(): FakeSocket {
    const s = FakeSocket.instances[FakeSocket.instances.length - 1];
    if (!s) throw new Error("no FakeSocket constructed");
    return s;
  }
  static reset(): void { FakeSocket.instances = []; }

  readyState = 0; // CONNECTING
  readonly url: string;
  readonly sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("send on a socket that is not open");
    this.sent.push(data);
  }
  close(): void { this.closed = true; this.readyState = 3; this.fire("close"); }
  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  // --- the test's side of the wire ----------------------------------------
  open(): void { this.readyState = 1; this.fire("open"); }
  fail(): void { this.readyState = 3; this.fire("error"); this.fire("close"); }
  /** The editor sent something. */
  receive(data: unknown): void { this.fire("message", { data }); }
  /** Every sent frame, parsed. */
  frames(): Record<string, unknown>[] { return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>); }
  /** The `t` of every sent frame, in order. */
  kinds(): string[] { return this.frames().map((f) => f.t as string); }

  private fire(type: string, ev: { data: unknown } = { data: undefined }): void {
    for (const l of this.listeners.get(type) ?? []) l(ev);
  }
}
