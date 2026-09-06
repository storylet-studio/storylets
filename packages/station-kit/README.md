# @storylet-studio/station-kit

The Storylet Server's UI parts: framework-neutral, in the family's tokens,
each usable alone.

```ts
import { handPart, installKitStyles } from "@storylet-studio/station-kit";

installKitStyles();
const hand = handPart({ onPlay: (card, outcome, h) => visit.play(card, outcome, h) });
document.querySelector("#hand")!.append(hand.el);
hand.update({ hand: "at-the-door", cards, outcomes });
```

## What a part is

One function, one element, `update()` and `dispose()`. No framework, no base
class, no lifecycle to learn.

```ts
interface Part<T> {
  readonly el: HTMLElement;
  update(state: T): void;
  dispose(): void;
}
```

`update` is called with the whole of what the part draws, every time, and the
part works out what changed. Nothing here diffs for you and nothing needs a
key: these are small parts and a venue reads them.

Nothing here talks to a server. Parts take state and give back events;
[`@storylet-studio/client`](../client) turns those into wire calls. That
separation is what makes REARRANGE a day's work rather than a rewrite.

## The parts

| Part | What it draws |
|---|---|
| `handshakePart` | camera QR (`BarcodeDetector` where it exists), a typed-code fallback that is never optional, an optional call-sign pick list |
| `handPart` | the hand as cards, outcomes as buttons, gated ones **disabled and never hidden**; the face is the party's unless a `CardFace` says otherwise |
| `planTemplate` / `FieldTemplate` | a card's fields, drawn by the plan a venue supplies: a body as prose, then the named fields |
| `zoneStripPart` | where this device is, tapped from the walls it was given; a LOCATION goes out and the ZONE the server derived from it is shown back |
| `messageTrayPart` | messages, newest first, with Acknowledge on what asked for it |
| `helpButtonPart` | a performer's help call, one thumb |
| `showClockPart` | the three clocks, counting on between readings, held on a Hold |
| `qrPart` | a QR as SVG (the `qrcode` package), for a keepsake, a placard or a pairing square |
| `connectionBannerPart` | degraded mode, said out loud; silent when live |
| `venueMapPart` | the venue plan, its locations, and what is waiting at each |

## Restyle

`KIT_CSS` sets every colour, radius and font through `var(--token, fallback)`,
and the token names are the family's: `--bg`, `--surface`, `--card`, `--ink`,
`--muted`, `--line`, `--line-soft`, `--accent`, `--accent-soft`, `--danger`,
`--warn`, `--ok`, `--radius-sm/md/lg/pill`, `--font-ui`, `--font-read`,
`--font-mono`. Supply a `:root` block and the kit is the venue's.

The kit does **not** import the studio, and must not: the editor is Electron
and this runs on a kiosk. The token names are the whole of the coupling, and
all of it that is wanted.

Class names all carry `sk-`, so a venue's own stylesheet reaches all of the
kit and none of its own markup with one selector.

The stylesheet is a **string** rather than a `.css` file. These pages are
bundled and served off a memory stick in a cupboard; a stylesheet that is a
second request is a stylesheet that can be missing, and a kiosk with no styles
reads as broken rather than plain. Call `installKitStyles()` once, or copy
`KIT_CSS` into your own build.

## Three rules the parts keep for you

**A card face is built by the station kind.** `handPart`'s default is the
PARTY's face: the card's title, the story (`body`, `text` unless a plan says
otherwise), and the outcomes as buttons labelled with their titles. The card's
purpose and the outcomes' purposes are the author's notes about what a beat is
for, and they are drawn only for a face that asks (`purpose`,
`outcomePurpose`), which is a crew handset and nothing else. An outcome's
purpose is never the button's `title` or `aria-label`: a hint in the
accessible name is the same leak, read out loud instead of drawn.

**A gated outcome is disabled, never hidden.** A performer who cannot see what
is unavailable cannot tell a locked door from a missing one, and a party
looking at a shorter list every time learns nothing about the world.

**A typed code is always there.** A camera can be missing, refused, dirty, or
pointed at a cracked screen, and a performer with a queue behind them needs a
way through.

## The map

Lifted from the playable page (`packages/ops/player/player.ts`) and the
Village client (`packages/village-client/src/map.ts`), down to the invisible
finger-sized halo over an 11-unit pin and the count inside the ring: those
were tuned against real thumbs on real screens.

What differs is where the coordinates come from. The playable page draws a
designer's map from the bundle's `maps` block; this draws the BUILDING, from a
`VenueView`'s plan and the venue's `LocationView`s. One background, one
coordinate space, so two stories on the same walls line up. Zones are optional
and come from the installation whose map covers the place, since a venue plan
has none of its own.

## Status

Private and in the changeset ignore list until the server exists to ship with.
MIT in intent (spec 12): it goes public with the wire, on their own tag family.
