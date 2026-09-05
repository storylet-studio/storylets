# @storylet-studio/client

The Storylet Server's headless client: everything a front-end needs to be
correct, and nothing about how it looks.

```ts
import { createClient } from "@storylet-studio/client";

const client = createClient({ base: "http://venue.local:4470" });
const station = client.connectStation(key);

const { visit } = await station.handshake({ credential: "token", token });
visit.subscribe((state) => render(state.board, state.held));
await visit.deal();
await visit.play("who-let-you-in", "say-nothing", "at-the-door");
```

## Why this layer exists

The front-ends are not alike. A console is a control room and is rarely
changed; a companion page is the venue's brand and is nearly always rebuilt.
The rule that follows is the one this package is: **the thinner the UI we
expect to survive, the thicker the layer beneath it must be.**

So what a bespoke kiosk keeps when it throws every pixel away is everything
here: the wire, reconnect and replay, the handshake in both directions, the
visit lifecycle, the board and its events, degraded mode, and the offline
queueing of a play pressed during a wifi blip. What it replaces is the pixels.

No DOM, no framework, no dependency but `@storylet-studio/wire` (types) and
`@storylet-studio/model` (one scalar type). Browser and Node 22.

## Three bearers, three interfaces

The wire gives a station key, a party token and a producer key, and they are
not the same thing. A **station** holds hardware the venue owns, and it
VOUCHES: it may mint parties, resolve a call sign, bind a wristband, issue
credentials and report presence. A **party** is a phone, and it HOLDS: it may
scan a placard, pick a story and claim its own pocket, and nothing else. A
**producer** is the person running the show, and it DRIVES: other people's
runs, visits, parties and world, the venue's locations and stations, the
builds, the bridges and the messages.

That is a type here, not a convention. `connectParty(token)` has no
`handshake`, so a companion page cannot present a call sign it overheard;
`connectStation(key)` has no `chooseInstallation`, because a device does not
choose a visitor's story; and `connectProducer(key)` has no `visit` of its
own, because a producer never plays.

## The producer

`connectProducer(key)` is the console API (spec 6.5), grouped as the wire
groups it, and it takes an integrator or monitor key just as happily for the
read-only subset.

```ts
const producer = client.connectProducer(key);

await producer.runs.go({ installation });          // GO is a cue without a time
const roster = await producer.visits.list({ installation });
const lens = await producer.visits.lens(roster.items[0].visit);
await producer.world.write({ installation, path: "world.time_phase", value: "act-two" });
```

Every list is `{ cursor, limit }` in and `{ items, next }` out, and
`walkPages` walks one:

```ts
for await (const party of walkPages((at) => producer.parties.list({ installation, ...at }))) { ... }
```

`producer.monitor` is the stream with monitor scope: everything, flow-tagged,
with a typed subscription per event kind (`onWorld`, `onVisit`, `onBoard`, ...)
and a merged `timeline` a console renders as one list. It does NOT open by
itself, unlike a station's: a producer key is as often an integrator firing one
command from a show-control cue as it is a console with a timeline on it, so
the console calls `monitor.start()` when it wants the scope.

**A producer is never in degraded mode's held state.** A station's commands
queue through a wifi blip on purpose, because a play must land exactly once and
the person pressing it should never know. The console is the opposite case: it
is the place where what happened has to be true, so a producer's command either
happened or was refused, and the console says which. A blip rejects with
`offline` at status 0, which is the console's cue to re-read rather than press
again. The one thing that still holds is `monitor.connection`, and it is saying
the TIMELINE is stale, never that a command is waiting.

## The visit is a state machine

`visit.state` is a frozen snapshot: `board`, `turns`, `clocks`, `properties`,
`presence`, `messages`, `connection`, `held`, `queued`, `closed`. It is
replaced whole and never mutated, so a renderer can compare fields and skip
work, and a listener holding yesterday's snapshot cannot be surprised by it
changing underneath.

`subscribe(listener)` hands over the current snapshot at once, so a front-end
never has to ask for the first frame.

Availability is the one thing that is NOT in the snapshot: `outcomes(card,
hand)` is a read, because the engine evaluates availability at the moment of
the ask. Gated outcomes come back with `available: false` and are meant to be
shown DISABLED, never hidden.

## Degraded mode

Every reference front-end must keep its last board and show a defined hold
state when the connection goes (spec 17 item 2), and that is this layer's job
rather than each app's.

- `connection` is one of `connecting`, `live`, `replaying`, `disconnected`,
  `held`. A UI renders it and nothing else.
- `held: true` means what is on screen is being held rather than confirmed:
  the stream is away, or a command has not gone out yet. `heldReason` is
  written for a person.
- A mutation pressed while the network is away is QUEUED, in order, with the
  `Idempotency-Key` it was minted with. It is sent once when the network comes
  back, and the key makes a double arrival harmless. A play the server
  REFUSED is not queued: `gated` is decided, not delayed.
- **A refusal is an answer, not a lost connection.** Degraded mode is for a
  transport that failed: status 0, a network error, the stream dropping. A 4xx
  with a wire code (`unknown_credential`, `revoked`, `not_bound`,
  `installation_closed`, `wrong_role`) never holds the screen, because holding
  promises the screen will catch up by itself and it will not. A refused
  command rejects with its message, for the page to show; a refused stream
  ticket stops the stream and sets `connection.refusal`, and a front-end
  showing that message should leave its banner alone.

## The token a phone holds

`connectParty(token)` is built with what the phone had, and adopts what the
server mints for it: the token that comes back with a walk-up scan, the one
the chooser mints, and the KEEPSAKE its own `claim({ kind: "token" })` issues.
Each arrives through `onToken` and is readable as `party.token`, so a page
persists one credential in one place.

The claim is the one that is easy to miss. Issuing a permanent credential IS
the claim (spec 7.1), and the day pass a walk-up was given still expires at
run end (7.3): a phone that took the keepsake and kept the day pass is a
stranger at the next run's first code.

## The stream

`POST /v1/stream-ticket`, then `EventSource` on `/v1/events?t=<ticket>`,
because a browser `EventSource` cannot set a header and the previous system's
real SSE connections 401'd for months for exactly that reason.

A reconnect mints a fresh ticket, so it is a fresh `EventSource` with no
`Last-Event-ID` header of its own to send; the client carries the same value
in the query (`last=`). On `replay-lost`, or on any reconnect, the board is
re-read before the client says it is live again.

## Injectables

`fetch`, `EventSource`, `timers` and `newIdempotencyKey` can all be supplied.
This is the Live Link's rule applied a product up: a test that has to stand up
a real listener to check a header is a test nobody writes twice, and a
fixture full of random keys is a fixture nobody can review.

## The fixture

`test/fake-server.ts` is a fake Storylet Server built on the wire's own types:
a consumer of the one definition, never a second one. The client's own test
drives two scripted sessions through it, a station's and a producer's, and
writes `packages/conformance/wire/frames.json` and `console-frames.json`,
which the server's suite replays. Regenerate both with:

```sh
npx vitest run packages/client/test/wire-fixture.test.ts -u
```

and review the diff, exactly as the Live Link fixture is regenerated.

## Status

Private and in the changeset ignore list until the server exists to ship with.
MIT in intent (spec 12): it goes public with the wire, on their own tag family.
