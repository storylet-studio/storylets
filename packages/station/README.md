# @storylet-studio/station

The reference stations: one plain web app per station kind, assembled from
[the kit](../station-kit). Each is complete enough to run a venue, and plain
enough that nobody mistakes it for the venue's design.

```sh
npm run build -w @storylet-studio/station    # -> dist/<kind>/
npm run serve -w @storylet-studio/station    # build, then serve them
```

The build makes one **self-contained folder per kind**. Copy a folder onto a
device, edit `station.json`, and that device is provisioned: no build step, no
environment variables, no rebuild to move a kiosk from the rehearsal server to
the show server between houses.

## The five

| Folder | Kind | What it is |
|---|---|---|
| `kiosk/` | `fixed` | handshake, then the hand. Idle parks the visit after N minutes, so a party who walks away mid-beat does not leave their story for the next person. Offers the claim at the end of a first play. |
| `crew/` | `crew` | a performer's phone. Recent parties, handshake by camera or call sign, the party's hand at this NPC as a prompt list (title, purpose, the project's `prompt` field and its `cue`), outcomes as what to record with each purpose as a hint beside its button, peek, done, the zone strip that signs in to a wall and reads back the zone the server derived, the show clock and the phase, the tray of what the control room has said (with an ack where one is asked for, and a `since` cursor kept so a handset that came back does not re-read the run), and a one-tap help call carrying where it is and who it is with. |
| `companion/` | `companion` | the party's own phone, opened by a QR: `/p/<token>` or `/at/<venue>/<location>`. The card face is a visitor's: the title, the story, the outcome titles. Holds the token in `localStorage`, shows the party's own QR, attaches on a placard scan, offers the chooser when the walls carry two stories, and offers the claim. |
| `sign-in/` | `sign-in` | the door. Mint, claim, issue a credential per member, show and print the QR, speak the call sign. |
| `house/` | `house` | the venue's own flow on a wall: the plan, the clock and the phase, the house's hands, and the cues a bridge just fired, mirrored three deep under them. |

## `station.json`

```json
{
  "kind": "crew",
  "title": "The Caretaker",
  "base": "http://venue.local:4470",
  "venue": "this-room",
  "stationKey": "paste-the-key-the-console-showed-you",
  "idleMinutes": 4,
  "installation": "the-caretaker",
  "fields": { "body": "", "show": [{ "field": "prompt" }, { "field": "cue", "label": "Cue" }] },
  "hands": { "at-the-door": "The door" },
  "locations": [{ "location": "the-door", "label": "The door" }],
  "banner": { "held": "Back in a moment." }
}
```

`base` absent means the origin this page was served from, which is what a
companion page reached by a placard QR always wants. `stationKey` is absent on
a companion page and required everywhere else: a phone **holds** a credential
and a station **vouches**, and the two are different powers on the wire.

`fields` is the **card face**: `body` names the field holding the story, drawn
as prose with no label (`text` by default, and `""` on a crew handset, where
the story is the party's phone's job), and `show` lists the others, in order.
`hands` says what a hand is called on screen; the wire carries no hand titles,
so a hand named nowhere is headed with its gameId.

`locations` is the **crew handset's zone strip**: the walls a performer may
sign in to, in the order they should read. It lives here rather than coming off
the wire because the wire does not offer it, listing the venue's locations
being a console route and a station key not being a producer. The id goes to
`POST /v1/stations/me/presence`; the label is what a thumb finds in the dark.
What comes back is the **zone** the story's map derives from that location, and
the strip shows it, because that is the word a producer addresses a broadcast
to. A handset told no locations shows an empty strip, and the performer signs
in by scanning the placard on the wall instead, which is the same fact by the
other route.

What `station.json` may **not** say is whether the author's material shows. A
card's purpose and an outcome's purpose are notes about what a beat is for,
written for whoever performs it, so the station **kind** decides: a crew
handset shows them and nothing else does (spec 5.7). A party's screen that
could be talked into showing them by an edit to a config file is one typo from
the author's notes on a visitor's phone.

`kind` must match the app it sits beside. A mismatch is a provisioning mistake
and the page says so rather than half-working.

## The three routes

The spec's customisation gradient, in ascending order of effort. These apps
demonstrate each, and a venue that reaches the third has lost nothing from the
first two, which is the test the layering has to pass.

**RESTYLE.** Supply a `:root` block with the family's token names (`--bg`,
`--surface`, `--card`, `--ink`, `--muted`, `--line`, `--accent`, `--danger`,
`--warn`, `--ok`, `--radius-*`, `--font-*`) and a `fields` plan in
`station.json`. The look and the words are yours; not a line of code changes.

**REARRANGE.** Copy an app from `src/`, compose the kit's parts differently,
drop the ones you do not want, add your own. `src/kiosk.ts` is about a hundred
lines of wiring; the parts do the drawing and
[`@storylet-studio/client`](../client) does everything hard.

**REPLACE.** Build on the client alone. You keep the wire, reconnect and
replay, the handshake in both directions, the visit lifecycle, the board and
its events, idle and park, and the offline queueing of a play pressed during a
wifi blip. You replace the pixels. That is the whole of the argument for the
layering, and the reason the client is the thickest of the four layers.

## Degraded mode

Every one of these keeps its last board and shows a defined hold state when
the connection goes (spec 17 item 2). It is not each app's job: the client
holds the board and the `connectionBannerPart` says so, and the apps only
choose the words. A crew handset keeps its prompt list; the companion page
says come back to this spot in a moment.

## What has not been exercised

There is no Storylet Server yet. Everything here has been run against
`packages/client/test/fake-server.ts`, which speaks the wire's own types, and
against jsdom. Nothing has met a real socket, a real camera, a real printer or
a real wall.

## Status

Private and in the changeset ignore list until the server exists to ship with.
MIT in intent (spec 12): it goes public with the wire, on their own tag family.
