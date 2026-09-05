# @storylet-studio/wire

The Storylet Server's wire contract: one definition of every request body,
response body and SSE event that crosses the wire, imported by both ends.

Types only, plus a handful of string constants. No client, no server, no
behaviour: the JS this builds to is a few `export const` lines.

```ts
import { WIRE_VERSION } from "@storylet-studio/wire";
import type { HandshakeResponse, WireEvent } from "@storylet-studio/wire";

WIRE_VERSION; // "storyletengine/wire@1"
```

## Why a package for shapes

The previous system's audit found six high-severity bugs in one pass, and
every one of them was a client-server shape mismatch that both test suites
passed, because each mocked the other. One end sent `{ turns }` where the
other read `{ amount }`. A shape that lives in one package instead turns that
into a compile error. Do not re-declare a wire shape anywhere else.

## The venue, and the placard rule

There are two levels above a run. A **venue** is the physical place, one per
server: its **locations**, each a position on the venue plan with a printed
code, and its **stations**, each hardware with a key. An **installation** is
one story running there, and a venue hosts several at once, each binding its
own hands to the venue's locations. So `VenueView` and `LocationView` are the
building's, `BindingView` is one story's claim on a wall, and `StationView`
carries no hands at all: a station key is a venue key, and which story a
device shows is decided per party at the handshake, never per device at
provisioning.

**A placard is a location, not a station.** Its QR is
`https://<server>/at/<venue>/<location>` and it carries no story: the visitor's
credential resolves to a party in an installation, and that pair is the
routing, so one sticker on one wall serves the family story by day and the
after-dark story by night. A walk-up holding no credential is offered the
venue's default installation, or a chooser when several are open, and the
choice mints the party there. This is why `AttachAtLocationResponse` is a
discriminated union rather than a shape with optional halves.

## The gameId rule

**Identity on the wire is by gameId**: hands, boxes, cards, outcomes and tags,
and properties by their path string as `listProperties()` prints it
(`@world.time_show`). Internal ids never cross. The `trace` event is the
engine's own event normalised the same way, which is why `WireTraceEvent`
mirrors the runtime's `TraceEvent` rather than importing it.

## Additive fields need no bump

**Every field not listed here is ignored by receivers**, so either end may add
fields without a version bump, exactly as the Live Link rules. A bump is for a
field that changes meaning or goes away. The version rides the path (`/v1`)
and the `hello`, and it is `WIRE_VERSION`.

Every mutation takes an `Idempotency-Key` header, so a retry after a wifi blip
is not a second deal. It is a header rather than a field: a retry must be the
same request.

Authored against the Storylet Server design, section 6, with the vocabulary of
section 2 and the parties, credentials and principals of section 7.
